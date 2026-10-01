'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 同じ選択のまま同じ欄を続けて変えたら、Ctrl+Z 1 回で変え始める前に戻る（spec-4b-3a 確定事項J。決定53 ②）。
// 世代の差し替えそのものは edit-history.test.js（amendTop）が見る。

const A = 'C:\\work\\a.pdf';

const IMPORTED = {
  0: [
    { id: '40R', subtype: 'Square', rect: [399, 199, 501, 301], color: new Uint8ClampedArray([0, 0, 255]), borderStyle: { width: 2 }, hasAppearance: true },
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

const pageNode = (shell) => shell.document.querySelector('.pdf-page[data-page="1"]');
const px = (shell, point) => shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);

function mouse(shell, type, target, [x, y]) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
}

function drawSquare(shell, from, to) {
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, from));
  mouse(shell, 'mousemove', shell.document.body, px(shell, to));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, to));
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

const at = (shell) => shell.SigK.pageEdit.getHistoryState().at;
const entry = (shell, key) => shell.SigK.annotationState.findAnnot(shell.SigK.viewer.getAnnotations(), shell.SigK.viewer.getImported(), key);

test('1 件を選んだまま線の色を続けて変えると 1 世代で、Ctrl+Z 1 回で変え始める前に戻る（確定事項J1）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  const original = entry(shell, a).color;
  const start = at(shell);
  SigK.annotate.setColor('#ff0000');
  SigK.annotate.setColor('#0000ff');
  SigK.annotate.setColor('#00aa00');
  assert.equal(at(shell), start + 1);
  assert.equal(entry(shell, a).color, '#00aa00');
  SigK.pageEdit.undo();
  assert.equal(entry(shell, a).color, original);
  assert.equal(SigK.annotate.getSelected(), a);
  SigK.pageEdit.redo();
  assert.equal(entry(shell, a).color, '#00aa00');
});

test('線なしは線の色と同じ欄として畳む。別の欄（塗り）を変えたら別の世代（確定事項J1）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  const start = at(shell);
  SigK.annotate.setFill('#ffee00');
  SigK.annotate.setFill('#ffaa00');
  assert.equal(at(shell), start + 1);
  SigK.annotate.setColor('#ff0000');
  SigK.annotate.setStrokeNone();
  assert.equal(at(shell), start + 2);
  SigK.annotate.setLineWidth(8);
  SigK.annotate.setLineWidth(12);
  SigK.annotate.setOpacity(0.5);
  SigK.annotate.setOpacity(0.3);
  assert.equal(at(shell), start + 4);
});

test('選択が替わったら、同じ欄でも別の世代（確定事項J2）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  SigK.annotate.select(a);
  const start = at(shell);
  SigK.annotate.setColor('#ff0000');
  SigK.annotate.select(b);
  SigK.annotate.setColor('#0000ff');
  assert.equal(at(shell), start + 2);
});

test('取り消し・やり直しや保存を挟んだら、続けて変えても別の世代（確定事項J4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  SigK.annotate.setColor('#ff0000');
  SigK.pageEdit.undo();
  SigK.pageEdit.redo();
  const start = at(shell);
  SigK.annotate.setColor('#0000ff');
  assert.equal(at(shell), start + 1);
  SigK.viewer.markSaved();
  SigK.annotate.setColor('#00aa00');
  assert.equal(at(shell), start + 2);
});

test('試してから元の値に戻したら、その世代ごと落ちる（確定事項J3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  const original = entry(shell, a).color;
  const start = at(shell);
  SigK.annotate.setColor('#ff0000');
  SigK.annotate.setColor(original);
  assert.equal(at(shell), start);
  assert.equal(SigK.viewer.isDirty(), true, '描いた四角そのものは保存していない');
});

test('複数を選んだまま続けて変えても 1 世代で、Ctrl+Z で全部と複数選択が戻る（確定事項J1・L）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  SigK.annotate.selectKeys([a, b]);
  const start = at(shell);
  SigK.annotate.setLineStyle('dashed');
  SigK.annotate.setLineStyle('cloudy');
  assert.equal(at(shell), start + 1);
  SigK.pageEdit.undo();
  assert.equal(entry(shell, a).lineStyle ?? 'solid', 'solid');
  assert.equal(entry(shell, b).lineStyle ?? 'solid', 'solid');
  assert.deepEqual([...SigK.annotate.getSelection()], [a, b]);
});

test('読み込んだ書き込みは 1 回目で写しに替わっても、続けた変更は 1 世代に畳む', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.select('40R');
  const start = at(shell);
  SigK.annotate.setColor('#ff0000');
  const copy = SigK.annotate.getSelected();
  assert.notEqual(copy, '40R');
  SigK.annotate.setColor('#00aa00');
  assert.equal(at(shell), start + 1);
  SigK.pageEdit.undo();
  assert.equal(SigK.annotate.getSelected(), '40R');
  assert.equal(SigK.viewer.getAnnotations().removed.includes('40R'), false);
});

test('テキストの文字の大きさも、続けて変えたら 1 世代', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('text');
  const [x, y] = px(shell, [100, 500]);
  mouse(shell, 'mousedown', pageNode(shell), [x, y]);
  mouse(shell, 'mouseup', pageNode(shell), [x, y]);
  const editor = document.querySelector('textarea.free-text-editor');
  editor.value = 'あいう';
  editor.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  editor.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  SigK.annotate.setTool(null);
  const text = SigK.viewer.getAnnotations().added.at(-1).id;
  SigK.annotate.select(text);
  const start = at(shell);
  SigK.annotate.setFontSize(18);
  SigK.annotate.setFontSize(24);
  assert.equal(at(shell), start + 1);
});
