'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 書き込みツールを切り替えた時の選択の解除（docs/spec-7-10-shape-tools.md。決定102 ⑩）。別の書き込みツール（図形の種類の切り替えを含む）に
// 切り替えると選択を解除し、［選択］［ハンド］と、書き込みツールなしに戻した時は解除しない。

const A = 'C:\\work\\a.pdf';

async function withShell(t) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function mouse(shell, type, target, [x, y]) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
}

function barButton(shell, name) {
  return shell.document.querySelector(`#edit-bar .edit-tool[data-shape="${name}"]`) ?? shell.document.querySelector(`#edit-bar .edit-tool[data-tool="${name}"]`);
}

// 編集ツールバーの［四角］で四角を描く。描いた四角は選択したまま。
function drawSquare(shell) {
  const { SigK, document } = shell;
  const node = document.querySelector('.pdf-page[data-page="1"]');
  const px = (point) => SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
  barButton(shell, 'square').click();
  mouse(shell, 'mousedown', node, px([100, 700]));
  mouse(shell, 'mousemove', document.body, px([200, 600]));
  mouse(shell, 'mouseup', node, px([200, 600]));
  const id = SigK.viewer.getAnnotations().added.at(-1).id;
  assert.equal(SigK.annotate.getSelected(), id);
  return id;
}

test('図形の種類を切り替える（四角 → 丸）と、選択を解除し、プロパティパネルは丸の次に追加する書き込みの値を表示する', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  drawSquare(shell);
  barButton(shell, 'circle').click();
  assert.equal(SigK.annotate.getTool(), 'shape');
  assert.equal(SigK.annotate.getShapeKind(), 'circle');
  assert.equal(SigK.annotate.getSelected(), null);
  assert.equal(document.getElementById('props-kind').textContent, '丸（次に追加する書き込み）');
});

test('別の書き込みツール（ペン・マーキング・テキスト・消しゴム）に切り替えると、選択を解除する', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  for (const tool of ['pen', 'marking', 'text', 'eraser']) {
    const id = drawSquare(shell);
    barButton(shell, tool).click();
    assert.equal(SigK.annotate.getTool(), tool);
    assert.equal(SigK.annotate.getSelected(), null, `${tool} に切り替えた後（${id}）`);
  }
});

test('ツールバーの［選択］［ハンド］に切り替えた時は、選択を解除しない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const id = drawSquare(shell);
  document.getElementById('btn-pointer-hand').click();
  assert.equal(SigK.annotate.getTool(), 'hand');
  assert.equal(SigK.annotate.getSelected(), id);
  document.getElementById('btn-pointer-select').click();
  assert.equal(SigK.annotate.getTool(), 'select');
  assert.equal(SigK.annotate.getSelected(), id);
});

test('同じ書き込みツールのボタンをもう一度押して、書き込みツールなしに戻した時は、選択を解除しない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const id = drawSquare(shell);
  barButton(shell, 'square').click();
  assert.equal(SigK.annotate.getTool(), null);
  assert.equal(SigK.annotate.getSelected(), id);
});

test('［選択］で書き込みを選択してから書き込みツールを選ぶと、選択を解除する', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const id = drawSquare(shell);
  document.getElementById('btn-pointer-select').click();
  SigK.annotate.select(id);
  barButton(shell, 'arrow').click();
  assert.equal(SigK.annotate.getShapeKind(), 'arrow');
  assert.equal(SigK.annotate.getSelected(), null);
});
