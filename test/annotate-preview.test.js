'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 線の太さと不透明度のスライダーの下見（spec-4b-1b 確定事項8）。動かしている間は履歴に積まずに描き直し、離すと 1 世代積む。
// Esc・選択の変更・別の欄の操作で下見を捨てる。

const A = 'C:\\work\\a.pdf';

async function withSquare(t) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({}),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.SigK.annotate.setTool('shape');
  shell.SigK.annotate.setShapeKind('square');
  const page = shell.document.querySelector('.pdf-page[data-page="1"]');
  const viewport = shell.SigK.viewer.getTextLayer(0).viewport;
  const fire = (type, target, [x, y]) => target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  const [start, end] = [[100, 700], [300, 600]].map((point) => viewport.convertToViewportPoint(point[0], point[1]));
  fire('mousedown', page, start);
  fire('mousemove', shell.document.body, end);
  fire('mouseup', page, end);
  return shell;
}

// 選んでいる四角の <g class="shape"> の属性。
function shapeOf(shell) {
  const id = shell.SigK.annotate.getSelected();
  return shell.document.querySelector(`.pdf-page[data-page="1"] .annot-layer g[data-annot="${id}"]`);
}

function input(shell, rangeId, value) {
  const range = shell.document.getElementById(rangeId);
  range.value = String(value);
  range.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
}

test('太さのスライダーを動かしている間は下見で描き、離すと 1 世代だけ積む', async (t) => {
  const shell = await withSquare(t);
  const { SigK, document } = shell;
  const before = SigK.viewer.getAnnotations();
  input(shell, 'props-width-range', 6);
  input(shell, 'props-width-range', 9);
  assert.equal(SigK.annotatePreview.isActive(), true);
  const scale = SigK.viewer.getTextLayer(0).viewport.scale;
  assert.equal(shapeOf(shell).querySelector('g.shape').getAttribute('stroke-width'), String(Math.round(9 * scale * 100) / 100));
  assert.equal(document.getElementById('props-width').value, '9', '数値欄も動く');
  assert.equal(SigK.annotationState.sameAnnots(before, SigK.viewer.getAnnotations()), true, '動かしている間は積まない');
  document.getElementById('props-width-range').dispatchEvent(new shell.window.Event('change', { bubbles: true }));
  assert.equal(SigK.annotatePreview.isActive(), false);
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).lineWidth, 9);
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).lineWidth, 2, 'Ctrl+Z 1 回で戻る');
});

test('不透明度の下見は Esc で捨て、選択を替えても捨てる', async (t) => {
  const shell = await withSquare(t);
  const { SigK, document } = shell;
  input(shell, 'props-opacity-range', 40);
  assert.equal(shapeOf(shell).getAttribute('opacity'), '0.4');
  document.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(SigK.annotatePreview.isActive(), false);
  assert.equal(shapeOf(shell).getAttribute('opacity'), null, '下見を捨てて元の絵に戻る');
  assert.notEqual(SigK.annotate.getSelected(), null, 'Esc は下見を捨てるだけで、選択は残す');
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).opacity, 1);
  input(shell, 'props-opacity-range', 30);
  SigK.annotate.select(null);
  assert.equal(SigK.annotatePreview.isActive(), false);
  assert.equal(SigK.pageEdit.canUndo(), true, '積まれているのは描いた 1 世代だけ');
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
});

test('別の欄に移ると下見を捨て、何も選んでいなければ下見はしない', async (t) => {
  const shell = await withSquare(t);
  const { SigK, document } = shell;
  input(shell, 'props-width-range', 12);
  document.getElementById('props-opacity').dispatchEvent(new shell.window.FocusEvent('focusin', { bubbles: true }));
  assert.equal(SigK.annotatePreview.isActive(), false);
  SigK.annotate.select(null);
  assert.equal(SigK.annotatePreview.update('lineWidth', 5), false);
  const entry = { id: 'x', kind: 'square', lineWidth: 2, rect: [0, 0, 10, 10] };
  assert.equal(SigK.annotatePreview.previewFor(entry), entry, '下見が無ければそのまま');
  assert.equal(SigK.annotatePreview.update('fontSize', 5), false);
});
