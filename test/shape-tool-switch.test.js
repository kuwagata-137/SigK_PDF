'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 図形の書き込みツールを切り替えた時の、プロパティパネルの値と描く書き込み（決定102 ⑨・質問 SH7 案B。図 screenshots/question-sh7-tool-memory.png）。
// 質問 SH7 案B「見た目の値をすべて、四角・丸・直線・矢印・×印・多角形の書き込みツールごとに記憶する。丸に切り替えると、丸で前に
// 使った値（線の太さも）に戻る。ペンの線の太さは図形と別に記憶する。」

const A = 'C:\\work\\a.pdf';

async function withShell(t, ui) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) }, ...(ui ? { ui } : {}) });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function draw(shell, from, to) {
  const { SigK, document } = shell;
  const node = document.querySelector('.pdf-page[data-page="1"]');
  const px = (point) => SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
  const mouse = (type, target, [x, y]) => target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  mouse('mousedown', node, px(from));
  mouse('mousemove', document.body, px(to));
  mouse('mouseup', node, px(to));
  return SigK.viewer.getAnnotations().added.at(-1);
}

function panel(document) {
  return {
    color: document.getElementById('props-color-name').textContent,
    fill: document.getElementById('props-fill-name').textContent,
    width: document.getElementById('props-width').value,
  };
}

test('四角で選んだ線の色・塗りつぶし・線の太さは四角にだけ記憶し、丸に切り替えると丸の値、四角に戻すと四角の値になる', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  SigK.annotate.setColor('#0070c0');
  SigK.annotate.setFill('#ffff00');
  SigK.annotate.setLineWidth(8);
  const square = draw(shell, [100, 700], [200, 600]);
  assert.deepEqual([square.color, square.fill, square.lineWidth], ['#0070c0', '#ffff00', 8]);
  SigK.annotate.select(null);
  SigK.annotate.setShapeKind('circle');
  assert.deepEqual(panel(document), { color: '#FF0000', fill: 'なし', width: '2' }, '丸は既定の値');
  SigK.annotate.setLineWidth(2);
  const circle = draw(shell, [300, 700], [400, 600]);
  assert.deepEqual([circle.kind, circle.color, circle.fill ?? null, circle.lineWidth], ['circle', '#ff0000', null, 2]);
  SigK.annotate.select(null);
  SigK.annotate.setShapeKind('square');
  assert.deepEqual(panel(document), { color: '#0070C0', fill: '#FFFF00', width: '8' }, '四角に戻すと四角で前に使った値');
});

test('ペンの線の太さは図形と別に記憶する', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('pen');
  SigK.annotate.setLineWidth(5);
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('arrow');
  SigK.annotate.setLineWidth(9);
  assert.deepEqual([SigK.annotate.getLineWidth('ink'), SigK.annotate.getLineWidth('arrow'), SigK.annotate.getLineWidth('line')], [5, 9, 2]);
  assert.equal(shell.uiCalls.some((patch) => patch.annotLineWidth === 5), true, 'ペンは今までどおり annotLineWidth');
  assert.equal(shell.uiCalls.some((patch) => patch.annotShapeStyles?.arrow?.lineWidth === 9), true);
});

test('起動時に種類ごとの値が無ければ、版 1.4.0 までの共有の値を 6 つの書き込みツールへ転記し、切り替えた直後は今までと同じ値で描く', async (t) => {
  const shell = await withShell(t, { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotColors: { shape: '#00b050' }, annotLineWidth: 6 });
  const { SigK } = shell;
  for (const kind of ['square', 'circle', 'line', 'arrow', 'cross', 'polygon']) {
    assert.equal(SigK.annotate.colorOf(kind), '#00b050', kind);
    assert.equal(SigK.annotate.getLineWidth(kind), 6, kind);
  }
  assert.equal(SigK.annotate.getLineWidth('ink'), 6, 'ペンは共有の値のまま');
});
