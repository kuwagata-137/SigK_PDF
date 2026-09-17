'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// ページビューの押し離しの振り分け（spec-4-1 確定事項6・10、spec-4-2 確定事項3・5・6）。
// マークアップの作成と選択は annotate.test.js、テキストの置く・直す・動かすは
// annotate-text.test.js が見る。ここは振り分けの境目だけ。

const A = 'C:\\work\\a.pdf';
const IMPORTED = {
  0: [{ id: '86R', subtype: 'Highlight', rect: [40, 600, 200, 612], quadPoints: [40, 612, 200, 612, 40, 600, 200, 600], color: new Uint8ClampedArray([255, 230, 51]), opacity: 1 }],
};

async function withTextTool(t, options = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: IMPORTED, ...(options.stub ?? {}) }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.SigK.annotate.setTool('text');
  return shell;
}

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]');
}

function press(shell, type, target, x, y) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  target.dispatchEvent(event);
  return event;
}

function clickAt(shell, x, y) {
  const [cx, cy] = shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(x, y);
  press(shell, 'mousedown', pageNode(shell), cx, cy);
  press(shell, 'mouseup', pageNode(shell), cx, cy);
}

function editorNode(shell) {
  return shell.document.querySelector('textarea.free-text-editor');
}

test('入力欄を確定した押し離しは置く・選ぶに使われず、次の押し離しから効く', async (t) => {
  const shell = await withTextTool(t);
  const { SigK } = shell;
  clickAt(shell, 100, 700);
  editorNode(shell).value = 'x';
  editorNode(shell).dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  // 紙の別の場所を押して確定する。ここでは新しい入力欄は開かない
  clickAt(shell, 100, 400);
  assert.equal(editorNode(shell), null);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  assert.equal(SigK.annotatePointer.isDragging(), false);
  // 次の押し離しで置ける
  clickAt(shell, 100, 400);
  assert.ok(editorNode(shell) !== null);
});

test('何も無い場所は道具が無ければ選択の解除、テキストの道具なら置く', async (t) => {
  const shell = await withTextTool(t);
  const { SigK } = shell;
  clickAt(shell, 100, 606);
  assert.equal(SigK.annotate.getSelected(), '86R');
  assert.equal(editorNode(shell), null);
  clickAt(shell, 400, 300);
  assert.equal(SigK.annotate.getSelected(), null);
  assert.ok(editorNode(shell) !== null);
  SigK.annotate.escape();
  SigK.annotate.setTool(null);
  clickAt(shell, 100, 606);
  clickAt(shell, 400, 300);
  assert.equal(SigK.annotate.getSelected(), null);
  assert.equal(editorNode(shell), null);
});

test('動いた押し離しやマークアップの上では置かず、マークアップは掴めない', async (t) => {
  const shell = await withTextTool(t);
  const { SigK } = shell;
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const [x, y] = viewport.convertToViewportPoint(300, 300);
  press(shell, 'mousedown', pageNode(shell), x, y);
  press(shell, 'mouseup', pageNode(shell), x + 40, y);
  assert.equal(editorNode(shell), null);

  clickAt(shell, 100, 606);
  assert.equal(SigK.annotate.getSelected(), '86R');
  const [hx, hy] = viewport.convertToViewportPoint(100, 606);
  const down = press(shell, 'mousedown', pageNode(shell), hx, hy);
  assert.equal(down.defaultPrevented, false);
  assert.equal(SigK.annotatePointer.isDragging(), false);
  press(shell, 'mouseup', pageNode(shell), hx, hy);
  assert.equal(SigK.pageEdit.canUndo(), false);
});

test('紙の外で離してもドラッグは終わり、閲覧モードでは何も起きない', async (t) => {
  const shell = await withTextTool(t);
  const { SigK, document } = shell;
  clickAt(shell, 100, 700);
  editorNode(shell).value = 'x';
  editorNode(shell).dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  SigK.annotate.finishEditing();
  const entry = SigK.viewer.getAnnotations().added[0];
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const [sx, sy] = viewport.convertToViewportPoint(103, 695);
  press(shell, 'mousedown', pageNode(shell), sx, sy);
  assert.equal(SigK.annotatePointer.isDragging(), true);
  press(shell, 'mouseup', document.body, sx + 20 * viewport.scale, sy);
  assert.equal(SigK.annotatePointer.isDragging(), false);
  assert.equal(SigK.viewer.getAnnotations().added[0].rect[0], entry.rect[0] + 20);

  SigK.shell.setMode(document, 'view');
  clickAt(shell, 300, 300);
  assert.equal(editorNode(shell), null);
  assert.equal(SigK.annotate.getSelected(), null);
});
