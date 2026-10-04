'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/shape-rotation.js');
require('../renderer/callout-tail.js');
const { withTextShell, clickAt, typeText, pageNode, plain } = require('./text-helpers.js');

// 吹き出しのしっぽの先のつまみ（spec-4b-4b 確定事項C3・F）。jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、
// clientX/Y がそのまま .pdf-page 基準の CSS px になる。

const tail = globalThis.SigK.calloutTail;
const rotation = globalThis.SigK.shapeRotation;
// 倍率 2・ページの高さ 800 の表示（紙の y は上向き）。
const VIEWPORT = {
  convertToViewportPoint: (x, y) => [x * 2, (800 - y) * 2],
  convertToPdfPoint: (x, y) => [x / 2, 800 - y / 2],
};
const CALLOUT = { kind: 'text', rect: [100, 670, 200, 700], rotation: 0, fontSize: 10, fill: '#ffffff', borderColor: '#c00000', borderWidth: 2, tip: [125, 650] };

function near(actual, expected, eps = 0.011) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= eps, `${actual} ≠ ${expected}`));
}

test('handleOf は先に白いつまみ（id・種類とも tip、カーソルは move）を置き、吹き出しでなければ null', () => {
  assert.deepEqual(tail.handleOf(CALLOUT, VIEWPORT), { id: 'tip', kind: 'tip', at: [250, 300], cursor: 'move' });
  assert.equal(tail.handleOf({ ...CALLOUT, tip: undefined }, VIEWPORT), null);
  assert.equal(tail.handleOf({ ...CALLOUT, readonly: true }, VIEWPORT), null);
  // 回した吹き出しは、回した先に置く。
  const turned = { ...CALLOUT, angle: 90 };
  const at = tail.handleOf(turned, VIEWPORT).at;
  near(at, VIEWPORT.convertToViewportPoint(...rotation.rotatePoint(CALLOUT.tip, [150, 685], 90)));
});

test('tipPatch は引いた差を紙の座標へ直して先に足し、押した点のずれを持ち込まない（確定事項F1）', () => {
  // 先から 4px ずれた点を押して、右へ 20px・下へ 10px（紙で右へ 10・下へ 5）。
  assert.deepEqual(tail.tipPatch(CALLOUT, [254, 300], [274, 310], VIEWPORT), { tip: [135, 645] });
  assert.equal(tail.tipPatch({ ...CALLOUT, tip: undefined }, [0, 0], [1, 1], VIEWPORT), null);
});

test('Shift は画面での差の大きい方の向きだけを残す（画面の横か縦。確定事項F1）', () => {
  assert.deepEqual(tail.tipPatch(CALLOUT, [250, 300], [270, 306], VIEWPORT, { shift: true }), { tip: [135, 650] });
  assert.deepEqual(tail.tipPatch(CALLOUT, [250, 300], [244, 340], VIEWPORT, { shift: true }), { tip: [125, 630] });
});

test('回した吹き出しは、紙の上で引いた先を回す前の座標へ戻して持つ（回して描くと引いた点に来る）', () => {
  const turned = { ...CALLOUT, angle: 30 };
  const press = tail.handleOf(turned, VIEWPORT).at;
  const point = [press[0] + 40, press[1] - 16];
  const { tip } = tail.tipPatch(turned, press, point, VIEWPORT);
  near(rotation.rotatePoint(tip, rotation.centerOf(turned.rect), 30), VIEWPORT.convertToPdfPoint(...point));
  // Shift で横だけ動かすと、紙の上の先は横にだけ動く（回した軸ではなく画面の横）。
  const locked = tail.tipPatch(turned, press, [press[0] + 40, press[1] - 16], VIEWPORT, { shift: true }).tip;
  const onPaper = rotation.rotatePoint(locked, rotation.centerOf(turned.rect), 30);
  near(onPaper, VIEWPORT.convertToPdfPoint(press[0] + 40, press[1]));
});

// ---- 画面の流れ ----

function mouse(shell, type, target, [x, y], extra = {}) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra }));
}

function placeCallout(shell, x, y, text) {
  shell.SigK.annotate.setTool('callout');
  clickAt(shell, x, y);
  typeText(shell, text);
  shell.SigK.freeTextEditor.finish();
  return shell.SigK.annotate.selectedEntry();
}

function tipHandle(shell) {
  return shell.SigK.annotationFrame.shown().shape.handles.find((handle) => handle.id === 'tip');
}

test('選んだ吹き出しの先に白いつまみが出て、引くと下見し、離すと 1 世代で先が変わる（確定事項C3・F2）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  const entry = placeCallout(shell, 100, 700, 'あいう');
  const handle = tipHandle(shell);
  assert.ok(handle !== undefined);
  assert.equal(document.querySelectorAll('.annot-handle[data-handle="tip"]').length, 1);
  const scale = SigK.viewer.getTextLayer(0).viewport.scale;
  const at = SigK.pageEdit.getHistoryState().at;
  mouse(shell, 'mousedown', pageNode(shell), handle.at);
  mouse(shell, 'mousemove', document.body, [handle.at[0] + 30 * scale, handle.at[1] + 10 * scale]);
  assert.equal(document.documentElement.getAttribute('data-transform-cursor'), 'move');
  assert.deepEqual(plain(SigK.viewer.getAnnotations().added[0].tip), plain(entry.tip), '引いている間は書き込みを変えない');
  mouse(shell, 'mousemove', document.body, [handle.at[0] + 40 * scale, handle.at[1] + 20 * scale]);
  mouse(shell, 'mouseup', pageNode(shell), [handle.at[0] + 40 * scale, handle.at[1] + 20 * scale]);
  const moved = SigK.annotate.selectedEntry();
  near(moved.tip, [entry.tip[0] + 40, entry.tip[1] - 20]);
  assert.deepEqual(plain(moved.rect), plain(entry.rect), '箱は動かない');
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  SigK.pageEdit.undo();
  assert.deepEqual(plain(SigK.viewer.getAnnotations().added[0].tip), plain(entry.tip));
});

test('先のつまみは Shift で横か縦にだけ動き、Esc で取りやめる（確定事項F1・F2）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  const entry = placeCallout(shell, 100, 700, 'あいう');
  const scale = SigK.viewer.getTextLayer(0).viewport.scale;
  let handle = tipHandle(shell);
  mouse(shell, 'mousedown', pageNode(shell), handle.at);
  const to = [handle.at[0] + 50 * scale, handle.at[1] + 12 * scale];
  mouse(shell, 'mousemove', document.body, to, { shiftKey: true });
  mouse(shell, 'mouseup', pageNode(shell), to, { shiftKey: true });
  near(SigK.annotate.selectedEntry().tip, [entry.tip[0] + 50, entry.tip[1]]);
  handle = tipHandle(shell);
  const at = SigK.pageEdit.getHistoryState().at;
  mouse(shell, 'mousedown', pageNode(shell), handle.at);
  mouse(shell, 'mousemove', document.body, [handle.at[0] - 60, handle.at[1] + 60]);
  document.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  mouse(shell, 'mouseup', pageNode(shell), [handle.at[0] - 60, handle.at[1] + 60]);
  assert.equal(SigK.pageEdit.getHistoryState().at, at, '取りやめは積まない');
  near(SigK.annotate.selectedEntry().tip, [entry.tip[0] + 50, entry.tip[1]]);
});

test('先のつまみは角・幅のつまみと重なっても先に当たり、回転のつまみには譲る（確定事項C3）', async (t) => {
  const shell = await withTextShell(t);
  const handles = shell.SigK.shapeHandles;
  const list = [
    { id: 'right', kind: 'width', at: [10, 10] }, { id: 'tip', kind: 'tip', at: [12, 10] }, { id: 'rotate', kind: 'rotate', at: [30, 30] },
  ];
  assert.equal(handles.handleAt(list, [10, 10]).id, 'tip');
  assert.equal(handles.handleAt([...list, { id: 'rotate', kind: 'rotate', at: [11, 10] }], [11, 10]).id, 'rotate');
});

test('回した吹き出しの先のつまみは回した先にあり、引いた先が回して描いた位置に来る', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  placeCallout(shell, 100, 700, 'あいう');
  SigK.annotationAngleRow.setAngle(45);
  const turned = SigK.annotate.selectedEntry();
  assert.equal(turned.angle, 45);
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const handle = tipHandle(shell);
  near(handle.at, viewport.convertToViewportPoint(...tail.tipOnPaper(turned)), 0.02);
  const to = [handle.at[0] + 24, handle.at[1] - 36];
  mouse(shell, 'mousedown', pageNode(shell), handle.at);
  mouse(shell, 'mousemove', document.body, to);
  mouse(shell, 'mouseup', pageNode(shell), to);
  const moved = SigK.annotate.selectedEntry();
  near(viewport.convertToViewportPoint(...tail.tipOnPaper(moved)), to, 0.05);
  assert.equal(moved.angle, 45);
});

test('回した吹き出しの幅のつまみ・文字の大きさで箱が変わっても、先は紙の上で動かない（確定事項B3。決定59 ②）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  placeCallout(shell, 100, 700, 'あいうえおかきくけこさしすせそ');
  SigK.annotationAngleRow.setAngle(60);
  const before = tail.tipOnPaper(SigK.annotate.selectedEntry());
  const width = SigK.annotate.selectedEntry().rect[2] - SigK.annotate.selectedEntry().rect[0];
  const right = SigK.annotationFrame.shown().shape.handles.find((handle) => handle.id === 'right');
  // 60° 回した表示の右の向き (cos 60°, sin 60°) の逆へ 40px 引いて狭める。
  const to = [right.at[0] - 40 * Math.cos(Math.PI / 3), right.at[1] - 40 * Math.sin(Math.PI / 3)];
  mouse(shell, 'mousedown', pageNode(shell), right.at);
  mouse(shell, 'mousemove', document.body, to);
  mouse(shell, 'mouseup', pageNode(shell), to);
  const narrowed = SigK.annotate.selectedEntry();
  assert.ok(narrowed.rect[2] - narrowed.rect[0] < width, '幅が狭まった');
  near(tail.tipOnPaper(narrowed), before, 0.02);
  assert.equal(SigK.annotateTextStyle.setFontSize(20), true);
  near(tail.tipOnPaper(SigK.annotate.selectedEntry()), before, 0.02);
});
