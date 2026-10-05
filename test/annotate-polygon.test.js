'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 多角形の道具（spec-4b-5a 確定事項13〜18・27・31）。頂点の置き方・閉じる・開いたまま・2 つなら直線・やめ方・確定のしかた。
// jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま .pdf-page 基準の CSS px になる。

const A = 'C:\\work\\a.pdf';
const SQUARE = { id: '30R', subtype: 'Square', rect: [300, 300, 400, 380], color: new Uint8ClampedArray([0, 0, 255]), borderStyle: { width: 4 }, opacity: 1 };

async function withPolygon(t) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: { 0: [SQUARE] } }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.document.querySelector('#edit-bar .edit-tool[data-shape="polygon"]').click();
  return shell;
}

function pageNode(shell, index = 0) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

function viewportOf(shell, index = 0) {
  return shell.SigK.viewer.getTextLayer(index).viewport;
}

function mouse(shell, type, target, x, y, extra = {}) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra });
  target.dispatchEvent(event);
  return event;
}

// 紙の座標の点で押して離す（index のページ）。
function click(shell, point, { index = 0, shift = false, button = 0 } = {}) {
  const [x, y] = viewportOf(shell, index).convertToViewportPoint(point[0], point[1]);
  mouse(shell, 'mousedown', pageNode(shell, index), x, y, { shiftKey: shift, button, buttons: button === 2 ? 2 : 1 });
  mouse(shell, 'mouseup', pageNode(shell, index), x, y, { shiftKey: shift, button });
}

function doubleClick(shell, point) {
  const [x, y] = viewportOf(shell).convertToViewportPoint(point[0], point[1]);
  click(shell, point);
  mouse(shell, 'dblclick', pageNode(shell), x, y);
}

function moveTo(shell, point) {
  const [x, y] = viewportOf(shell).convertToViewportPoint(point[0], point[1]);
  mouse(shell, 'mousemove', pageNode(shell), x, y);
}

const added = (shell) => shell.SigK.viewer.getAnnotations().added;
const near = (actual, expected, eps = 0.5) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} は ${expected} に近くない`);

test('道具の段の多角形で、クリックした所に頂点を置き、始点を押すと閉じて 1 世代積まれ、選ばれる。道具は持ったまま', async (t) => {
  const shell = await withPolygon(t);
  const { SigK, document } = shell;
  assert.equal(SigK.annotate.getTool(), 'shape');
  assert.equal(SigK.annotateShape.getShapeKind(), 'polygon');
  assert.match(document.getElementById('props-hint').textContent, /クリックで頂点を置きます/);
  click(shell, [100, 700]);
  assert.equal(SigK.annotatePolygon.isDrawing(), true);
  assert.match(document.getElementById('props-hint').textContent, /始点を押すと閉じます/);
  click(shell, [200, 700]);
  click(shell, [180, 600]);
  moveTo(shell, [120, 620]);
  const marks = pageNode(shell).querySelector('.annot-draft-marks');
  assert.equal(marks.querySelectorAll('circle.vertex').length, 3);
  assert.equal(marks.querySelectorAll('circle.ring').length, 1);
  assert.ok(marks.querySelector('line.next') !== null);
  assert.ok(pageNode(shell).querySelector('.annot-draft polyline') !== null, '置いた辺の下書き');
  assert.equal(added(shell).length, 0);
  click(shell, [101, 699]);
  assert.equal(SigK.annotatePolygon.isDrawing(), false);
  const [polygon] = added(shell);
  assert.equal(polygon.kind, 'polygon');
  assert.equal(polygon.closed, true);
  assert.equal(polygon.paths[0].length, 3);
  near(polygon.paths[0][1][0], 200);
  assert.equal(SigK.annotate.getSelected(), polygon.id);
  assert.equal(SigK.annotate.getTool(), 'shape');
  assert.equal(pageNode(shell).querySelector('.annot-draft-marks'), null);
  SigK.pageEdit.undo();
  assert.equal(added(shell).length, 0);
  assert.equal(SigK.pageEdit.canUndo(), false, '1 世代だけ');
});

test('1 つ目の頂点も、押してから少し引きずって離した所に置き、引きずっても文字を選ばない（spec-4b-5a 確定事項13）', async (t) => {
  const shell = await withPolygon(t);
  const { SigK } = shell;
  const [sx, sy] = viewportOf(shell).convertToViewportPoint(100, 700);
  const [ex, ey] = viewportOf(shell).convertToViewportPoint(110, 690);
  const down = mouse(shell, 'mousedown', pageNode(shell), sx, sy, { buttons: 1 });
  assert.equal(down.defaultPrevented, true);
  mouse(shell, 'mousemove', pageNode(shell), ex, ey, { buttons: 1 });
  mouse(shell, 'mouseup', pageNode(shell), ex, ey);
  assert.equal(SigK.annotatePolygon.isDrawing(), true);
  click(shell, [200, 690]);
  click(shell, [180, 600]);
  click(shell, [111, 689]);
  const [polygon] = added(shell);
  near(polygon.paths[0][0][0], 110);
  near(polygon.paths[0][0][1], 690);
});

test('ダブルクリックで開いたまま確定し、頂点が 2 つなら直線になる', async (t) => {
  const shell = await withPolygon(t);
  click(shell, [100, 700]);
  click(shell, [200, 700]);
  doubleClick(shell, [200, 600]);
  const [open] = added(shell);
  assert.equal(open.kind, 'polygon');
  assert.equal(open.closed, false);
  assert.equal(open.paths[0].length, 3, 'ダブルクリックの 2 回目の離しは重なって 1 つ');
  click(shell, [100, 500]);
  doubleClick(shell, [250, 450]);
  const line = added(shell)[1];
  assert.equal(line.kind, 'line');
  assert.equal(line.paths[0].length, 2);
});

test('Esc・右クリック・Ctrl+Z でやめ、Ctrl+Z では履歴を動かさない。右クリックのメニューは出さない', async (t) => {
  const shell = await withPolygon(t);
  const { SigK } = shell;
  click(shell, [100, 700]);
  click(shell, [200, 700]);
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(SigK.annotatePolygon.isDrawing(), false);
  assert.equal(SigK.annotate.getTool(), 'shape', 'Esc 1 回目は描きかけだけ');
  click(shell, [100, 700]);
  click(shell, [200, 700], { button: 2 });
  const [x, y] = viewportOf(shell).convertToViewportPoint(200, 700);
  pageNode(shell).dispatchEvent(new shell.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  assert.equal(SigK.annotatePolygon.isDrawing(), false);
  assert.equal(SigK.annotationMenu.isOpen(), false);
  // 描いていないときの書き込みの上の右クリックは、今までどおりメニューを出す（比べのため）
  const [sx, sy] = viewportOf(shell).convertToViewportPoint(350, 302);
  mouse(shell, 'mousedown', pageNode(shell), sx, sy, { button: 2, buttons: 2 });
  mouse(shell, 'mouseup', pageNode(shell), sx, sy, { button: 2 });
  pageNode(shell).dispatchEvent(new shell.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 2 }));
  assert.equal(SigK.annotationMenu.isOpen(), true);
  SigK.annotationMenu.close();
  // 先に 1 つ確定してから、描きかけで Ctrl+Z
  click(shell, [100, 700]);
  click(shell, [200, 700]);
  doubleClick(shell, [200, 600]);
  click(shell, [300, 700]);
  assert.equal(SigK.pageEdit.undo(), true);
  assert.equal(SigK.annotatePolygon.isDrawing(), false);
  assert.equal(added(shell).length, 1, '確定した多角形は残る');
});

test('道具を替えると置ける形なら開いたまま確定し、ほかのページの押し離しは無視する', async (t) => {
  const shell = await withPolygon(t);
  const { SigK, document } = shell;
  click(shell, [100, 700]);
  click(shell, [200, 700]);
  click(shell, [150, 700], { index: 1 });
  click(shell, [200, 600]);
  document.querySelector('#edit-bar .edit-tool[data-shape="square"]').click();
  assert.equal(SigK.annotatePolygon.isDrawing(), false);
  const [polygon] = added(shell);
  assert.equal(polygon.kind, 'polygon');
  assert.equal(polygon.closed, false);
  assert.equal(polygon.paths[0].length, 3);
  assert.equal(SigK.annotateShape.getShapeKind(), 'square');
});

test('描いていないときは書き込みの上の押し離しで選び、塗りと線なしは閉じた多角形にだけ当たる', async (t) => {
  const shell = await withPolygon(t);
  const { SigK } = shell;
  click(shell, [350, 302]);
  assert.equal(SigK.annotate.getSelected(), '30R');
  assert.equal(SigK.annotatePolygon.isDrawing(), false);
  SigK.annotate.select(null);
  assert.equal(SigK.annotate.setFill('#ffff00'), true);
  click(shell, [100, 700]);
  click(shell, [200, 700]);
  click(shell, [180, 600]);
  click(shell, [100, 700]);
  click(shell, [100, 500]);
  click(shell, [200, 500]);
  doubleClick(shell, [180, 400]);
  const [closed, open] = added(shell);
  assert.equal(closed.fill, '#ffff00');
  assert.equal(open.fill, undefined);
  assert.equal(typeof open.color, 'string');
});

test('選んだ多角形の頂点のつまみを引くとその頂点だけが動き、回転のつまみで回る。どちらも 1 世代（spec-4b-5a 確定事項22・23・26）', async (t) => {
  const shell = await withPolygon(t);
  const { SigK, document } = shell;
  click(shell, [100, 700]);
  click(shell, [200, 700]);
  click(shell, [180, 600]);
  click(shell, [100, 700]);
  const [polygon] = added(shell);
  assert.equal(document.getElementById('props-angle-row').hidden, false);
  assert.match(document.getElementById('props-hint').textContent, /頂点の白いつまみ/);
  const viewport = viewportOf(shell);
  const handles = SigK.shapeHandles.handlesOf(polygon, viewport).handles;
  const vertex = handles.find((handle) => handle.id === 'v1');
  mouse(shell, 'mousedown', pageNode(shell), ...vertex.at);
  mouse(shell, 'mousemove', document.body, vertex.at[0] + 30, vertex.at[1] + 20);
  mouse(shell, 'mouseup', pageNode(shell), vertex.at[0] + 30, vertex.at[1] + 20);
  const moved = SigK.annotate.selectedEntry();
  const target = viewport.convertToPdfPoint(vertex.at[0] + 30, vertex.at[1] + 20);
  near(moved.paths[0][1][0], target[0]);
  near(moved.paths[0][1][1], target[1]);
  assert.deepEqual(moved.paths[0][0], polygon.paths[0][0]);
  const rotate = SigK.shapeHandles.handlesOf(moved, viewport).handles.find((handle) => handle.kind === 'rotate');
  const center = viewport.convertToViewportPoint(...SigK.shapeRotation.centerOf(moved.rect));
  mouse(shell, 'mousedown', pageNode(shell), ...rotate.at);
  // 中心から見て上 → 右へ（時計回りに 90°）
  const radius = Math.hypot(rotate.at[0] - center[0], rotate.at[1] - center[1]);
  mouse(shell, 'mousemove', document.body, center[0] + radius, center[1]);
  mouse(shell, 'mouseup', pageNode(shell), center[0] + radius, center[1]);
  assert.equal(SigK.annotate.selectedEntry().angle, 90);
  SigK.pageEdit.undo();
  assert.equal(SigK.annotate.selectedEntry().angle, undefined);
  SigK.pageEdit.undo();
  assert.deepEqual(SigK.annotate.selectedEntry().paths, polygon.paths);
});
