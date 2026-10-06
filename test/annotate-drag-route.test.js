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
