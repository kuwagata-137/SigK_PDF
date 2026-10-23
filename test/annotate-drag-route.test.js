'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 押して引いている操作の「動かす」と「離す」の振り分け（spec-4b-5b b0。annotate-pointer.js から移した）。
// 描く・掴む・つまみ・範囲選択そのものは、それぞれのテストが見る。ここは振り分けの入口だけ。

const A = 'C:\\work\\a.pdf';

async function withTool(t, tool) {
  const shell = await createShell({
    pdfjs: createPdfjsStub(),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.SigK.annotate.setTool(tool);
  return shell;
}

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]');
}

function fire(shell, type, target, [x, y]) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  target.dispatchEvent(event);
  return event;
}

function at(shell, x, y) {
  return shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(x, y);
}

test('ペンで押して引いている間だけ isBusy が真で、離すと 1 つ書き込みになる', async (t) => {
  const shell = await withTool(t, 'pen');
  const { SigK } = shell;
  assert.equal(SigK.annotateDragRoute.isBusy(), false);
  fire(shell, 'mousedown', pageNode(shell), at(shell, 100, 700));
  fire(shell, 'mousemove', pageNode(shell), at(shell, 160, 650));
  assert.equal(SigK.annotateDragRoute.isBusy(), true);
  fire(shell, 'mouseup', pageNode(shell), at(shell, 200, 640));
  assert.equal(SigK.annotateDragRoute.isBusy(), false);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  assert.equal(SigK.viewer.getAnnotations().added[0].kind, 'ink');
});

test('描いている途中にページビューの外で離しても終える', async (t) => {
  const shell = await withTool(t, 'pen');
  const { SigK } = shell;
  fire(shell, 'mousedown', pageNode(shell), at(shell, 100, 700));
  fire(shell, 'mousemove', pageNode(shell), at(shell, 160, 650));
  fire(shell, 'mouseup', shell.document.body, at(shell, 200, 640));
  assert.equal(SigK.annotateDragRoute.isBusy(), false);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
});

test('何も押していないときの離しは false（残りの経路へ流す）', async (t) => {
  const shell = await withTool(t, 'pen');
  const event = new shell.window.MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 10, button: 0 });
  assert.equal(shell.SigK.annotateDragRoute.end(event), false);
});

// 押せば掴める所のカーソル（決定84 ①）。四角 [100, 600, 200, 700] の上の辺の上（つまみから外れた所）と内側。
function drawSquare(shell) {
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  const from = at(shell, 100, 700);
  const to = at(shell, 200, 600);
  fire(shell, 'mousedown', pageNode(shell), from);
  fire(shell, 'mousemove', shell.document.body, to);
  fire(shell, 'mouseup', pageNode(shell), to);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

const cursorOf = (shell) => shell.document.documentElement.getAttribute('data-transform-cursor');

test('マウスを動かすと、押せば書き込みを掴む所でだけ data-transform-cursor が move になる（決定84 ①）', async (t) => {
  const shell = await withTool(t, null);
  const { SigK, document } = shell;
  drawSquare(shell);
  SigK.annotate.setTool('select');
  fire(shell, 'mousemove', pageNode(shell), at(shell, 125, 700));
  assert.equal(cursorOf(shell), 'move');
  fire(shell, 'mousemove', pageNode(shell), at(shell, 300, 400));
  assert.equal(cursorOf(shell), null, '何も無い所');
  fire(shell, 'mousemove', pageNode(shell), at(shell, 150, 650));
  assert.equal(cursorOf(shell), 'move', '「選択」は内側も');
  SigK.annotate.setTool('hand');
  fire(shell, 'mousemove', pageNode(shell), at(shell, 150, 650));
  assert.equal(cursorOf(shell), null, 'ハンドの内側は手のカーソルのまま');
  fire(shell, 'mousemove', pageNode(shell), at(shell, 125, 700));
  assert.equal(cursorOf(shell), 'move', 'ハンドでも線の上');
  SigK.annotate.setTool('pen');
  fire(shell, 'mousemove', pageNode(shell), at(shell, 125, 700));
  assert.equal(cursorOf(shell), null, 'ペンは選んでいない書き込みを掴まない');
  SigK.annotate.setTool('select');
  fire(shell, 'mousemove', pageNode(shell), at(shell, 125, 700));
  fire(shell, 'mousemove', document.body, at(shell, 125, 700));
  assert.equal(cursorOf(shell), null, '紙の外');
});

test('つまみの上は、ハンドでもつまみのカーソルを先に出す。消しゴムと、編集モードの外ではカーソルの印を外す（決定84 ①③）', async (t) => {
  const shell = await withTool(t, null);
  const { SigK, document } = shell;
  const a = drawSquare(shell);
  SigK.annotate.select(a);
  SigK.annotate.setTool('hand');
  const corner = SigK.annotationFrame.shown().shape.handles.find((handle) => handle.id === 'x1y1');
  fire(shell, 'mousemove', pageNode(shell), corner.at);
  assert.equal(cursorOf(shell), corner.cursor);
  SigK.annotate.setTool('eraser');
  fire(shell, 'mousemove', pageNode(shell), at(shell, 125, 700));
  assert.equal(cursorOf(shell), null);
  SigK.annotate.setTool('select');
  fire(shell, 'mousemove', pageNode(shell), at(shell, 125, 700));
  assert.equal(cursorOf(shell), 'move');
  SigK.shell.setMode(document, 'view');
  fire(shell, 'mousemove', document.body, at(shell, 125, 700));
  assert.equal(cursorOf(shell), null);
});
