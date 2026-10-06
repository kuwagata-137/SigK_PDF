'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// マーカーの道具（spec-4b-5b 確定事項1〜6・29〜32）。乗算のペン（kind: 'ink' に blend: 'multiply'）を描き、色・太さ・不透明度は
// マーカーの値として覚える（太さは図形・ペンと別）。描き方・保存・読み戻しそのものは shape-*・appearance-blend のテストが見る。

const A = 'C:\\work\\a.pdf';

async function withShell(t, options = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub(options.stub ?? {}),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

async function withTool(t, tool, options = {}) {
  const shell = await withShell(t, options);
  shell.SigK.annotate.setTool(tool);
  return shell;
}

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]');
}

function mouse(shell, type, target, [x, y]) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
}

// pt の点をなぞる（押す → 動かす → 離す）。
function trace(shell, points) {
  const viewport = shell.SigK.viewer.getTextLayer(0).viewport;
  const px = (point) => viewport.convertToViewportPoint(point[0], point[1]);
  mouse(shell, 'mousedown', pageNode(shell), px(points[0]));
  for (const point of points.slice(1))
    mouse(shell, 'mousemove', shell.document.body, px(point));
  mouse(shell, 'mouseup', pageNode(shell), px(points.at(-1)));
}

const plain = (value) => structuredClone(value);

test('マーカーの道具でなぞると、黄・12pt・100% の乗算のペンが 1 つでき、描いている途中も乗算', async (t) => {
  const shell = await withTool(t, 'marker');
  const { SigK, document } = shell;
  assert.equal(document.documentElement.getAttribute('data-tool'), 'marker');
  assert.equal(document.querySelector('#edit-bar [data-tool="marker"]').getAttribute('aria-pressed'), 'true');
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const px = (point) => viewport.convertToViewportPoint(point[0], point[1]);
  mouse(shell, 'mousedown', pageNode(shell), px([100, 700]));
  mouse(shell, 'mousemove', document.body, px([200, 705]));
  assert.equal(document.querySelector('.annot-layer .annot-draft').getAttribute('class'), 'annot-draft marker');
  mouse(shell, 'mouseup', pageNode(shell), px([300, 700]));
  const added = SigK.viewer.getAnnotations().added;
  assert.equal(added.length, 1);
  assert.equal(added[0].kind, 'ink');
  assert.equal(added[0].blend, 'multiply');
  assert.equal(added[0].color, '#ffff00');
  assert.equal(added[0].lineWidth, 12);
  assert.equal(added[0].opacity, 1);
  assert.equal(document.querySelector(`.annot-layer g[data-annot="${added[0].id}"]`).getAttribute('class'), 'marker');
  // ペンの道具はふつうのペンのまま。
  SigK.annotate.setTool('pen');
  trace(shell, [[100, 500], [200, 505], [300, 500]]);
  const pen = SigK.viewer.getAnnotations().added.at(-1);
  assert.equal(pen.blend, undefined);
  assert.equal(pen.lineWidth, 2);
  assert.equal(pen.color, '#c00000');
});

test('マーカーの道具で太さ・色・不透明度を変えるとマーカーの値として覚え、ペン・図形の値は変わらない', async (t) => {
  const shell = await withTool(t, 'marker');
  const { SigK } = shell;
  assert.equal(SigK.annotate.setLineWidth(20), true);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotMarkerWidth: 20 });
  assert.equal(SigK.annotate.getLineWidth('marker'), 20);
  assert.equal(SigK.annotate.getLineWidth(), 2, '図形・ペンの太さは変わらない');
  SigK.annotate.setColor('#92d050');
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotColors: { marker: '#92d050' } });
  SigK.annotate.setOpacity(0.5);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotOpacity: { marker: 0.5 } });
  trace(shell, [[100, 700], [300, 700]]);
  const marker = SigK.viewer.getAnnotations().added[0];
  assert.deepEqual([marker.lineWidth, marker.color, marker.opacity], [20, '#92d050', 0.5]);
  // ペンを描くと、ペンの値のまま。
  SigK.annotate.setTool('pen');
  trace(shell, [[100, 500], [300, 500]]);
  const pen = SigK.viewer.getAnnotations().added.at(-1);
  assert.deepEqual([pen.lineWidth, pen.color, pen.opacity], [2, '#c00000', 1]);
});

test('マーカーを選んで太さを変えるとそのマーカーを直してマーカーの太さとして覚え、ペンを選んで変えると共通の太さとして覚える', async (t) => {
  const shell = await withTool(t, 'marker');
  const { SigK } = shell;
  trace(shell, [[100, 700], [300, 700]]);
  const id = SigK.viewer.getAnnotations().added[0].id;
  SigK.annotate.select(id);
  assert.equal(SigK.annotate.setLineWidth(16), true);
  assert.equal(SigK.viewer.getAnnotations().added[0].lineWidth, 16);
  assert.equal(SigK.viewer.getAnnotations().added[0].blend, 'multiply', '直してもマーカーのまま');
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotMarkerWidth: 16 });
  SigK.annotate.setTool('pen');
  trace(shell, [[100, 500], [300, 500]]);
  SigK.annotate.select(SigK.viewer.getAnnotations().added.at(-1).id);
  SigK.annotate.setLineWidth(5);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotLineWidth: 5 });
  assert.equal(SigK.annotate.getLineWidth('marker'), 16);
});

test('マーカーとペンをまとめて選んで太さを変えると、両方の次の太さとして覚える', async (t) => {
  const shell = await withTool(t, 'marker');
  const { SigK } = shell;
  trace(shell, [[100, 700], [300, 700]]);
  SigK.annotate.setTool('pen');
  trace(shell, [[100, 500], [300, 500]]);
  const keys = SigK.viewer.getAnnotations().added.map((entry) => entry.id);
  SigK.annotate.selectKeys(keys);
  SigK.annotate.setLineWidth(9);
  assert.deepEqual(plain(SigK.viewer.getAnnotations().added.map((entry) => entry.lineWidth)), [9, 9]);
  assert.deepEqual(plain(shell.uiCalls.slice(-2)), [{ annotMarkerWidth: 9 }, { annotLineWidth: 9 }]);
});

test('右パネル・ヒント・一覧はマーカーの名前で、行は色・太さ・不透明度（塗り・線種は出さない）', async (t) => {
  const shell = await withTool(t, 'marker');
  const { SigK, document } = shell;
  const shown = (id) => document.getElementById(id).hidden === false;
  assert.equal(document.getElementById('props-kind').textContent, 'マーカー（次に付ける）');
  assert.equal(document.getElementById('props-width').value, '12');
  assert.equal(document.getElementById('props-opacity').value, '100');
  assert.equal(shown('props-color-row') && shown('props-width-row') && shown('props-opacity-row'), true);
  assert.equal(shown('props-fill-row'), false);
  assert.equal(document.getElementById('props-hint').textContent, SigK.annotationHints.HINTS.marker);
  trace(shell, [[100, 700], [300, 700]]);
  SigK.annotate.select(SigK.viewer.getAnnotations().added[0].id);
  assert.equal(document.getElementById('props-kind').textContent, 'マーカー');
  assert.equal(shown('props-fill-row'), false);
  const marker = SigK.viewer.getAnnotations().added[0];
  assert.equal(SigK.annotationIndex.labelOf(marker), 'マーカー');
  assert.equal(SigK.annotationIndex.iconOf(marker), 'marker');
});

test('起動時に覚えたマーカーの太さを戻し、範囲の外は捨てる', async (t) => {
  const shell = await withShell(t, { ui: { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotMarkerWidth: 24, annotLineWidth: 3 } });
  assert.equal(shell.SigK.annotate.getLineWidth('marker'), 24);
  assert.equal(shell.SigK.annotate.getLineWidth(), 3);
  assert.equal(shell.SigK.annotateShape.applyMarkerWidth(99), 24);
});
