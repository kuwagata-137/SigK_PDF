'use strict';

// ✂ の盤の上で選んだページを引いて落とす（spec-2-5 確定事項G4。PR-4 の起草者の判断 I-k）。
// 盤で選んでいる範囲の上で押して引くと引いて落とす。選んでいないページから引いたら今どおりなぞって範囲を選ぶ。盤の中に落とすと並べ替え。
// 箱の末尾に落としたページはその箱に入る（✂ は落としたページの後ろへずれる）。
//
// jsdom は大きさを数えないので、盤の器の幅（640）と、盤を広げた帯と、その下の普通の帯の箱を差し替える。盤の位置は配置の計算から取る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, A4 } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top });

async function createBoardShell(t, { taskResults = [] } = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ sizes: Array.from({ length: 12 }, () => A4) }),
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) },
    taskResults,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  const { document } = shell;
  const scroll = document.getElementById('split-board-scroll');
  const strips = document.getElementById('strips');
  const canvas = document.getElementById('split-board-canvas');
  Object.defineProperty(scroll, 'clientWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(strips, 'clientHeight', { configurable: true, get: () => 3000 });
  strips.getBoundingClientRect = () => rect(0, 0, 640, 3000);
  canvas.getBoundingClientRect = () => rect(0, 0, 640, 2000);
  shell.SigK.shell.setMode(document, 'tools');
  shell.SigK.tools.select('split');
  await shell.SigK.tabs.openPath(B);
  await shell.SigK.tabs.openPath(A);
  for (let i = 0; i < 4; i += 1)
    await shell.flush();
  placeStrips(shell);
  return shell;
}

// 盤を広げた帯（a.pdf）は 0〜2000、その下の b.pdf の帯は 2100〜2288（紙の列は 40px 下・左端 10）、受け口は 2400〜2500。
function placeStrips(shell) {
  const [b, a] = [...shell.document.querySelectorAll('#strips .strip')];
  a.getBoundingClientRect = () => rect(0, 0, 640, 2000);
  b.getBoundingClientRect = () => rect(0, 2100, 640, 188);
  b.querySelector('.strip-pages').getBoundingClientRect = () => rect(10, 2140, 620, 140);
  shell.document.getElementById('strip-drop').getBoundingClientRect = () => rect(0, 2400, 640, 100);
}

const plain = (value) => structuredClone(value);
const ids = (shell) => shell.SigK.tabs.list().map((tab) => tab.id);
const srcs = (shell, id) => plain(shell.SigK.tabs.peek(id).plan).map((page) => page.src ?? `i${page.insert}`);
const cuts = (shell) => plain(shell.SigK.toolsSplitEdit.board().cuts);
const range = (shell) => plain(shell.SigK.splitSelection.range(shell.SigK.toolsSplitEdit.selection()));
const pageNode = (shell, page) => shell.document.querySelector(`.sb-page[data-page="${page}"]`);
const placed = (shell) => shell.SigK.splitBoardView.layout();
const pageRect = (shell, page) => shell.SigK.splitLayout.pageRect(placed(shell), page);

function centerOf(shell, page) {
  const box = pageRect(shell, page);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function pointer(shell, type, target, { x, y }, { shift = false } = {}) {
  const Ctor = shell.window.PointerEvent ?? shell.window.MouseEvent;
  target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: shift }));
}

function press(shell, page, { shift = false } = {}) {
  const point = centerOf(shell, page);
  pointer(shell, 'pointerdown', pageNode(shell, page), point, { shift });
  pointer(shell, 'pointerup', pageNode(shell, page), point, { shift });
  pageNode(shell, page).dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, detail: 1, shiftKey: shift }));
}

// from..to を選び、from を押して引き、(x, y) で離す。
function dragSelected(shell, from, to, { x, y }) {
  press(shell, from);
  if (to !== from)
    press(shell, to, { shift: true });
  const start = centerOf(shell, from);
  pointer(shell, 'pointerdown', pageNode(shell, from), start);
  pointer(shell, 'pointermove', shell.document, { x: start.x + 8, y: start.y });
  assert.equal(shell.SigK.stripDrag.isDragging(), true, '選んでいる範囲から引くと引いて落とす');
  pointer(shell, 'pointermove', shell.document, { x, y });
  pointer(shell, 'pointerup', shell.document, { x, y });
}

// page の紙の左の間（盤の座標）。
const before = (shell, page) => ({ x: pageRect(shell, page).x - 5, y: centerOf(shell, page).y });
// page の紙の右の間。
const after = (shell, page) => ({ x: pageRect(shell, page).x + pageRect(shell, page).width + 5, y: centerOf(shell, page).y });

test('盤で選んでいる範囲から引いて盤の中に落とすと並べ替え、✂ の数は変わらない', async (t) => {
  const shell = await createBoardShell(t);
  const [, a] = ids(shell);
  shell.SigK.toolsSplitEdit.cut(4);
  await shell.flush();
  assert.deepEqual(cuts(shell), [4]);
  dragSelected(shell, 6, 7, before(shell, 1));
  await shell.flush();
  assert.deepEqual(srcs(shell, a), [0, 6, 7, 1, 2, 3, 4, 5, 8, 9, 10, 11]);
  assert.deepEqual(cuts(shell), [6], '✂ は前のページ（元の 4 ページ目）の後ろに付いていく');
});

test('選んでいないページから引くと、今どおりなぞって範囲を選ぶ', async (t) => {
  const shell = await createBoardShell(t);
  press(shell, 2);
  const start = centerOf(shell, 5);
  pointer(shell, 'pointerdown', pageNode(shell, 5), start);
  pointer(shell, 'pointermove', shell.document, centerOf(shell, 7));
  assert.equal(shell.SigK.stripDrag.isDragging(), false);
  assert.deepEqual(range(shell), { from: 5, to: 7 });
});

test('箱の末尾に落としたページはその箱に入り、次の箱の先頭に落としたページは次の箱に入る', async (t) => {
  const shell = await createBoardShell(t);
  const [, a] = ids(shell);
  shell.SigK.toolsSplitEdit.cut(4);
  await shell.flush();
  dragSelected(shell, 8, 9, after(shell, 3));
  await shell.flush();
  assert.deepEqual(srcs(shell, a), [0, 1, 2, 3, 8, 9, 4, 5, 6, 7, 10, 11]);
  assert.deepEqual(cuts(shell), [6], '1 つ目の箱の末尾に入る');

  shell.SigK.toolsSplitEdit.undo();
  shell.SigK.pageEdit.undo();
  await shell.flush();
  assert.deepEqual(srcs(shell, a), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  dragSelected(shell, 8, 9, before(shell, 4));
  await shell.flush();
  assert.deepEqual(srcs(shell, a), [0, 1, 2, 3, 8, 9, 4, 5, 6, 7, 10, 11]);
  assert.deepEqual(cuts(shell), [4], '2 つ目の箱の先頭に入る');
});

// 4 ページ目と 5 ページ目の間に ✂（箱 1 = 1〜4 ページ目、箱 2 = 5〜12 ページ目）。✂ の直前のページを動かしても、動かしたページは落とした先の箱、
// ほかのページは元の箱に入る（点検の指摘 1）。
const range12 = (from, to) => Array.from({ length: to - from + 1 }, (_page, offset) => from + offset);

test('✂ の直前のページを含めてほかの箱の末尾へ動かすと、その箱に入り、元の箱は残る', async (t) => {
  const shell = await createBoardShell(t);
  const [, a] = ids(shell);
  shell.SigK.toolsSplitEdit.cut(4);
  await shell.flush();
  dragSelected(shell, 2, 3, after(shell, 11));
  await shell.flush();
  assert.deepEqual(srcs(shell, a), [0, 1, ...range12(4, 11), 2, 3]);
  assert.deepEqual(cuts(shell), [2], '箱 1 = 1・2 ページ目、箱 2 = 5〜12・3・4 ページ目');
});

test('✂ の直前のページをほかの箱の途中へ動かしても、間のページは元の箱のまま', async (t) => {
  const shell = await createBoardShell(t);
  const [, a] = ids(shell);
  shell.SigK.toolsSplitEdit.cut(4);
  await shell.flush();
  dragSelected(shell, 3, 3, before(shell, 6));
  await shell.flush();
  assert.deepEqual(srcs(shell, a), [0, 1, 2, 4, 5, 3, ...range12(6, 11)]);
  assert.deepEqual(cuts(shell), [3], '箱 1 = 1〜3 ページ目、箱 2 = 5・6・4・7〜12 ページ目');
});

test('✂ の直前のページを同じ箱の先頭へ動かしても、✂ は動かない', async (t) => {
  const shell = await createBoardShell(t);
  const [, a] = ids(shell);
  shell.SigK.toolsSplitEdit.cut(4);
  await shell.flush();
  dragSelected(shell, 3, 3, before(shell, 0));
  await shell.flush();
  assert.deepEqual(srcs(shell, a), [3, 0, 1, 2, ...range12(4, 11)]);
  assert.deepEqual(cuts(shell), [4]);
});

test('盤の中で動かしたあとの Ctrl+Z・Ctrl+Y は、並びと ✂ をそのまま戻し・進める（点検の指摘 4）', async (t) => {
  const shell = await createBoardShell(t);
  const [, a] = ids(shell);
  shell.SigK.toolsSplitEdit.cut(4);
  await shell.flush();
  dragSelected(shell, 11, 11, after(shell, 3));
  await shell.flush();
  assert.deepEqual(cuts(shell), [5]);
  shell.SigK.toolHistory.undo();
  await shell.flush();
  assert.deepEqual(srcs(shell, a), range12(0, 11));
  assert.deepEqual(cuts(shell), [4]);
  shell.SigK.toolHistory.redo();
  await shell.flush();
  assert.deepEqual(srcs(shell, a), [0, 1, 2, 3, 11, ...range12(4, 10)]);
  assert.deepEqual(cuts(shell), [5], '進めても ✂ が消えない');

  // ✂ の直前のページを末尾へ動かした場合（並びのずらし方では ✂ が範囲の外へ出る）も、戻すと ✂ が戻る。
  shell.SigK.toolHistory.undo();
  await shell.flush();
  dragSelected(shell, 2, 3, after(shell, 11));
  await shell.flush();
  shell.SigK.toolHistory.undo();
  await shell.flush();
  assert.deepEqual(srcs(shell, a), range12(0, 11));
  assert.deepEqual(cuts(shell), [4]);
  shell.SigK.toolHistory.redo();
  await shell.flush();
  assert.deepEqual(cuts(shell), [2]);
});

// 保存などの処理を走らせたままにする（終わらないワーカー）。走っている間、帯と盤の押しは効かない（I21。点検の指摘 2）。
function holdBusy(shell) {
  shell.window.taskAPI.run = () => new Promise(() => {});
  shell.SigK.save.runTask({ kind: 'copy-pages', label: 'ページの写しを用意' });
  assert.equal(shell.SigK.save.isBusy(), true);
}

test('処理が走っている間は、盤の選んだ範囲から引いても引いて落とさない', async (t) => {
  const shell = await createBoardShell(t);
  const [, a] = ids(shell);
  press(shell, 2);
  press(shell, 3, { shift: true });
  holdBusy(shell);
  const start = centerOf(shell, 2);
  pointer(shell, 'pointerdown', pageNode(shell, 2), start);
  pointer(shell, 'pointermove', shell.document, { x: start.x + 8, y: start.y });
  pointer(shell, 'pointermove', shell.document, before(shell, 0));
  assert.equal(shell.SigK.stripDrag.isDragging(), false);
  pointer(shell, 'pointerup', shell.document, before(shell, 0));
  await shell.flush();
  assert.deepEqual(srcs(shell, a), range12(0, 11));
});

test('引いている途中で処理が走り始めたら、離しても並べ替えない', async (t) => {
  const shell = await createBoardShell(t);
  const [, a] = ids(shell);
  press(shell, 2);
  const start = centerOf(shell, 2);
  pointer(shell, 'pointerdown', pageNode(shell, 2), start);
  pointer(shell, 'pointermove', shell.document, { x: start.x + 8, y: start.y });
  assert.equal(shell.SigK.stripDrag.isDragging(), true);
  holdBusy(shell);
  pointer(shell, 'pointermove', shell.document, before(shell, 0));
  pointer(shell, 'pointerup', shell.document, before(shell, 0));
  await shell.flush();
  assert.deepEqual(srcs(shell, a), range12(0, 11));
  assert.equal(shell.SigK.stripDrag.isDragging(), false);
});

test('盤からほかの帯へ落とすと写し、枠と盤は引き始めた帯のまま', async (t) => {
  const shell = await createBoardShell(t, { taskResults: [{ ok: true, bytes: new Uint8Array(PDF), pages: 2, sizes: [A4, A4] }] });
  const [b, a] = ids(shell);
  dragSelected(shell, 2, 3, { x: 20, y: 2200 });
  await shell.flush();
  assert.equal(shell.taskCalls[0].spec.kind, 'copy-pages');
  assert.deepEqual(plain(shell.taskCalls[0].spec.pages).map((page) => page.src), [2, 3]);
  assert.deepEqual(srcs(shell, b).slice(0, 3), ['i0', 'i1', 0]);
  assert.deepEqual(srcs(shell, a), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(shell.SigK.tabs.activeId(), a);
  assert.equal(shell.SigK.splitStrip.hostId(), a);
  assert.deepEqual(range(shell), { from: 2, to: 3 }, '盤の選択も残る（I7）。続けて別の所へ引ける');

  // 写した先の帯を Ctrl+Z で戻しても（その帯を一時的に映して戻す）、盤の選択は外さない。
  shell.SigK.toolHistory.undo();
  await shell.flush();
  assert.deepEqual(srcs(shell, b), Array.from({ length: 12 }, (_page, index) => index));
  assert.deepEqual(range(shell), { from: 2, to: 3 });
});
