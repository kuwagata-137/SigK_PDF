'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// キーの振り分けのうち、編集モードの Delete・Backspace（spec-4-1 確定事項7、spec-4b-3a 確定事項H）。
// ほかのキーはそれぞれの機能のテスト（find・page-edit・annotate-text など）が見る。

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

function drawSquare(shell, from, to) {
  const { SigK } = shell;
  const node = shell.document.querySelector('.pdf-page[data-page="1"]');
  const px = (point) => SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', node, px(from));
  mouse(shell, 'mousemove', shell.document.body, px(to));
  mouse(shell, 'mouseup', node, px(to));
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

function key(shell, target, name) {
  const event = new shell.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

const ids = (shell) => [...shell.SigK.viewer.getAnnotations().added.map((entry) => entry.id)];

test('編集モードの Backspace は、Delete と同じく選んだ全部を消して 1 世代（確定事項H1）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  const c = drawSquare(shell, [100, 500], [200, 400]);
  SigK.annotate.selectKeys([a, c]);
  const at = SigK.pageEdit.getHistoryState().at;
  const event = key(shell, document.body, 'Backspace');
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(ids(shell), [b]);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  SigK.annotate.select(b);
  key(shell, document.body, 'Delete');
  assert.deepEqual(ids(shell), []);
});

test('右パネルの欄の中の Backspace は奪わない（確定事項H2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  const field = document.getElementById('props-width');
  const event = key(shell, field, 'Backspace');
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(ids(shell), [a]);
});

test('テキストの入力欄の中の Backspace は奪わない（確定事項H2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.setTool('text');
  const node = document.querySelector('.pdf-page[data-page="1"]');
  const [x, y] = SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(300, 300);
  mouse(shell, 'mousedown', node, [x, y]);
  mouse(shell, 'mouseup', node, [x, y]);
  SigK.annotate.select(a);
  const editor = document.querySelector('textarea.free-text-editor');
  assert.notEqual(editor, null);
  const event = key(shell, editor, 'Backspace');
  assert.equal(event.defaultPrevented, false);
  assert.ok(ids(shell).includes(a));
});

test('ページ編集モードの Backspace ではページを消さない（確定事項H4）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'pages');
  SigK.pageGrid?.setSelection([0]);
  const pages = SigK.viewer.getPlan().length;
  key(shell, document.body, 'Backspace');
  assert.equal(SigK.viewer.getPlan().length, pages);
});
