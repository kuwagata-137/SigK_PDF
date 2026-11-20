'use strict';

// 起動確認 SIGK_SMOKE_PAGE_REPAINT=<出力フォルダ>（docs/07 決定99 ②。2026-11-17 の不具合「回転などで白く点滅する」の修正確認）。
// main.js の installSmokeCheck が呼ぶ。ウインドウを表示しない起動確認（SIGK_SMOKE_HIDDEN）で使う。
//
// 検証用のファイル（test/fixtures の three-pages.pdf・many-pages.pdf の写しと、smoke-image-mosaic.js と同じ作り方の写真 4032 × 3024 の JPEG）をタブで開き、
// 並びを変える操作ごとに、操作してから新しい絵を描き終えるまでの間に、絵の無い枠が見えるフレームがあるかを、次の 2 つで数える。
//   ① 画面（レンダラー）: requestAnimationFrame ごとに、表示域に見えているページ枠（.pdf-page）と、左パネルに見えているサムネイル枠
//      （.thumb .sheet）に canvas があるか（前の絵を置く要素 .pdf-held の中の canvas も、絵があると数える）。
//   ② 描画したフレーム（メイン）: offscreen 描画の paint イベントの画像で、表示域の白い画素の割合（smoke-paint-watch.js）。操作の前と
//      描き終えた後の割合より 0.1 以上白いフレームを、白いフレームと数える。PDF は白いページなので、② は写真だけで判定に使う。
// 描き終えた後に、前の絵を置く要素が残っていないことと、1 つの枠に canvas が 2 枚以上無いことも見る。
// ［挿入］のファイルを選ぶ画面は、main の dialog.showOpenDialog を差し替えて答える（画面を表示しない）。
// 終わったら、開いたタブを保存せずに閉じる（あとの筋書きに影響させないため）。

const fs = require('node:fs');
const path = require('node:path');

const { watchPaint } = require('./smoke-paint-watch.js');

// 写真サイズ（スマートフォンの 1,200 万画素。smoke-image-mosaic.js と同じ）。
const PHOTO = Object.freeze({ width: 4032, height: 3024 });
// 操作してから見張る時間の上限（ミリ秒）。描き終えて 400 ms 変わらなければ、そこで終える。
const WATCH_MS = 6000;
// 操作の前と後より、これだけ白いフレームを白いフレームと数える（②）。
const WHITE_MARGIN = 0.1;

// 写真の代わりの JPEG（smoke-image-mosaic.js の photoJpeg と同じ作り方。決まった種の雑音を加える）。
function photoJpeg(nativeImage, source) {
  const bitmap = Buffer.from(nativeImage.createFromPath(source).resize({ width: PHOTO.width, height: PHOTO.height }).toBitmap());
  let seed = 11;
  for (let at = 0; at < bitmap.length; at += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const shift = (seed % 49) - 24;
    for (let channel = 0; channel < 3; channel += 1)
      bitmap[at + channel] = Math.max(0, Math.min(255, bitmap[at + channel] + shift));
  }
  return nativeImage.createFromBitmap(bitmap, { width: PHOTO.width, height: PHOTO.height }).toJPEG(90);
}

// 画面（レンダラー）で動かす関数。文字列にして executeJavaScript で流し込み、window.__repaintWatch を作る。外の変数は使わない。
function installWatch() {
  const SigK = window.SigK;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const round = (value) => Math.round(value * 10) / 10;
  const rectOf = (id) => document.getElementById(id)?.getBoundingClientRect() ?? null;
  const shows = (rect, area) => area !== null && rect.width > 0 && rect.height > 0 && rect.bottom > area.top && rect.top < area.bottom
    && rect.right > area.left && rect.left < area.right;

  // 見えている枠ごとの絵。0 は絵が無い、1 は前の絵を置く要素の中の絵、2 は描き終えた絵。
  function visible() {
    const view = rectOf('view');
    const side = rectOf('side-scroll');
    const stateOf = (node) => (node.querySelector(':scope > canvas') !== null ? 2 : (node.querySelector(':scope > .pdf-held > canvas') !== null ? 1 : 0));
    const pages = [...document.querySelectorAll('#view-pages > .pdf-page')].filter((node) => shows(node.getBoundingClientRect(), view)).map(stateOf);
    const list = document.getElementById('thumbs');
    const thumbs = list === null || list.hidden ? [] : [...list.querySelectorAll('.thumb > .sheet')].filter((node) => shows(node.getBoundingClientRect(), side)).map(stateOf);
    return { pages, thumbs };
  }

  const done = (state) => state.pages.length > 0 && [...state.pages, ...state.thumbs].every((value) => value === 2);
  const leftovers = () => ({
    held: document.querySelectorAll('.pdf-held').length,
    doubles: [...document.querySelectorAll('#view-pages > .pdf-page, #thumbs .sheet')].filter((node) => node.querySelectorAll('canvas').length > 1).length,
  });

  // 見えている枠がすべて描き終えた絵を持ち、quietMs の間変わらなくなるまで待つ。
  async function settle({ maxMs = 15000, quietMs = 400 } = {}) {
    const started = performance.now();
    let key = '';
    let since = started;
    while (performance.now() - started < maxMs) {
      await nextFrame();
      const state = visible();
      const now = JSON.stringify(state);
      if (now !== key) {
        key = now;
        since = performance.now();
      }
      if (done(state) && performance.now() - since >= quietMs)
        return true;
    }
    return false;
  }

  // 紙の見える範囲の内側（縁から ratio ずつ内側）。
  function innerBox(box, ratio) {
    const w = box[2] - box[0];
    const h = box[3] - box[1];
    return [box[0] + w * ratio, box[1] + h * ratio, box[2] - w * ratio, box[3] - h * ratio];
  }

  function visibleOf(index) {
    const entry = SigK.viewer.getPlan()[index];
    return SigK.pageCrop.visibleOf(entry, SigK.viewer.getBasePage(entry.src).view);
  }

  // ページの表示域で描いていないが、サムネイルは描き終えているページ（先頭へ移すと、サムネイルの絵を拡大して表示する）。無ければ -1。
  function drawnOnlyInThumbs() {
    const rendered = SigK.viewer.getState().rendered;
    const sheets = [...document.querySelectorAll('#thumbs .thumb > .sheet')];
    return sheets.findIndex((sheet, index) => index > 0 && !rendered.includes(index) && sheet.querySelector(':scope > canvas') !== null);
  }

  async function act(spec) {
    const list = () => SigK.pageListTarget.current(document);
    switch (spec.op) {
      case 'rotate': return SigK.pageActions.rotate(spec.delta, spec.indices);
      case 'rotateCurrent': return SigK.pageActions.rotateCurrent(spec.delta);
      case 'remove': return SigK.pageActions.remove(spec.indices);
      case 'move': return SigK.pageTransfer.move(spec.indices, spec.to);
      case 'moveFar': {
        const far = drawnOnlyInThumbs();
        return far > 0 && SigK.pageTransfer.move([far], 0);
      }
      case 'copy': return (await SigK.pageListCommands.copy(list(), spec.indices))?.ok === true;
      case 'cut': return (await SigK.pageListCommands.cut(list(), spec.indices))?.ok === true;
      case 'paste': return (await SigK.pageListCommands.paste(list(), spec.at))?.ok === true;
      case 'insert':
        SigK.pageGrid.setSelection([spec.at]);
        return (await SigK.insert.run())?.ok === true;
      case 'trim': return SigK.trimCommit.apply(spec.index, innerBox(visibleOf(spec.index), spec.ratio), 'page').count === 1;
      case 'untrim': return SigK.trimCommit.remove(spec.index, 'page') === 1;
      case 'undo': return SigK.pageEdit.undo();
      case 'redo': return SigK.pageEdit.redo();
      case 'save': return (await SigK.save.saveActive())?.ok === true;
      default: throw new Error(`知らない操作: ${spec.op}`);
    }
  }

  // 操作の前後を requestAnimationFrame ごとに見張る。描き終えて quietMs の間変わらなくなるか、watchMs が過ぎるまで。
  async function measure(spec, { watchMs, quietMs = 400 }) {
    const frames = [];
    let running = true;
    const started = performance.now();
    // 時刻（ms）は丸めずに記録する（丸めると、操作の直前のフレームを操作の後のフレームと数えることがある）。
    const loop = () => {
      if (!running)
        return;
      const state = visible();
      frames.push({ ms: performance.now() - started, emptyPages: state.pages.filter((value) => value === 0).length,
        emptyThumbs: state.thumbs.filter((value) => value === 0).length, done: done(state) });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    await wait(60);
    const opAt = performance.now() - started;
    const ok = await act(spec);
    const opMs = round(performance.now() - started - opAt);
    let key = '';
    let since = performance.now();
    while (performance.now() - started < watchMs) {
      await nextFrame();
      const now = JSON.stringify(visible());
      if (now !== key) {
        key = now;
        since = performance.now();
      }
      if (done(visible()) && performance.now() - since >= quietMs)
        break;
    }
    running = false;
    const after = frames.filter((frame) => frame.ms > opAt);
    const empty = after.filter((frame) => frame.emptyPages > 0 || frame.emptyThumbs > 0);
    return {
      ok, opMs, frames: after.length, framesWithoutPicture: empty.length,
      emptyPageFrames: after.filter((frame) => frame.emptyPages > 0).length, emptyThumbFrames: after.filter((frame) => frame.emptyThumbs > 0).length,
      newPictureMs: round((after.find((frame) => frame.done)?.ms ?? Number.NaN) - opAt), settled: done(visible()), ...leftovers(),
    };
  }

  // 表示域の矩形（CSS px）。上端の 48px は数えない（通知バーが重なり、その色を数えてしまうため）。
  function area() {
    const view = rectOf('view');
    return { left: view.left, top: Math.min(view.bottom, view.top + 48), right: view.right, bottom: view.bottom, inner: [innerWidth, innerHeight] };
  }

  window.__repaintWatch = { settle, act, measure, area };
  return true;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 表示域の白い画素の割合の記録から、操作の前と描き終えた後より WHITE_MARGIN 以上白いフレームを数える。
function whiteFrames(watched, baseline) {
  const values = watched.frames.map((frame) => frame.white).filter((white) => white !== null);
  const settledWhite = values.at(-1) ?? baseline;
  const limit = Math.max(baseline ?? 0, settledWhite ?? 0) + WHITE_MARGIN;
  return { paintFrames: values.length, whiteFrames: values.filter((white) => white > limit).length, maxWhite: Math.max(0, ...values), baseline, settledWhite };
}

// 1 つの操作を見張る。
async function watchOp({ win, js }, spec) {
  await js('window.__repaintWatch.settle()');
  const area = await js('window.__repaintWatch.area()');
  const stopBase = watchPaint(win, area, area.inner);
  win.webContents.invalidate();
  await wait(250);
  const base = stopBase().frames.map((frame) => frame.white).filter((white) => white !== null);
  const stop = watchPaint(win, area, area.inner);
  const renderer = await js(`window.__repaintWatch.measure(${JSON.stringify(spec)}, { watchMs: ${WATCH_MS} })`);
  await wait(200);
  return { op: spec.label, ...renderer, paint: whiteFrames(stop(), base.at(-1) ?? null) };
}

// zoom を渡すと、開いた後にその倍率にする（渡さなければ開いた時の倍率のまま）。
async function openTab(js, target, mode, zoom = null) {
  return js(`(async () => {
    const SigK = window.SigK;
    await SigK.tabs.openPath(${JSON.stringify(target)});
    SigK.shell.setMode(document, ${JSON.stringify(mode)});
    if (${JSON.stringify(zoom)} !== null)
      SigK.viewer.setZoom(${JSON.stringify(zoom)});
    SigK.viewer.goToPage(0);
    await window.__repaintWatch.settle();
    const state = SigK.viewer.getState();
    return { tab: SigK.tabs.activeId(), zoom: state.zoom, pages: state.pageCount };
  })()`);
}

// ページ編集モードの操作（PDF）。［挿入］は inserts のファイルを選んだことにする。
const pageSteps = (inserts) => [
  { label: '右回転', op: 'rotate', delta: 90, indices: [0] },
  { label: '右回転の取り消し', op: 'undo' },
  { label: '右回転のやり直し', op: 'redo' },
  { label: '左回転', op: 'rotate', delta: -90, indices: [0] },
  { label: '削除', op: 'remove', indices: [0] },
  { label: '削除の取り消し', op: 'undo' },
  { label: '削除のやり直し', op: 'redo' },
  { label: '削除の取り消し（2 回目）', op: 'undo' },
  { label: '並べ替え', op: 'move', indices: [0], to: 3 },
  { label: '並べ替えの取り消し', op: 'undo' },
  { label: '切り取り', op: 'cut', indices: [0] },
  { label: '切り取りの取り消し', op: 'undo' },
  { label: 'コピー（準備）', op: 'copy', indices: [0], setup: true },
  { label: '貼り付け', op: 'paste', at: 0 },
  { label: '貼り付けの取り消し', op: 'undo' },
  { label: '貼り付けのやり直し', op: 'redo' },
  { label: '挿入（PDF）', op: 'insert', at: 0, file: inserts.pdf },
  { label: '挿入（PDF）の取り消し', op: 'undo' },
  { label: '挿入（画像）', op: 'insert', at: 0, file: inserts.image },
  { label: '挿入（画像）の取り消し', op: 'undo' },
  { label: '挿入（画像）のやり直し', op: 'redo' },
  { label: '回転（準備）', op: 'rotate', delta: 90, indices: [1], setup: true },
  { label: '上書き保存', op: 'save' },
];

// ページの多い PDF（test/fixtures/many-pages.pdf。40 ページ）の操作。ページの表示域で描いていないページを先頭へ移すと、前の絵が無いので、
// サムネイルの絵を拡大して表示する。3 ページを削除すると、ページの表示域で描いていなかったページが見える位置に来る。
const manySteps = [
  { label: 'ページの表示域で描いていないページの並べ替え', op: 'moveFar' },
  { label: 'ページの表示域で描いていないページの並べ替えの取り消し', op: 'undo' },
  { label: '3 ページの削除', op: 'remove', indices: [0, 1, 2] },
  { label: '3 ページの削除の取り消し', op: 'undo' },
];

// 編集モードの操作（PDF と写真）。
const editSteps = [
  { label: '［右回転］', op: 'rotateCurrent', delta: 90 },
  { label: '［右回転］の取り消し', op: 'undo' },
  { label: '［右回転］のやり直し', op: 'redo' },
  { label: '［左回転］', op: 'rotateCurrent', delta: -90 },
  { label: 'トリミング', op: 'trim', index: 0, ratio: 0.12 },
  { label: 'トリミングの取り消し', op: 'undo' },
  { label: 'トリミングのやり直し', op: 'redo' },
  { label: 'トリミングの解除', op: 'untrim', index: 0 },
];

// 写真を倍率 100% で表示した時の操作。切る前の絵は控えの上限（1,600 万画素）を 1 枚で超えるので、縮めた絵を控える。
const photoSteps = [
  { label: 'トリミング', op: 'trim', index: 0, ratio: 0.12 },
  { label: 'トリミングの取り消し', op: 'undo' },
  { label: '［右回転］', op: 'rotateCurrent', delta: 90 },
  { label: '［右回転］の取り消し', op: 'undo' },
];

// 1 つのファイルで steps を順番に行う。setup の手順は見張らない。
async function runCase(ctx, { name, target, mode, steps, zoom = null }) {
  const opened = await openTab(ctx.js, target, mode, zoom);
  const ops = [];
  for (const step of steps) {
    if (step.file !== undefined)
      ctx.answers.push(step.file);
    if (step.setup === true) {
      await ctx.js(`window.__repaintWatch.act(${JSON.stringify(step)})`);
      continue;
    }
    ops.push(await watchOp(ctx, step));
  }
  await ctx.js(`window.SigK.tabs.forceCloseTab(${JSON.stringify(opened.tab)})`);
  return { name, mode, zoom: opened.zoom, pages: opened.pages, ops };
}

// アプリ全体と画面（レンダラー）の実メモリ（MB）。控えた前の絵でメモリが増え続けないかを見る。
function memoryOf(app, win) {
  const metrics = app.getAppMetrics();
  const mb = (entry) => Math.round((entry?.memory?.workingSetSize ?? 0) / 1024);
  return { totalMb: metrics.reduce((sum, entry) => sum + mb(entry), 0), rendererMb: mb(metrics.find((entry) => entry.pid === win.webContents.getOSProcessId())) };
}

async function run({ app, win, dir, root, dialog, nativeImage }) {
  fs.mkdirSync(dir, { recursive: true });
  const fixture = (name) => path.join(root, 'test', 'fixtures', name);
  const copy = (name, as) => {
    const target = path.join(dir, as);
    fs.copyFileSync(fixture(name), target);
    return target;
  };
  const photo = path.join(dir, 'repaint-photo.jpg');
  fs.writeFileSync(photo, photoJpeg(nativeImage, fixture('image-wide.png')));
  const inserts = { pdf: copy('one-page.pdf', 'repaint-insert.pdf'), image: copy('image-wide.png', 'repaint-insert.png') };
  const js = (script) => win.webContents.executeJavaScript(script);
  const answers = [];
  const original = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [answers.shift() ?? inserts.pdf] });
  try {
    await js(`(${installWatch.toString()})()`);
    const ctx = { win, js, answers };
    const memory = { atStart: memoryOf(app, win) };
    const cases = [];
    cases.push(await runCase(ctx, { name: 'pdf-pages', target: copy('three-pages.pdf', 'repaint-pages.pdf'), mode: 'pages', steps: pageSteps(inserts) }));
    cases.push(await runCase(ctx, { name: 'pdf-many', target: copy('many-pages.pdf', 'repaint-many.pdf'), mode: 'pages', steps: manySteps }));
    cases.push(await runCase(ctx, { name: 'pdf-edit', target: copy('three-pages.pdf', 'repaint-edit.pdf'), mode: 'annot', steps: editSteps }));
    cases.push(await runCase(ctx, { name: 'photo-edit', target: photo, mode: 'annot', steps: editSteps }));
    cases.push(await runCase(ctx, { name: 'photo-100', target: photo, mode: 'annot', steps: photoSteps, zoom: 1 }));
    memory.atEnd = memoryOf(app, win);
    await js(`(() => { window.SigK.shell.setMode(document, 'view'); return true; })()`);
    const ops = cases.flatMap((item) => item.ops);
    return {
      watchMs: WATCH_MS, whiteMargin: WHITE_MARGIN, memory, cases,
      // 合格の目安: どの操作でも、絵の無い枠が見えるフレームが 0 で、描き終えた後に前の絵を置く要素も 2 枚目の canvas も残らない。
      total: {
        ops: ops.length,
        framesWithoutPicture: ops.reduce((sum, item) => sum + item.framesWithoutPicture, 0),
        photoWhiteFrames: cases.filter((item) => item.name.startsWith('photo')).flatMap((item) => item.ops).reduce((sum, item) => sum + item.paint.whiteFrames, 0),
        held: ops.reduce((sum, item) => sum + item.held, 0),
        doubles: ops.reduce((sum, item) => sum + item.doubles, 0),
        failedOps: ops.filter((item) => item.ok !== true).map((item) => item.op),
      },
    };
  } finally {
    dialog.showOpenDialog = original;
  }
}

module.exports = { run, installWatch, whiteFrames, PHOTO, WHITE_MARGIN };
