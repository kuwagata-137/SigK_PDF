'use strict';

// 「変換する画像」の帯の画像を横に引いて並べ替える（spec-2-5 確定事項H6）。image-strip-drag.js。
//
// jsdom は大きさを数えないので、画像の枠の rect を差し替える（幅 104px・間 12px。strips.css と image-strip.js の ITEM_STEP）。
// 引いて落とす基本と、実行中に引けないことは test/tools-convert.test.js が見ている。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const DIR = 'C:\\photo';
const A = `${DIR}\\a.png`;
const B = `${DIR}\\b.jpg`;
const C = `${DIR}\\c.png`;
const PDF = `${DIR}\\x.pdf`;

const INFOS = {
  [A]: { kind: 'png', width: 1200, height: 800 },
  [B]: { kind: 'jpeg', width: 600, height: 900 },
  [C]: { kind: 'png', width: 64, height: 64 },
};

async function createDragShell(t) {
  const shell = await createShell({ files: { [PDF]: makeSource({ path: PDF }) }, imageInfos: INFOS });
  t.after(() => shell.cleanup());
  await shell.flush();
  await shell.SigK.tabs.openPath(PDF);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('convert');
  await shell.SigK.toolsConvert.addPaths([A, B, C]);
  return shell;
}

const items = (shell) => [...shell.document.querySelectorAll('#image-strip .img-item')];
const names = (shell) => structuredClone(shell.SigK.toolsConvert.rows().map((row) => row.name));
const line = (shell) => shell.document.querySelector('#image-strip-items .img-drop-line');

// 画像の枠を左から 116px おきに置く（1 枚目は 0〜104、真ん中は 52）。
function placeItems(shell) {
  items(shell).forEach((node, index) => {
    const left = index * shell.SigK.imageStrip.ITEM_STEP;
    node.getBoundingClientRect = () => ({ left, right: left + 104, width: 104, top: 0, bottom: 72, height: 72, x: left, y: 0 });
  });
}

function startDrag(shell, index, x) {
  placeItems(shell);
  shell.firePointer(items(shell)[index], 'pointerdown', { x, y: 5 });
}

test('落とす先は、画像の真ん中を越えた枚数で決まる', async (t) => {
  const shell = await createDragShell(t);
  placeItems(shell);
  const at = (x) => shell.SigK.imageStripDrag.dropIndexFor(x);
  assert.deepEqual([at(10), at(51), at(52), at(167), at(168), at(284), at(400)], [0, 0, 1, 1, 2, 3, 3]);
});

test('4px 動くまでは引き始めず、引いている間は落とす先に線を出し、離すとその位置へ動かす', async (t) => {
  const shell = await createDragShell(t);
  const { SigK, document: doc } = shell;
  startDrag(shell, 0, 10);
  shell.firePointer(doc, 'pointermove', { x: 10 + SigK.imageStripDrag.DRAG_THRESHOLD - 1, y: 5 });
  assert.equal(SigK.imageStripDrag.isDragging(), false);
  assert.equal(line(shell), null);

  shell.firePointer(doc, 'pointermove', { x: 10 + SigK.imageStripDrag.DRAG_THRESHOLD, y: 5 });
  assert.equal(SigK.imageStripDrag.isDragging(), true);
  assert.equal(items(shell)[0].classList.contains('dragging'), true);
  shell.firePointer(doc, 'pointermove', { x: 180, y: 5 });
  assert.notEqual(line(shell), null);

  shell.firePointer(doc.getElementById('image-strip-items'), 'pointerup', { x: 180, y: 5 });
  assert.deepEqual(names(shell), ['b.jpg', 'a.png', 'c.png']);
  assert.equal(SigK.imageStripDrag.isDragging(), false);
  assert.equal(line(shell), null, '線を片付ける');
});

test('画像の帯の外で離すと、並びを変えない', async (t) => {
  const shell = await createDragShell(t);
  const { document: doc } = shell;
  startDrag(shell, 0, 10);
  shell.firePointer(doc, 'pointermove', { x: 300, y: 5 });
  shell.firePointer(doc.body, 'pointerup', { x: 300, y: 5 });
  assert.deepEqual(names(shell), ['a.png', 'b.jpg', 'c.png']);
  assert.equal(shell.SigK.imageStripDrag.isDragging(), false);
});

test('［×］の上で押しても引き始めない', async (t) => {
  const shell = await createDragShell(t);
  placeItems(shell);
  shell.firePointer(items(shell)[0].querySelector('.img-x'), 'pointerdown', { x: 100, y: 5 });
  shell.firePointer(shell.document, 'pointermove', { x: 300, y: 5 });
  assert.equal(shell.SigK.imageStripDrag.isDragging(), false);
});

test('引いている途中の Esc は取りやめるだけで、Esc の振り分けへ流さない（帯の紙の選択は残る。確定事項H6）', async (t) => {
  const shell = await createDragShell(t);
  const { SigK, document: doc } = shell;
  const tabId = SigK.tabs.list()[0].id;
  const cell = doc.querySelector('#strips .strip .strip-page');
  cell.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual([...SigK.stripSelection.get(tabId)], [0]);

  startDrag(shell, 0, 10);
  shell.firePointer(doc, 'pointermove', { x: 180, y: 5 });
  const esc = () => {
    const event = new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    doc.body.dispatchEvent(event);
    return event;
  };
  assert.equal(esc().defaultPrevented, true);
  assert.equal(SigK.imageStripDrag.isDragging(), false);
  assert.equal(line(shell), null);
  assert.deepEqual([...SigK.stripSelection.get(tabId)], [0], 'Esc 1 回で取りやめるのは 1 つだけ');
  shell.firePointer(doc.getElementById('image-strip-items'), 'pointerup', { x: 180, y: 5 });
  assert.deepEqual(names(shell), ['a.png', 'b.jpg', 'c.png'], '取りやめたあとに離しても動かさない');

  esc();
  assert.deepEqual([...SigK.stripSelection.get(tabId)], [], '次の Esc で紙の選択が外れる');
});

// 点検で見つかった（2026-10-15）。タッチやペンで引くと、離した合図（pointerup）の代わりに取りやめの合図（pointercancel）が来る。
// 前は引いている途中のまま残り、ボタンを押さずに動かしても線が付いてきて、次のクリックで並びが変わった（ページ編集の page-grid.js・✂ の盤と同じにする）。
test('取りやめの合図（pointercancel）が来たら引くのをやめ、そのあとボタンを押さずに動かして離しても並びを変えない', async (t) => {
  const shell = await createDragShell(t);
  const { SigK, document: doc } = shell;
  const strip = doc.getElementById('image-strip-items');
  startDrag(shell, 0, 10);
  shell.firePointer(doc, 'pointermove', { x: 180, y: 5 });
  shell.firePointer(items(shell)[0], 'pointercancel', { x: 180, y: 5 });
  assert.equal(SigK.imageStripDrag.isDragging(), false);
  assert.equal(line(shell), null, '線を片付ける');
  assert.equal(items(shell)[0].classList.contains('dragging'), false);
  shell.firePointer(doc, 'pointermove', { x: 300, y: 5 });
  shell.firePointer(strip, 'pointerup', { x: 300, y: 5 });
  assert.deepEqual(names(shell), ['a.png', 'b.jpg', 'c.png']);

  startDrag(shell, 0, 10);
  shell.firePointer(items(shell)[0], 'pointercancel', { x: 10, y: 5 });
  shell.firePointer(doc, 'pointermove', { x: 300, y: 5 });
  assert.equal(SigK.imageStripDrag.isDragging(), false, '引き始める前に取りやめが来たときも、押した控えを残さない');
});

test('引いている途中に窓が非活性になったら引くのをやめ、そのあと離しても並びを変えない', async (t) => {
  const shell = await createDragShell(t);
  const { SigK, document: doc } = shell;
  startDrag(shell, 0, 10);
  shell.firePointer(doc, 'pointermove', { x: 180, y: 5 });
  shell.window.dispatchEvent(new shell.window.Event('blur'));
  assert.equal(SigK.imageStripDrag.isDragging(), false);
  assert.equal(line(shell), null);
  shell.firePointer(doc.getElementById('image-strip-items'), 'pointerup', { x: 180, y: 5 });
  assert.deepEqual(names(shell), ['a.png', 'b.jpg', 'c.png']);
});
