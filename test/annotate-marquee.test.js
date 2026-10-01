'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 「選択」の道具の範囲選択（spec-4b-3a 確定事項D）。箱の計算そのものは annotation-marquee.test.js が見る。
// jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま .pdf-page 基準の CSS px になる。

const A = 'C:\\work\\a.pdf';

// 1 ページ目に読み込んだハイライト（12R）と他のツールの直線（17R。表示のみ）。
const IMPORTED = {
  0: [
    { id: '12R', subtype: 'Highlight', rect: [48, 300, 232, 310], quadPoints: [48, 310, 232, 310, 48, 300, 232, 300], color: new Uint8ClampedArray([255, 228, 90]), opacity: 1 },
    { id: '17R', subtype: 'Line', rect: [298, 298, 402, 312], color: new Uint8ClampedArray([255, 0, 0]), contentsObj: { str: '' }, titleObj: { str: '' }, lineCoordinates: [300, 300, 400, 310], lineEndings: ['None', 'None'] },
  ],
};

async function withShell(t) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: IMPORTED }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  await shell.SigK.annotationImport.settled();
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]');
}

function px(shell, point) {
  return shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
}

function mouse(shell, type, target, [x, y], { ctrl = false, shift = false } = {}) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1, ctrlKey: ctrl, shiftKey: shift });
  target.dispatchEvent(event);
  return event;
}

function drawSquare(shell, from, to) {
  const { SigK } = shell;
  const tool = SigK.annotate.getTool();
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, from));
  mouse(shell, 'mousemove', shell.document.body, px(shell, to));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, to));
  SigK.annotate.setTool(tool);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

// 「選択」の道具で、紙の pt の from から to まで引く。release=false なら離さない。
function sweep(shell, from, to, { release = true, ...keys } = {}) {
  const down = mouse(shell, 'mousedown', pageNode(shell), px(shell, from), keys);
  mouse(shell, 'mousemove', shell.document.body, px(shell, to), keys);
  if (release)
    mouse(shell, 'mouseup', pageNode(shell), px(shell, to), keys);
  return down;
}

const selection = (shell) => [...shell.SigK.annotate.getSelection()];

test('「選択」の道具で引いた枠に完全に収まった書き込みを、描く順に選ぶ（確定事項D4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  drawSquare(shell, [100, 500], [200, 400]);
  SigK.annotate.setTool('select');
  const down = sweep(shell, [80, 720], [420, 580]);
  assert.equal(down.defaultPrevented, true, '文字の選択を始めさせない');
  assert.deepEqual(selection(shell), [a, b]);
  assert.equal(SigK.annotate.primaryKey(), b);
});

test('枠からはみ出す書き込みは選ばない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  drawSquare(shell, [300, 700], [400, 600]);
  SigK.annotate.setTool('select');
  sweep(shell, [80, 720], [350, 580]);
  assert.deepEqual(selection(shell), [a]);
});

test('表示のみの書き込みは選ばず、マークアップは外接が収まれば選ぶ（確定事項D4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('select');
  sweep(shell, [20, 330], [450, 280]);
  assert.deepEqual(selection(shell), ['12R']);
});

test('引いている間は .pdf-page の中に枠が出て、離すと消える（確定事項D3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('select');
  sweep(shell, [100, 700], [300, 500], { release: false });
  const div = pageNode(shell).querySelector('.annot-marquee');
  assert.notEqual(div, null);
  const [x1, y1] = px(shell, [100, 700]);
  const [x2, y2] = px(shell, [300, 500]);
  assert.equal(div.style.left, `${x1}px`);
  assert.equal(div.style.width, `${x2 - x1}px`);
  assert.equal(div.style.height, `${y2 - y1}px`);
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [300, 500]));
  assert.equal(pageNode(shell).querySelector('.annot-marquee'), null);
});

test('素で始めると前の選択を外し、押しただけなら外したまま。Ctrl で押しただけなら変えない（確定事項D2・D5）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.setTool('select');
  SigK.annotate.select(a);
  sweep(shell, [400, 300], [401, 301], { ctrl: true });
  assert.deepEqual(selection(shell), [a]);
  sweep(shell, [400, 300], [401, 301]);
  assert.deepEqual(selection(shell), []);
});

test('Ctrl か Shift を押して始めると、囲んだものを今の選択に足す（確定事項D2）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  const c = drawSquare(shell, [100, 500], [200, 400]);
  SigK.annotate.setTool('select');
  SigK.annotate.select(a);
  sweep(shell, [280, 720], [420, 580], { ctrl: true });
  assert.deepEqual(selection(shell), [a, b]);
  sweep(shell, [80, 520], [220, 380], { shift: true });
  assert.deepEqual(selection(shell), [a, b, c]);
});

test('Esc で取りやめると枠が消え、押す前の選択に戻る（確定事項D6）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  drawSquare(shell, [300, 700], [400, 600]);
  SigK.annotate.setTool('select');
  SigK.annotate.select(a);
  sweep(shell, [280, 720], [420, 580], { release: false });
  assert.deepEqual(selection(shell), [], '素で始めたので押した時点で外れる');
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(pageNode(shell).querySelector('.annot-marquee'), null);
  assert.deepEqual(selection(shell), [a]);
  assert.equal(SigK.annotate.getTool(), 'select', 'Esc 1 回目は取りやめだけ');
});

test('Ctrl+Z が来たら範囲選択を取りやめる（確定事項L3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.setTool('select');
  sweep(shell, [80, 720], [420, 580], { release: false });
  SigK.pageEdit.undo();
  assert.equal(SigK.annotateMarquee.isActive(), false);
  assert.equal(pageNode(shell).querySelector('.annot-marquee'), null);
});

test('回した四角は回した外接で見る（回す前の箱だけを囲んでも選ばない。確定事項D4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [200, 600], [400, 500]);
  SigK.annotate.select(a);
  assert.equal(SigK.annotationAngleRow.setAngle(45), true);
  SigK.annotate.select(null);
  SigK.annotate.setTool('select');
  sweep(shell, [195, 605], [405, 495]);
  assert.deepEqual(selection(shell), [], '回す前の箱だけでは収まらない');
  sweep(shell, [140, 700], [460, 400]);
  assert.equal(selection(shell).length, 1);
});

test('「選択」の道具を持っていなければ、書き込みの無い所を引いても範囲選択にならない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  drawSquare(shell, [100, 700], [200, 600]);
  sweep(shell, [80, 720], [420, 580], { release: false });
  assert.equal(SigK.annotateMarquee.isActive(), false);
  assert.equal(pageNode(shell).querySelector('.annot-marquee'), null);
});
