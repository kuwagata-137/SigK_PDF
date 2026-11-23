'use strict';

// 起動確認 SIGK_SMOKE_TAB_REPAINT=<出力フォルダ>（docs/07 決定100 ①〜③・⑤。タブの切り替えなどで白く点滅する不具合と、サムネイルの文字欠けの修正確認）。
// main.js の installSmokeCheck が呼ぶ。ウインドウを表示しない起動確認（SIGK_SMOKE_HIDDEN）で使う。
//
// 検証用のファイル（test/fixtures の three-pages.pdf・mixed-size.pdf・many-pages.pdf の写し）をタブで開き、次の操作ごとに、操作してから
// 新しい絵を描き終えるまでの間に、絵の無い枠が見えるフレームがあるかを数える。
//   ① タブバーのタブをクリックして、タブを切り替える（ページ編集モードと閲覧モード）。
//   ② ツールモードから、ページ編集モード・編集モード・閲覧モードに戻る（ツールモードの中でタブを切り替えてから戻る場合も）。
//   ③ 左パネルの右端（#side-resizer）をドラッグして、左パネルの幅と列数を変える。
// 数え方: 表示域に見えているページ枠（.pdf-page）と、左パネルに見えているサムネイル枠（.thumb .sheet）に canvas があるか（前の絵を置く要素
// .pdf-held の中の canvas も、絵があると数える）。数える時刻は、レイアウトの後・描画の前（ResizeObserver の通知）にする。requestAnimationFrame の
// 始めで数えると、同じフレームの後の処理（pdf.js の描画の続き）で canvas が入る枠を、絵が無いと数えるため。
// ③ では、列数が増えて新しく見えるようになったサムネイル（操作の前に見えていなかったページ）は数えない（決定100 で対象外にした）。
// 操作の後に、ページ枠とサムネイル枠の描き終えた canvas を、同じページを CPU で描いた絵と比べ、文字の一部が欠けた絵（文字欠け）を数える（⑤）。
// 終わったら、開いたタブを保存せずに閉じる（あとの筋書きに影響させないため）。

const fs = require('node:fs');
const path = require('node:path');

// 操作してから見張る時間の上限（ミリ秒）。描き終えて 400 ms 変わらなければ、そこで終える。
const WATCH_MS = 6000;
// 文字欠けと数える画素の数の下限と、描き直した絵の暗い画素に対する割合の下限。
const MISS_PIXELS = 6;
const MISS_RATIO = 0.02;

// 描き直した絵で暗いのに表示している絵で明るい画素（miss）が、文字欠けと数える量か。
function glyphBroken(miss, dark) {
  return miss >= MISS_PIXELS && miss >= dark * MISS_RATIO;
}

// 画面（レンダラー）で動かす関数。文字列にして executeJavaScript で流し込み、window.__tabRepaint を作る。外の変数は使わない。
function installWatch() {
  const SigK = window.SigK;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const round = (value) => Math.round(value * 10) / 10;
  const rectOf = (id) => document.getElementById(id)?.getBoundingClientRect() ?? null;
  const shows = (rect, area) => area !== null && rect.width > 0 && rect.height > 0 && rect.bottom > area.top && rect.top < area.bottom
    && rect.right > area.left && rect.left < area.right;
  // 0 は絵が無い、1 は前の絵を置く要素の中の絵、2 は描き終えた絵。
  const stateOf = (node) => (node.querySelector(':scope > canvas') !== null ? 2 : (node.querySelector(':scope > .pdf-held > canvas') !== null ? 1 : 0));

  // 見えている枠ごとの絵。サムネイルはページ番号も返す（③ で、新しく見えるようになったサムネイルを分けるため）。
  function visible() {
    if (document.documentElement.getAttribute('data-mode') === 'tools')
      return { pages: [], thumbs: [] };
    const view = rectOf('view');
    const side = rectOf('side-scroll');
    const pages = [...document.querySelectorAll('#view-pages > .pdf-page')].filter((node) => shows(node.getBoundingClientRect(), view)).map(stateOf);
    const list = document.getElementById('thumbs');
    const thumbs = list === null || list.hidden ? [] : [...list.querySelectorAll('.thumb')]
      .map((node) => ({ page: Number(node.dataset.page), sheet: node.querySelector(':scope > .sheet') }))
      .filter((item) => item.sheet !== null && shows(item.sheet.getBoundingClientRect(), side))
      .map((item) => ({ page: item.page, state: stateOf(item.sheet) }));
    return { pages, thumbs };
  }

  const done = (state) => state.pages.length > 0 && state.pages.every((value) => value === 2) && state.thumbs.every((item) => item.state === 2);
  const keyOf = (state) => JSON.stringify(state);
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
      const now = keyOf(state);
      if (now !== key) {
        key = now;
        since = performance.now();
      }
      if (done(state) && performance.now() - since >= quietMs)
        return true;
    }
    return false;
  }

  // 左パネルの右端（#side-resizer）を、マウスのイベントでドラッグする（shell.js の installResizer が受け取る）。1 フレームに 1 回 mousemove を送る。
  async function dragSide(to, steps = 12) {
    const resizer = document.getElementById('side-resizer');
    const side = document.getElementById('side');
    const left = side.getBoundingClientRect().left;
    const from = side.getBoundingClientRect().width;
    const at = (width) => ({ bubbles: true, cancelable: true, clientX: left + width, clientY: 300, button: 0 });
    resizer.dispatchEvent(new MouseEvent('mousedown', at(from)));
    for (let step = 1; step <= steps; step += 1) {
      await nextFrame();
      document.dispatchEvent(new MouseEvent('mousemove', at(from + ((to - from) * step) / steps)));
    }
    await nextFrame();
    document.dispatchEvent(new MouseEvent('mouseup', at(to)));
    return Math.round(side.getBoundingClientRect().width) === to;
  }

  function click(selector) {
    const node = document.querySelector(selector);
    if (node === null)
      throw new Error(`押す所が無い: ${selector}`);
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    return true;
  }

  async function act(spec) {
    switch (spec.op) {
      // タブバーのタブ名をクリックする（tabs.js の onBarClick が受け取る）。
      case 'clickTab': return click(`#tabbar [data-tab-id="${spec.tabId}"] .name`);
      // ツールモードの中で帯をクリックした時と同じ（strip-input.js が tabs.activate を呼ぶ）。
      case 'activate': return SigK.tabs.activate(spec.tabId) !== false;
      // モード切り替えバーのボタンをクリックする。
      case 'clickMode': return click(`.rail-item[data-mode="${spec.mode}"]`);
      case 'dragSide': return dragSide(spec.to);
      default: throw new Error(`知らない操作: ${spec.op}`);
    }
  }

  // 操作の前後を見張る。描き終えて quietMs の間変わらなくなるか、watchMs が過ぎるまで。
  async function measure(spec, { watchMs, quietMs = 400 }) {
    const frames = [];
    let running = true;
    const started = performance.now();
    const before = new Set(visible().thumbs.map((item) => item.page));
    const isNew = (item) => spec.excludeNew === true && !before.has(item.page);
    const marker = document.createElement('div');
    marker.style.cssText = 'position:fixed;left:-20px;top:-20px;width:1px;height:1px;visibility:hidden;pointer-events:none';
    document.body.append(marker);
    const observer = new ResizeObserver(() => {
      if (!running)
        return;
      const state = visible();
      const empty = state.thumbs.filter((item) => item.state === 0);
      frames.push({ ms: performance.now() - started, emptyPages: state.pages.filter((value) => value === 0).length,
        emptyThumbs: empty.filter((item) => !isNew(item)).length, newThumbs: empty.filter(isNew).length, done: done(state) });
    });
    observer.observe(marker);
    let flip = false;
    const loop = () => {
      if (!running)
        return;
      flip = !flip;
      marker.style.width = flip ? '2px' : '1px';
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    await wait(60);
    const opAt = performance.now() - started;
    const ok = await act(spec);
    const switched = () => spec.tabId === undefined || SigK.tabs.activeId() === spec.tabId;
    let key = '';
    let since = performance.now();
    while (performance.now() - started < watchMs) {
      await nextFrame();
      const state = visible();
      const now = keyOf(state);
      if (now !== key) {
        key = now;
        since = performance.now();
      }
      if (switched() && done(state) && performance.now() - since >= quietMs)
        break;
    }
    running = false;
    observer.disconnect();
    marker.remove();
    const after = frames.filter((frame) => frame.ms > opAt);
    return {
      ok, frames: after.length, framesWithoutPicture: after.filter((frame) => frame.emptyPages > 0 || frame.emptyThumbs > 0).length,
      emptyPageFrames: after.filter((frame) => frame.emptyPages > 0).length, emptyThumbFrames: after.filter((frame) => frame.emptyThumbs > 0).length,
      newThumbFrames: after.filter((frame) => frame.newThumbs > 0).length,
      doneMs: round((after.find((frame) => frame.done)?.ms ?? Number.NaN) - opAt), settled: done(visible()), ...leftovers(),
    };
  }

  // ページ枠とサムネイル枠の描き終えた canvas（枠の直下）を全部、同じページ・同じ大きさで CPU で描き直した絵と比べる（⑤ の文字欠け）。
  // 戻り値の rows の要素: [種類 p（ページ枠）/t（サムネイル枠）, ページ番号, 描き直した絵の暗い画素, miss]。miss は、描き直した絵で暗い
  // （明るさ 96 未満）のに、表示している絵で明るい（200 を超える）画素の数。
  async function glyphScan() {
    const plan = SigK.viewer.getPlan();
    const items = [];
    for (const node of document.querySelectorAll('#view-pages > .pdf-page'))
      items.push(['p', node, node.querySelector(':scope > canvas')]);
    for (const node of document.querySelectorAll('#thumbs > .thumb'))
      items.push(['t', node, node.querySelector(':scope > .sheet > canvas')]);
    const lum = (data, at) => (data[at] + data[at + 1] + data[at + 2]) / 3;
    const rows = [];
    for (const [kind, node, canvas] of items) {
      const index = Number(node.dataset.page) - 1;
      const entry = plan[index];
      if (canvas === null || canvas.width === 0 || canvas.height === 0 || entry === undefined || Number.isInteger(entry.insert))
        continue;
      const page = await SigK.viewer.getPage(index + 1);
      if (page === null || page === undefined)
        continue;
      const rotation = (page.rotate ?? 0) + (entry.rotate ?? 0);
      const box = entry.crop ?? null;
      const unit = SigK.pageViewbox.viewportFor(page, { scale: 1, rotation, box });
      const viewport = SigK.pageViewbox.viewportFor(page, { scale: canvas.width / unit.width, rotation, box });
      const shown = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const fresh = document.createElement('canvas');
      fresh.width = canvas.width;
      fresh.height = canvas.height;
      const context = fresh.getContext('2d', { willReadFrequently: true });
      await page.render({ canvasContext: context, viewport }).promise;
      const reference = context.getImageData(0, 0, fresh.width, fresh.height).data;
      fresh.width = 0;
      fresh.height = 0;
      let dark = 0;
      let miss = 0;
      for (let at = 0; at < shown.length; at += 4) {
        const expected = lum(reference, at);
        if (expected < 128)
          dark += 1;
        if (expected < 96 && lum(shown, at) > 200)
          miss += 1;
      }
      rows.push([kind, index + 1, dark, miss]);
    }
    return rows;
  }

  window.__tabRepaint = { settle, act, measure, glyphScan };
  return true;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 文字欠けの記録を数える。
function countGlyphs(rows) {
  const count = (kind) => rows.filter((row) => row[0] === kind);
  const broken = (kind) => count(kind).filter((row) => glyphBroken(row[3], row[2]));
  return {
    pages: count('p').length, brokenPages: broken('p').length, thumbs: count('t').length, brokenThumbs: broken('t').length,
    broken: [...broken('p'), ...broken('t')].map((row) => `${row[0]}${row[1]}`),
  };
}

// 1 つの操作を見張り、描き終えた後に文字欠けを数える。
async function watchOp({ js }, spec) {
  await js('window.__tabRepaint.settle()');
  const renderer = await js(`window.__tabRepaint.measure(${JSON.stringify(spec)}, { watchMs: ${WATCH_MS} })`);
  const glyph = countGlyphs(await js('window.__tabRepaint.glyphScan()'));
  return { op: spec.label, ...renderer, glyph };
}

async function openTab(js, target, mode) {
  return js(`(async () => {
    const SigK = window.SigK;
    await SigK.tabs.openPath(${JSON.stringify(target)});
    SigK.shell.setMode(document, ${JSON.stringify(mode)});
    SigK.viewer.goToPage(0);
    await window.__tabRepaint.settle();
    return SigK.tabs.activeId();
  })()`);
}

// 見張らない準備の操作（モードを変える・ツールモードの中でタブを切り替える）。描き終えるまで待つ代わりに、決まった時間だけ待つ。
async function prepare(js, spec, ms = 800) {
  await js(`window.__tabRepaint.act(${JSON.stringify(spec)})`);
  await wait(ms);
}

// アプリ全体と画面（レンダラー）の実メモリ（MB）と、表示していないタブのために残した絵。
async function memoryOf(app, win, js) {
  const metrics = app.getAppMetrics();
  const mb = (entry) => Math.round((entry?.memory?.workingSetSize ?? 0) / 1024);
  const kept = await js('window.SigK.tabPictures?.stats?.() ?? null');
  return { totalMb: metrics.reduce((sum, entry) => sum + mb(entry), 0), rendererMb: mb(metrics.find((entry) => entry.pid === win.webContents.getOSProcessId())), kept };
}

async function run({ app, win, dir, root }) {
  fs.mkdirSync(dir, { recursive: true });
  const copy = (name, as) => {
    const target = path.join(dir, as);
    fs.copyFileSync(path.join(root, 'test', 'fixtures', name), target);
    return target;
  };
  const js = (script) => win.webContents.executeJavaScript(script);
  const ctx = { js };
  await js(`(${installWatch.toString()})()`);
  await js(`(() => { window.SigK.shell.setSidePanelWidth(document, 240); return true; })()`);
  const memory = { atStart: await memoryOf(app, win, js) };
  const ops = [];
  const watch = async (spec) => {
    const result = await watchOp(ctx, spec);
    ops.push({ case: spec.case, ...result });
  };

  // ① タブの切り替え（ページ編集モード 4 回・閲覧モード 2 回）。
  const three = await openTab(js, copy('three-pages.pdf', 'tab-three.pdf'), 'pages');
  const mixed = await openTab(js, copy('mixed-size.pdf', 'tab-mixed.pdf'), 'pages');
  for (let round = 1; round <= 2; round += 1) {
    await watch({ case: 'tabs', label: `ページ編集モードで three-pages.pdf へ（${round} 回目）`, op: 'clickTab', tabId: three });
    await watch({ case: 'tabs', label: `ページ編集モードで mixed-size.pdf へ（${round} 回目）`, op: 'clickTab', tabId: mixed });
  }
  await prepare(js, { op: 'clickMode', mode: 'view' });
  await watch({ case: 'tabs', label: '閲覧モードで three-pages.pdf へ', op: 'clickTab', tabId: three });
  await watch({ case: 'tabs', label: '閲覧モードで mixed-size.pdf へ', op: 'clickTab', tabId: mixed });

  // ② ツールモードから戻る。
  await prepare(js, { op: 'clickTab', tabId: three });
  for (const mode of ['pages', 'annot', 'view']) {
    await prepare(js, { op: 'clickMode', mode: 'tools' });
    await watch({ case: 'tools', label: `ツールモードから ${mode} へ`, op: 'clickMode', mode });
  }
  await prepare(js, { op: 'clickMode', mode: 'tools' });
  await prepare(js, { op: 'activate', tabId: mixed });
  await prepare(js, { op: 'activate', tabId: three });
  await watch({ case: 'tools', label: 'ツールモードの中でタブを切り替えてから pages へ', op: 'clickMode', mode: 'pages' });

  // ③ 左パネルの右端のドラッグ（ページ編集モード。240 → 300 → 340 → 180 → 240 px。2 → 2 → 3 → 1 → 2 列）。
  await openTab(js, copy('many-pages.pdf', 'tab-many.pdf'), 'pages');
  for (const to of [300, 340, 180, 240])
    await watch({ case: 'side', label: `左パネルの幅を ${to} px に`, op: 'dragSide', to, excludeNew: true });

  memory.atEnd = await memoryOf(app, win, js);
  await js(`(() => { for (const tab of window.SigK.tabs.list()) window.SigK.tabs.forceCloseTab(tab.id); window.SigK.shell.setMode(document, 'view'); return true; })()`);
  memory.afterClose = await memoryOf(app, win, js);
  const sum = (key) => ops.reduce((total, item) => total + item[key], 0);
  const glyphSum = (key) => ops.reduce((total, item) => total + item.glyph[key], 0);
  return {
    watchMs: WATCH_MS, memory, ops,
    // 合格の目安: どの操作でも、絵の無い枠が見えるフレームが 0（③ の、新しく見えるようになったサムネイルは除く）で、描き終えた後に前の絵を
    // 置く要素も 2 枚目の canvas も残らず、サムネイル枠の文字欠けが 0。
    total: {
      ops: ops.length,
      framesWithoutPicture: sum('framesWithoutPicture'),
      newThumbFrames: sum('newThumbFrames'),
      held: sum('held'),
      doubles: sum('doubles'),
      brokenThumbs: glyphSum('brokenThumbs'),
      thumbs: glyphSum('thumbs'),
      brokenPages: glyphSum('brokenPages'),
      pages: glyphSum('pages'),
      failedOps: ops.filter((item) => item.ok !== true || item.settled !== true).map((item) => item.op),
    },
  };
}

module.exports = { run, installWatch, glyphBroken, countGlyphs, MISS_PIXELS, MISS_RATIO };
