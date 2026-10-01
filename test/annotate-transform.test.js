'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// つまみで大きさ・向き・端を変える指揮（spec-4b-2 確定事項15〜24）。
//
// jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま .pdf-page 基準の CSS px になる。
// 形の計算そのものは shape-resize.test.js、つまみの位置は shape-handles.test.js が見る。

const A = 'C:\\work\\a.pdf';

const IMPORTED = {
  0: [
    { id: '31R', subtype: 'PolyLine', rect: [48.5, 48.5, 251.5, 151.5], color: new Uint8ClampedArray([0, 128, 0]), borderStyle: { width: 3 }, vertices: new Float32Array([50, 50, 250, 150]), lineEndings: ['None', 'OpenArrow'] },
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
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function pageNode(shell, index = 0) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

function viewportOf(shell, index = 0) {
  return shell.SigK.viewer.getTextLayer(index).viewport;
}

function mouse(shell, type, target, [x, y], extra = {}) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra });
  target.dispatchEvent(event);
  return event;
}

// 図形の道具で pt の 2 点の箱を描いて選ぶ。
function drawSquare(shell, from, to) {
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  const px = (point) => viewportOf(shell).convertToViewportPoint(point[0], point[1]);
  mouse(shell, 'mousedown', pageNode(shell), px(from));
  mouse(shell, 'mousemove', shell.document.body, px(to));
  mouse(shell, 'mouseup', pageNode(shell), px(to));
  SigK.annotate.setTool(null);
  return SigK.viewer.getAnnotations().added.at(-1);
}

function handleOf(shell, id) {
  return shell.SigK.annotationFrame.shown().shape.handles.find((handle) => handle.id === id);
}

// つまみを押して、表示の px で delta だけ動かして離す。
function pull(shell, id, delta, { shift = false, release = true } = {}) {
  const at = handleOf(shell, id).at;
  const to = [at[0] + delta[0], at[1] + delta[1]];
  const down = mouse(shell, 'mousedown', pageNode(shell), at, { shiftKey: shift });
  mouse(shell, 'mousemove', shell.document.body, to, { shiftKey: shift });
  if (release)
    mouse(shell, 'mouseup', pageNode(shell), to, { shiftKey: shift });
  return down;
}

const near = (actual, expected, eps = 0.05) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} は ${expected} に近くない`);

test('角のつまみを引くと、反対の角を動かさずに大きさが変わり、1 世代積まれ、Ctrl+Z 1 回で戻る', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const entry = drawSquare(shell, [100, 700], [300, 600]);
  const scale = viewportOf(shell).scale;
  const down = pull(shell, 'x2y2', [40, -20]);
  assert.equal(down.defaultPrevented, true);
  const after = SigK.viewer.getAnnotations().added.find((item) => item.id === entry.id);
  near(after.rect[0], entry.rect[0]);
  near(after.rect[1], entry.rect[1]);
  near(after.rect[2], entry.rect[2] + 40 / scale);
  near(after.rect[3], entry.rect[3] + 20 / scale);
  assert.equal(SigK.annotate.getSelected(), entry.id);
  // Ctrl+Z 1 回で描いた直後の箱に戻る（ドラッグの途中を積んでいれば戻りきらない）
  SigK.pageEdit.undo();
  assert.deepEqual([...SigK.viewer.getAnnotations().added.find((item) => item.id === entry.id).rect], [...entry.rect]);
});

test('動かしている間は下見で描き、Esc で取りやめると元の形に戻って積まない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const entry = drawSquare(shell, [100, 700], [300, 600]);
  const undoBefore = SigK.pageEdit.canUndo();
  pull(shell, 'x2', [60, 0], { release: false });
  assert.equal(SigK.annotateTransform.isDragging(), true);
  assert.equal(SigK.annotatePreview.isActive(), true);
  const drawn = pageNode(shell).querySelector(`.annot-layer g[data-annot="${entry.id}"] rect`);
  assert.ok(Number(drawn.getAttribute('width')) > 200 * viewportOf(shell).scale, '下見の幅で描く');
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(SigK.annotateTransform.isDragging(), false);
  assert.equal(SigK.annotatePreview.isActive(), false);
  mouse(shell, 'mouseup', pageNode(shell), [0, 0]);
  assert.deepEqual([...SigK.viewer.getAnnotations().added.at(-1).rect], [...entry.rect]);
  assert.equal(SigK.annotate.getSelected(), entry.id, 'Esc はドラッグだけを取りやめ、選択は残す');
  assert.equal(SigK.pageEdit.canUndo(), undoBefore);
});

test('つまみを押して動かさずに離しても、選択は変わらず積まない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const entry = drawSquare(shell, [100, 700], [300, 600]);
  const count = SigK.viewer.getAnnotations().added.length;
  pull(shell, 'x1y1', [1, 1]);
  assert.equal(SigK.annotate.getSelected(), entry.id);
  assert.equal(SigK.viewer.getAnnotations().added.length, count);
  assert.deepEqual([...SigK.viewer.getAnnotations().added.at(-1).rect], [...entry.rect]);
});

test('回転のつまみで回し、Shift で 15° 刻みになる。回した図形にも枠とつまみが付いて回る', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const entry = drawSquare(shell, [100, 700], [300, 600]);
  const center = viewportOf(shell).convertToViewportPoint(200, 650);
  const knob = handleOf(shell, 'rotate').at;
  // 真上のつまみを、中心の真右へ: 時計回りに 90°
  pull(shell, 'rotate', [center[0] + 80 - knob[0], center[1] - knob[1]]);
  let turned = SigK.viewer.getAnnotations().added.at(-1);
  assert.equal(turned.angle, 90);
  assert.deepEqual([...turned.rect], [...entry.rect], '回しても箱は回す前のまま');
  assert.equal(shell.document.querySelector('.annot-frame-layer polygon.annot-frame') !== null, true);
  // 少し動かしたつまみ（Shift）は 15° の角度そのものにそろう
  const knob2 = handleOf(shell, 'rotate').at;
  pull(shell, 'rotate', [10, 14], { shift: true });
  turned = SigK.viewer.getAnnotations().added.at(-1);
  assert.equal(turned.angle % 15, 0);
  assert.ok(knob2 !== null);
});

test('紙の外（灰色）で押しても、選んでいる書き込みのつまみなら引ける', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  // 1 ページ目の下端の近くで 180° 回した四角。回転のつまみは紙の下（ページの間の灰色）にはみ出す
  drawSquare(shell, [100, 40], [300, 4]);
  SigK.annotationAngleRow.setAngle(180);
  const knob = handleOf(shell, 'rotate').at;
  assert.ok(knob[1] > viewportOf(shell).height, '回転のつまみは紙の外');
  const view = shell.document.getElementById('view');
  const down = mouse(shell, 'mousedown', view, knob);
  assert.equal(down.defaultPrevented, true);
  assert.equal(SigK.annotateTransform.isDragging(), true);
  mouse(shell, 'mouseup', view, knob);
  assert.equal(SigK.annotateTransform.isDragging(), false);
});

test('1 ページ目の上端の近くの四角では、回転のつまみを下の辺の外に出し、そこから回せる', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  // 回転のつまみを上に出すと、1 ページ目の上の余白（18px）より上になって見えない
  drawSquare(shell, [100, 838], [300, 800]);
  const knob = handleOf(shell, 'rotate').at;
  assert.ok(knob[1] > handleOf(shell, 'y1').at[1], '回転のつまみは下の辺より下');
  const before = SigK.pageEdit.getHistoryState().at;
  // 下から右へ引くと、表示で反時計回り（角度は 360 の手前）
  pull(shell, 'rotate', [40, 0]);
  const angle = SigK.viewer.getAnnotations().added.at(-1).angle;
  assert.ok(angle > 270 && angle < 360, `角度 ${angle}`);
  assert.equal(SigK.pageEdit.getHistoryState().at - before, 1);
});

test('読み込んだ矢印の端を Shift で動かすと、表示で横か縦にだけ動き、写しに付け替わる', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.select('31R');
  const shape = SigK.annotationFrame.shown().shape;
  assert.deepEqual(Array.from(shape.handles, (handle) => handle.id), ['start', 'end']);
  const scale = viewportOf(shell).scale;
  pull(shell, 'end', [30, 8], { shift: true });
  const copy = SigK.viewer.getAnnotations().added.at(-1);
  assert.equal(copy.kind, 'arrow');
  assert.deepEqual([...SigK.viewer.getAnnotations().removed], ['31R']);
  near(copy.paths[0][1][0], 250 + 30 / scale);
  near(copy.paths[0][1][1], 150);
  assert.deepEqual([...copy.paths[0][0]], [50, 50]);
  assert.equal(SigK.annotate.getSelected(), copy.id);
});

test('ペンにはつまみを出さず、マウスがつまみの上に来るとそのカーソルを出す', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  drawSquare(shell, [100, 700], [300, 600]);
  const corner = handleOf(shell, 'x1y1');
  mouse(shell, 'mousemove', document.body, corner.at);
  assert.equal(document.documentElement.getAttribute('data-transform-cursor'), corner.cursor);
  mouse(shell, 'mousemove', document.body, [corner.at[0] + 40, corner.at[1] - 40]);
  assert.equal(document.documentElement.hasAttribute('data-transform-cursor'), false);
  mouse(shell, 'mousemove', document.body, handleOf(shell, 'rotate').at);
  assert.equal(document.documentElement.getAttribute('data-transform-cursor'), 'rotate');
  // ペン
  SigK.annotate.setTool('pen');
  const px = (point) => viewportOf(shell).convertToViewportPoint(point[0], point[1]);
  mouse(shell, 'mousedown', pageNode(shell), px([100, 400]));
  mouse(shell, 'mousemove', document.body, px([150, 420]));
  mouse(shell, 'mousemove', document.body, px([200, 400]));
  mouse(shell, 'mouseup', pageNode(shell), px([200, 400]));
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).kind, 'ink');
  assert.equal(SigK.annotationFrame.shown().shape, null);
  assert.equal(document.querySelectorAll('.annot-frame-layer .annot-handle').length, 0);
});

test('ドラッグ中の Ctrl+Z と Delete は、先にドラッグを取りやめる', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const entry = drawSquare(shell, [100, 700], [300, 600]);
  pull(shell, 'x2', [60, 0], { release: false });
  SigK.pageEdit.undo();
  assert.equal(SigK.annotateTransform.isDragging(), false);
  assert.equal(SigK.viewer.getAnnotations().added.some((item) => item.id === entry.id), false, 'Ctrl+Z は描いた 1 世代を戻す');
  SigK.pageEdit.redo();
  SigK.annotate.select(entry.id);
  pull(shell, 'x2', [60, 0], { release: false });
  assert.equal(SigK.annotate.remove(), true);
  assert.equal(SigK.annotateTransform.isDragging(), false);
  assert.equal(SigK.viewer.getAnnotations().added.some((item) => item.id === entry.id), false);
});
