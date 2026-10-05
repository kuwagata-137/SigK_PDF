'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 線の始点合わせ（spec-4b-5a 確定事項19・31）。直線・矢印の道具で、書き込みの端・角・頂点の近くをダブルクリックすると、そこを始点に
// して、次に離した所を終点にする。jsdom はレイアウトしないので、clientX/Y がそのまま .pdf-page 基準の CSS px になる。

const A = 'C:\\work\\a.pdf';
const SQUARE = { id: '30R', subtype: 'Square', rect: [300, 300, 400, 380], color: new Uint8ClampedArray([0, 0, 255]), borderStyle: { width: 4 }, opacity: 1 };

async function withLine(t, shape = 'line') {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: { 0: [SQUARE] } }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.document.querySelector(`#edit-bar .edit-tool[data-shape="${shape}"]`).click();
  return shell;
}

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]');
}

function view(shell, point) {
  return shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
}

function mouse(shell, type, point, extra = {}) {
  const [x, y] = view(shell, point);
  pageNode(shell).dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra }));
}

function click(shell, point, extra = {}) {
  mouse(shell, 'mousedown', point, { buttons: 1, ...extra });
  mouse(shell, 'mouseup', point, extra);
}

function doubleClick(shell, point) {
  click(shell, point);
  click(shell, point);
  mouse(shell, 'dblclick', point);
}

const added = (shell) => shell.SigK.viewer.getAnnotations().added;

test('直線の道具で四角の角の近くをダブルクリックすると、その角を始点にして下見し、次に離した所までの直線を置く', async (t) => {
  const shell = await withLine(t);
  const { SigK, document } = shell;
  assert.match(document.getElementById('props-hint').textContent, /端や角をダブルクリック/);
  doubleClick(shell, [402, 378]);
  assert.equal(SigK.annotateLineAnchor.isActive(), true);
  assert.equal(SigK.annotate.getSelected(), null);
  assert.match(document.getElementById('props-hint').textContent, /押した所までの線を引きます/);
  mouse(shell, 'mousemove', [500, 450]);
  assert.ok(pageNode(shell).querySelector('.annot-draft line') !== null, '下書きの線');
  click(shell, [500, 450]);
  assert.equal(SigK.annotateLineAnchor.isActive(), false);
  const line = added(shell).at(-1);
  assert.equal(line.kind, 'line');
  assert.deepEqual([...line.paths[0][0]], [400, 380]);
  assert.deepEqual([...line.paths[0][1]], [500, 450]);
  assert.equal(SigK.annotate.getSelected(), line.id);
});

test('矢印の道具でも引け、Shift で 45° 刻み。始点から 3px 以内なら置かずに終える', async (t) => {
  const shell = await withLine(t, 'arrow');
  const { SigK } = shell;
  doubleClick(shell, [300, 300]);
  click(shell, [400, 210], { shiftKey: true });
  const arrow = added(shell).at(-1);
  assert.equal(arrow.kind, 'arrow');
  assert.equal(arrow.head, undefined, '新しい矢印は塗った三角');
  const [[x1, y1], [x2, y2]] = arrow.paths[0];
  assert.ok(Math.abs(Math.abs(x2 - x1) - Math.abs(y2 - y1)) < 0.05, '45°');
  const count = added(shell).length;
  doubleClick(shell, [400, 300]);
  click(shell, [401, 301]);
  assert.equal(SigK.annotateLineAnchor.isActive(), false);
  assert.equal(added(shell).length, count);
});

test('Esc・右クリック・道具の切り替えでやめ、吸い付く点の無い所のダブルクリックでは始めない', async (t) => {
  const shell = await withLine(t);
  const { SigK, document } = shell;
  doubleClick(shell, [150, 150]);
  assert.equal(SigK.annotateLineAnchor.isActive(), false);
  doubleClick(shell, [300, 380]);
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(SigK.annotateLineAnchor.isActive(), false);
  assert.equal(SigK.annotate.getTool(), 'shape');
  doubleClick(shell, [300, 380]);
  mouse(shell, 'mousedown', [350, 350], { button: 2, buttons: 2 });
  assert.equal(SigK.annotateLineAnchor.isActive(), false);
  doubleClick(shell, [300, 380]);
  document.querySelector('#edit-bar .edit-tool[data-shape="square"]').click();
  assert.equal(SigK.annotateLineAnchor.isActive(), false);
  assert.equal(added(shell).length, 0);
});
