'use strict';

// 起動確認 SIGK_SMOKE_IMAGE_EDIT の筋書き mosaic（2026-11-17 のユーザーの報告「画像編集時に、モザイクを配置するたびに画面が
// ホワイトアウトする」の再現と修正確認）。smoke-image-edit.js が呼ぶ。
//
// ファイルをタブで開き、書き込みツール「モザイク」を選択して、範囲をドラッグしてモザイクを置く操作を 2 回行う。ドラッグを終えてから
// 新しい絵を描き終えるまでの間に、ページの白い背景だけが見えるフレームがあるかを、次の 2 つで数える。
//   ① 画面（レンダラー）: requestAnimationFrame ごとに、1 ページ目の枠（.pdf-page）に絵（枠の直下の canvas か、前の絵を置く要素
//      .pdf-held の中の canvas）があるか。
//   ② 描画したフレーム（メイン）: offscreen 描画の paint イベントの画像で、1 ページ目の枠の範囲の画素のうち、白（R・G・B が 245 以上）の
//      割合（smoke-paint-watch.js）。
// ファイルは 3 つ。test/fixtures/image-wide.png（1200×800・青一色）、それを写真サイズ（4032×3024）に拡大して雑音を加えた JPEG
// （描画に時間がかかる写真の代わり）、比較用 PDF（test/fixtures/text-heavy.pdf。白いページなので ② の割合は判定に使わない）。
// paint イベントの画像は、いちばん白いフレーム（白いフレームがあったときだけ）と、最終フレームを PNG で残す。
// 終わったら、開いたタブを保存せずに閉じる（あとの筋書きに影響させないため）。
//
// 決定99 ①（モザイクが遅く反映される不具合の修正）: 写真を倍率 200% にしてモザイクを 3 つ置き、2 つ目・3 つ目の新しい絵が表示される
// までの時間（ドラッグを終えてから、今の並びのモザイクを塗り終えた絵が枠に表示されたフレームまで）と、追加した範囲だけを塗った画素が、
// ページを描き直した時の画素（今までの塗り方 paintOver）と一致するかを調べる（zoom200）。合格の目安は ZOOM_LIMIT_MS 以内・同じ canvas
// （描き直さない）・画素の違い 0。修正前は 2.2〜2.7 秒かかった（画面の拡大率 150% では 4.3 秒）。

const fs = require('node:fs');
const path = require('node:path');

const { WHITE_LEVEL, WHITE_FRAME, watchPaint, summarize } = require('./smoke-paint-watch.js');

// 写真サイズ（スマートフォンの 1,200 万画素）。
const PHOTO = Object.freeze({ width: 4032, height: 3024 });
// ドラッグを終えてから見張る時間（ミリ秒）。
const WATCH_MS = 2500;
// ドラッグする範囲（ページ枠の幅と高さに対する割合）。1 回目と 2 回目。
const DRAGS = Object.freeze([[[0.15, 0.2], [0.45, 0.5]], [[0.55, 0.45], [0.85, 0.8]]]);
// 倍率 200% で置く 3 つの範囲。3 つ目は 1 つ目と重なる（重なる範囲を塗り直して色を合わせる経路を通す）。
const ZOOM = 2;
const ZOOM_DRAGS = Object.freeze([...DRAGS, [[0.3, 0.3], [0.5, 0.42]]]);
// 2 つ目・3 つ目の新しい絵が表示されるまでの時間の上限（合格の目安）。修正後の実測の数倍の余裕を取った。
const ZOOM_LIMIT_MS = 1500;

// 写真の代わりの JPEG。決まった種の雑音を加える（smoke-image-edit.js の noiseImage と同じ作り方）。
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

// 枠に表示している絵。描き終えた絵は枠の直下、新しい絵を描き終えるまで表示する前の絵は .pdf-held の中にある（決定99 ②）。
const PICTURE = ':scope > canvas, :scope > .pdf-held > canvas';

// 開いて編集モードにし、書き込みツール「モザイク」を選択する。1 ページ目の絵が変わらなくなるまで待ち、見張る範囲（CSS px）を返す。
// zoom を渡すと、その倍率にしてから待つ。
const openScript = (target, zoom = null) => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const SigK = window.SigK;
  await SigK.tabs.openPath(${JSON.stringify(target)});
  SigK.shell.setMode(document, 'annot');
  if (SigK.annotate.getTool() !== 'mosaic')
    SigK.annotate.setTool('mosaic');
  if (${JSON.stringify(zoom)} !== null)
    SigK.viewer.setZoom(${JSON.stringify(zoom)});
  const node = () => document.querySelector('.pdf-page[data-page="1"]');
  const picture = () => node()?.querySelector(${JSON.stringify(PICTURE)}) ?? null;
  let last = null;
  for (let tries = 0; tries < 60; tries += 1) {
    await wait(300);
    const current = picture();
    if (current !== null && current === last && SigK.viewer.drawnPicture(0) !== null && SigK.viewer.getTextLayer(0) !== null)
      break;
    last = current;
  }
  const rect = node().getBoundingClientRect();
  const view = document.getElementById('view').getBoundingClientRect();
  const canvas = picture();
  return {
    tab: SigK.tabs.activeId(), zoom: SigK.viewer.getState().zoom, page: [Math.round(rect.width), Math.round(rect.height)], dpr: devicePixelRatio,
    canvas: canvas === null ? null : [canvas.width, canvas.height], inner: [innerWidth, innerHeight],
    area: { left: Math.max(rect.left, view.left), top: Math.max(rect.top, view.top), right: Math.min(rect.right, view.right), bottom: Math.min(rect.bottom, view.bottom) },
  };
})()`;

// 1 ページ目の from から to まで（枠に対する割合）ドラッグし、ドラッグを終えてから WATCH_MS の間、フレームごとに枠の絵を調べる。
// shownMs は、今の並びのモザイクを塗り終えた絵（drawnPicture）が枠に表示された最初のフレーム。samePicture は、置く前と同じ canvas か
// （追加した範囲だけを塗った時は同じ canvas。描き直した時は新しい canvas）。
const placeScript = ([from, to]) => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const round = (value) => Math.round(value * 10) / 10;
  const SigK = window.SigK;
  const node = () => document.querySelector('.pdf-page[data-page="1"]');
  const pictureIn = (frame) => frame?.querySelector(${JSON.stringify(PICTURE)}) ?? null;
  const rect = node().getBoundingClientRect();
  const at = ([fx, fy]) => [rect.left + rect.width * fx, rect.top + rect.height * fy];
  const [x1, y1] = at(${JSON.stringify(from)});
  const [x2, y2] = at(${JSON.stringify(to)});
  const send = (type, x, y, buttons) => node().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
  send('mousedown', x1, y1, 1);
  for (let part = 1; part <= 4; part += 1) {
    send('mousemove', x1 + ((x2 - x1) * part) / 4, y1 + ((y2 - y1) * part) / 4, 1);
    await wait(20);
  }
  const before = node();
  const picture = pictureIn(before);
  const frames = [];
  const started = performance.now();
  send('mouseup', x2, y2, 0);
  const handlerMs = round(performance.now() - started);
  const count = (SigK.viewer.getPlan()[0].mosaic ?? []).length;
  let shownMs = null;
  await new Promise((resolve) => {
    const tick = () => {
      const ms = performance.now() - started;
      const canvas = pictureIn(node());
      frames.push({ ms: round(ms), canvas: canvas !== null, old: canvas !== null && canvas === picture });
      if (shownMs === null && (SigK.viewer.drawnPicture(0)?.plan?.mosaic ?? []).length === count)
        shownMs = round(ms);
      if (ms >= ${WATCH_MS})
        resolve();
      else
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const empty = frames.filter((frame) => !frame.canvas);
  const fresh = frames.find((frame) => frame.canvas && !frame.old);
  return {
    handlerMs, frames: frames.length, framesWithoutPicture: empty.length, emptyFromMs: empty[0]?.ms ?? null, emptyToMs: empty.at(-1)?.ms ?? null,
    newPictureMs: fresh?.ms ?? null, shownMs, samePicture: pictureIn(node()) === picture, sameNode: node() === before, mosaic: count,
  };
})()`;

// 枠に表示している 1 ページ目の絵の、モザイクの範囲（まわり 2 画素を含む）の画素を、同じ viewport でページを描き直して今までの塗り方
// （paintOver）で塗った絵の画素と比べる。
const compareScript = `(async () => {
  const SigK = window.SigK;
  const drawn = SigK.viewer.drawnPicture(0);
  if (drawn === null)
    return null;
  const { canvas, viewport, page, plan } = drawn;
  const fresh = document.createElement('canvas');
  fresh.width = canvas.width;
  fresh.height = canvas.height;
  await page.render({ canvasContext: fresh.getContext('2d'), viewport, annotationMode: SigK.pdfjs.lib.AnnotationMode.ENABLE_STORAGE }).promise;
  await SigK.mosaicPaint.paintOver(document, fresh, page, viewport, plan.mosaic);
  let pixels = 0;
  let differ = 0;
  let max = 0;
  for (const item of plan.mosaic) {
    const [left, top, right, bottom] = SigK.mosaicPaint.clipRect(SigK.mosaicPaint.pixelRectOf(viewport, ...item.box), canvas.width, canvas.height);
    const [x, y] = [Math.max(0, left - 2), Math.max(0, top - 2)];
    const [w, h] = [Math.min(canvas.width, right + 2) - x, Math.min(canvas.height, bottom + 2) - y];
    const shown = canvas.getContext('2d').getImageData(x, y, w, h).data;
    const redrawn = fresh.getContext('2d').getImageData(x, y, w, h).data;
    for (let i = 0; i < shown.length; i += 4) {
      const gap = Math.max(...[0, 1, 2, 3].map((k) => Math.abs(shown[i + k] - redrawn[i + k])));
      pixels += 1;
      differ += gap === 0 ? 0 : 1;
      max = Math.max(max, gap);
    }
  }
  fresh.width = 0;
  fresh.height = 0;
  return { mosaic: plan.mosaic.length, pixels, differ, max };
})()`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1 つのファイルで、開いて 2 回モザイクを置く。
async function runCase({ win, js, dir, name, target }) {
  const opened = await js(openScript(target));
  const stopBase = watchPaint(win, opened.area, opened.inner);
  win.webContents.invalidate();
  await wait(300);
  const baseline = summarize(stopBase());
  const placements = [];
  let whitest = null;
  let last = null;
  for (const drag of DRAGS) {
    const stop = watchPaint(win, opened.area, opened.inner);
    const renderer = await js(placeScript(drag));
    await wait(200);
    const watched = stop();
    if (watched.whitest !== null && (whitest === null || watched.whitest.white > whitest.white))
      whitest = watched.whitest;
    last = watched.last ?? last;
    placements.push({ renderer, paint: summarize(watched) });
  }
  const shots = { whitest: null, last: null };
  for (const [kind, png] of [['whitest', whitest?.png ?? null], ['last', last]]) {
    if (png === null)
      continue;
    shots[kind] = path.join(dir, `mosaic-${kind}-${name}.png`);
    fs.writeFileSync(shots[kind], png);
  }
  await js(`window.SigK.tabs.forceCloseTab(${JSON.stringify(opened.tab)})`);
  return { name, zoom: opened.zoom, page: opened.page, canvas: opened.canvas, baselineWhite: baseline.maxWhite, placements, shots };
}

// 写真を倍率 200% にして 3 つ置き、2 つ目・3 つ目の時間と、追加した範囲だけを塗った画素を調べる（決定99 ①）。
async function runZoomCase({ js, target }) {
  const opened = await js(openScript(target, ZOOM));
  const placements = [];
  for (const drag of ZOOM_DRAGS) {
    const { handlerMs, shownMs, samePicture, framesWithoutPicture, mosaic } = await js(placeScript(drag));
    placements.push({ mosaic, handlerMs, shownMs, samePicture, framesWithoutPicture });
    await wait(200);
  }
  const pixels = await js(compareScript);
  await js(`window.SigK.tabs.forceCloseTab(${JSON.stringify(opened.tab)})`);
  const later = placements.slice(1);
  const ok = later.every((item) => item.shownMs !== null && item.shownMs <= ZOOM_LIMIT_MS && item.samePicture) && pixels !== null && pixels.differ === 0;
  return { zoom: opened.zoom, dpr: opened.dpr, canvas: opened.canvas, limitMs: ZOOM_LIMIT_MS, placements, pixels, ok };
}

async function run({ win, js, dir, root, nativeImage }) {
  fs.mkdirSync(dir, { recursive: true });
  const fixture = (name) => path.join(root, 'test', 'fixtures', name);
  const wide = path.join(dir, 'mosaic-wide.png');
  fs.copyFileSync(fixture('image-wide.png'), wide);
  const photo = path.join(dir, 'mosaic-photo.jpg');
  fs.writeFileSync(photo, photoJpeg(nativeImage, fixture('image-wide.png')));
  const pdf = path.join(dir, 'mosaic-text.pdf');
  fs.copyFileSync(fixture('text-heavy.pdf'), pdf);
  const cases = [];
  for (const [name, target] of [['wide', wide], ['photo', photo], ['pdf', pdf]])
    cases.push(await runCase({ win, js, dir, name, target }));
  const zoom200 = await runZoomCase({ js, target: photo });
  await js(`(() => { window.SigK.annotate.setTool(null); window.SigK.shell.setMode(document, 'view'); return true; })()`);
  return { whiteLevel: WHITE_LEVEL, whiteFrame: WHITE_FRAME, watchMs: WATCH_MS, cases, zoom200 };
}

module.exports = { run, openScript, placeScript, PHOTO };
