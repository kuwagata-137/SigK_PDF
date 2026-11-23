'use strict';

// タブの切り替え・ツールモードから戻った時・左パネルの幅や列数の変更で、ページ枠とサムネイル枠が白くならない（docs/07 決定100 ①〜③）と、
// サムネイルの canvas を CPU で描く（決定100 ⑤）。前は、タブを移るとページとサムネイルの canvas を全部捨て（viewer.detach）、ツールモードでは
// 全部を手放し（page-render.js の update・thumbnails.refresh）、幅か列数が変わるとサムネイル枠を作り直していた（thumbnails.js の schedule）ので、
// 描き終えるまで白い背景が見えていた。今は、表示していた絵を同じページの新しい枠に置き、新しい絵を描き終えたら入れ替える。
// jsdom には 2D コンテキストが無いので、試験の中だけ「描ける」ことにする（plan-keep-picture.test.js と同じ作法）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

require('../renderer/page-plan.js');
require('../renderer/page-picture.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

// mode は 'pages'（ページ編集モード）か 'annot'（編集モード）か 'view'。どのファイルも pages ページ（A4）。
// contexts は、canvas → getContext に渡した options（決定100 ⑤ の確認）。
async function openShell(t, { mode = 'pages', pages = 5, ...options } = {}) {
  const pdfjs = createPdfjsStub({ sizes: Array.from({ length: pages }, () => A4) });
  const files = Object.fromEntries([A, B].map((filePath) => [filePath, makeSource({ path: filePath, size: 1024, mtimeMs: 1000 })]));
  const shell = await createShell({ pdfjs, files, ...options });
  t.after(() => shell.cleanup());
  const contexts = new Map();
  shell.window.CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
  shell.window.HTMLCanvasElement.prototype.getContext = function getContext(type, settings) {
    contexts.set(this, settings ?? null);
    return {};
  };
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, mode);
  await settle(shell);
  return { shell, pdfjs, contexts };
}

// 描き直しは requestAnimationFrame の後で、pdf.js の待ちを何段か挟む。
async function settle(shell) {
  await shell.flush();
  await shell.flush();
  await shell.flush();
}

// 開いている文書の getPage を、open() を呼ぶまで待たせる（描き終える前の枠を見るため）。
function holdPages(pdfjs) {
  let open = null;
  const ready = new Promise((resolve) => {
    open = resolve;
  });
  for (const document of pdfjs.documents) {
    const original = document.getPage;
    document.getPage = async (number) => {
      await ready;
      return original(number);
    };
  }
  return open;
}

const frames = (shell) => [...shell.document.querySelectorAll('#view-pages .pdf-page')];
const sheets = (shell) => [...shell.document.querySelectorAll('#thumbs .thumb > .sheet')];
// 枠に表示している絵（描き終えた絵か、前の絵を置く要素の中の絵）。無ければ null。
const pictureOf = (node) => node?.querySelector(':scope > canvas, :scope > .pdf-held > canvas') ?? null;
const pictures = (nodes) => nodes.map(pictureOf);
const heldOf = (node) => node?.querySelector(':scope > .pdf-held > canvas') ?? null;

// どの枠にも、絵は 1 枚まで（前の絵と新しい絵を重ねない）。
function assertOnePicture(shell, label) {
  for (const node of [...frames(shell), ...sheets(shell)])
    assert.ok(node.querySelectorAll('canvas').length <= 1, `${label}: 1 つの枠に絵が 2 枚ある`);
}

// 描き終えた後は、前の絵を置く要素が残らず、描いた枠には新しい絵が 1 枚だけある。
function assertSettled(shell, label) {
  assert.equal(shell.document.querySelectorAll('.pdf-held').length, 0, `${label}: 描き終えた後も前の絵が残っている`);
  assertOnePicture(shell, label);
}

// 操作の前に絵があった枠の数（試験の前提）。
function assertDrawn(shell) {
  assert.ok(pictureOf(frames(shell)[0]) !== null, '操作の前に 1 ページ目を描いていない（試験の前提が崩れた）');
  assert.ok(pictures(sheets(shell)).filter(Boolean).length >= 4, '操作の前にサムネイルを 4 枚以上描いていない（試験の前提が崩れた）');
}

// ---- ① タブの切り替え ----

test('createTabStore は文書ごとに 1 組を持ち、合計が上限を超えたら古く残した組から破棄する', () => {
  const store = globalThis.SigK.pagePicture.createTabStore({ budget: 100 });
  const a = {};
  const b = {};
  const c = {};
  assert.equal(store.put(a, 'a1', 40), true);
  assert.equal(store.put(b, 'b1', 40), true);
  assert.deepEqual(store.stats(), { tabs: 2, pixels: 80 });
  // 同じ文書は入れ替える。
  assert.equal(store.put(a, 'a2', 30), true);
  assert.deepEqual(store.stats(), { tabs: 2, pixels: 70 });
  // 合計が 120 になるので、古く残した b から破棄する。
  assert.equal(store.put(c, 'c1', 50), true);
  assert.deepEqual(store.stats(), { tabs: 2, pixels: 80 });
  assert.equal(store.take(b), null);
  // take は取り出して、残さない。
  assert.equal(store.take(a), 'a2');
  assert.equal(store.take(a), null);
  // 1 組で上限を超える絵と、画素の無い絵は残さない。
  assert.equal(store.put(b, 'big', 101), false);
  assert.equal(store.put(b, 'empty', 0), false);
  store.remove(c);
  assert.deepEqual(store.stats(), { tabs: 0, pixels: 0 });
});

test('タブを切り替えて戻った直後、ページ枠とサムネイル枠に、離れる前のそのタブの絵を表示する', async (t) => {
  const { shell } = await openShell(t);
  assertDrawn(shell);
  const idA = shell.SigK.tabs.activeId();
  const pagesA = pictures(frames(shell));
  const thumbsA = pictures(sheets(shell));

  await shell.SigK.tabs.openPath(B);
  await settle(shell);
  assert.equal(shell.SigK.tabPictures.stats().tabs, 1, '表示していないタブ a.pdf の絵を残していない');
  const fromB = new Set([...pictures(frames(shell)), ...pictures(sheets(shell))].filter(Boolean));

  shell.SigK.tabs.activate(idA);

  const pagesNow = pictures(frames(shell));
  const thumbsNow = pictures(sheets(shell));
  assert.equal(pagesNow[0], pagesA[0], '戻った直後に、見えている 1 ページ目に離れる前の絵が無い（白い背景が見える）');
  assert.ok(thumbsNow.filter(Boolean).length >= 4, '戻った直後に、サムネイル枠に離れる前の絵が無い');
  thumbsNow.forEach((canvas, index) => {
    if (canvas !== null)
      assert.equal(canvas, thumbsA[index], `${index + 1} ページ目のサムネイルに、離れる前の同じページの絵が無い`);
  });
  for (const canvas of [...pagesNow, ...thumbsNow])
    assert.ok(!fromB.has(canvas), '別のタブ（b.pdf）の絵を置いた');
  assertOnePicture(shell, '戻った直後');

  await settle(shell);
  assertSettled(shell, 'タブの切り替え');
  assert.notEqual(pictureOf(sheets(shell)[0]), thumbsA[0], 'サムネイルを描き直していない（文字欠けのある絵を残さないため、描き直す）');
  assert.equal(shell.SigK.tabPictures.stats().tabs, 1, '戻ったタブの絵を取り出していない、または b.pdf の絵を残していない');
});

test('表示していないタブを閉じると、そのタブのために残した絵を破棄する。作業中のタブを閉じる時は残さない', async (t) => {
  const { shell } = await openShell(t);
  const idA = shell.SigK.tabs.activeId();
  await shell.SigK.tabs.openPath(B);
  await settle(shell);
  const idB = shell.SigK.tabs.activeId();
  assert.equal(shell.SigK.tabPictures.stats().tabs, 1);

  // 作業中のタブ（b.pdf）を閉じる: b.pdf の絵は残さず、隣の a.pdf に戻る時に a.pdf の絵を取り出す。
  shell.SigK.tabs.forceCloseTab(idB);
  await settle(shell);
  assert.equal(shell.SigK.tabs.activeId(), idA);
  assert.deepEqual({ ...shell.SigK.tabPictures.stats() }, { tabs: 0, pixels: 0 }, '閉じた作業中のタブの絵を残した');

  // 表示していないタブを閉じる: そのタブのために残した絵を破棄する。
  await shell.SigK.tabs.openPath(B);
  await settle(shell);
  assert.equal(shell.SigK.tabPictures.stats().tabs, 1);
  shell.SigK.tabs.forceCloseTab(idA);
  await settle(shell);
  assert.deepEqual({ ...shell.SigK.tabPictures.stats() }, { tabs: 0, pixels: 0 }, '閉じたタブの絵を破棄していない');
});

test('detach は keep を付けた時（タブを移る時）だけ絵を残す', async (t) => {
  const { shell } = await openShell(t);
  const session = shell.SigK.viewer.detach();
  assert.deepEqual({ ...shell.SigK.tabPictures.stats() }, { tabs: 0, pixels: 0 }, 'keep なしで絵を残した');
  assert.equal(shell.SigK.viewer.attach(session), true);
  await settle(shell);
  const kept = shell.SigK.viewer.detach({ keep: true });
  assert.equal(shell.SigK.tabPictures.stats().tabs, 1, 'keep を付けても絵を残していない');
  assert.equal(shell.SigK.viewer.attach(kept), true);
  assert.equal(shell.SigK.tabPictures.stats().tabs, 0, '戻った時に残した絵を取り出していない');
  await settle(shell);
  assertSettled(shell, 'detach と attach');
});

// ---- ② ツールモードから戻った時 ----

test('ツールモードの間も見えているページの描き終えた絵を残し、範囲の外のページは手放す。戻った直後はサムネイル枠にも絵がある', async (t) => {
  const { shell } = await openShell(t);
  assertDrawn(shell);
  const pagesBefore = pictures(frames(shell));
  const thumbsBefore = pictures(sheets(shell));
  assert.ok(pagesBefore[1] !== null, '見えている範囲の外の 2 ページ目を先に描いていない（試験の前提が崩れた）');

  shell.SigK.shell.setMode(shell.document, 'tools');
  await settle(shell);
  assert.equal(pictureOf(frames(shell)[0]), pagesBefore[0], 'ツールモードで、見えているページの描き終えた絵を手放した');
  assert.equal(pictureOf(frames(shell)[1]), null, 'ツールモードで、見えている範囲の外のページの絵を手放していない');

  shell.SigK.shell.setMode(shell.document, 'pages');
  assert.equal(pictureOf(frames(shell)[0]), pagesBefore[0], 'ツールモードから戻った直後に、見えているページの絵が無い');
  const thumbsNow = pictures(sheets(shell));
  assert.ok(thumbsNow.filter(Boolean).length >= 4, 'ツールモードから戻った直後に、サムネイル枠に絵が無い（白い背景が見える）');
  thumbsNow.forEach((canvas, index) => {
    if (canvas !== null)
      assert.equal(canvas, thumbsBefore[index], `${index + 1} ページ目のサムネイルに、ツールモードに入る前の同じページの絵が無い`);
  });
  assertOnePicture(shell, 'ツールモードから戻った直後');

  await settle(shell);
  assertSettled(shell, 'ツールモードから戻った後');
});

// ---- ③ 左パネルの幅と列数 ----

test('左パネルの幅と列数を変えた時、描き終えるまでサムネイル枠に前の絵を表示し、描き終えたら前の絵は残らない', async (t) => {
  const { shell, pdfjs } = await openShell(t, { pages: 8 });
  assertDrawn(shell);
  const before = pictures(sheets(shell));
  const { columns } = shell.SigK.thumbnails.getState();
  const open = holdPages(pdfjs);

  shell.resizeSide(340);
  await shell.flush();
  assert.notEqual(shell.SigK.thumbnails.getState().columns, columns, '列数が変わっていない（試験の前提が崩れた）');
  const nodes = sheets(shell);
  let shown = 0;
  before.forEach((canvas, index) => {
    if (canvas === null)
      return;
    assert.equal(heldOf(nodes[index]), canvas, `${index + 1} ページ目のサムネイル枠に、前の絵が無い（白い背景が見える）`);
    shown += 1;
  });
  assert.ok(shown >= 4);
  assertOnePicture(shell, '幅を変えた直後');

  open();
  await settle(shell);
  assertSettled(shell, '幅と列数の変更');
});

// ---- ⑤ サムネイルの canvas を CPU で描く ----

test('サムネイルの canvas は CPU で描く（willReadFrequently）', async (t) => {
  const { shell, contexts } = await openShell(t);
  const thumbs = pictures(sheets(shell)).filter(Boolean);
  assert.ok(thumbs.length >= 4);
  for (const canvas of thumbs)
    assert.equal(contexts.get(canvas)?.willReadFrequently, true, 'サムネイルの canvas を CPU で描いていない');
});
