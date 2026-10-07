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

test('窓が開いている間は、Delete・Esc・Ctrl+Z・Ctrl+W が下の画面に効かない（spec-4b-7a 確定事項B1）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.setTool('shape');
  SigK.annotate.select(a);
  const at = SigK.pageEdit.getHistoryState().at;
  await SigK.docInfo.open(document);
  const dialog = document.getElementById('doc-info');
  assert.equal(dialog.hasAttribute('open'), true);
  const press = (init) => {
    const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    dialog.dispatchEvent(event);
    return event;
  };
  assert.equal(press({ key: 'Delete' }).defaultPrevented, false);
  assert.deepEqual(ids(shell), [a]);
  press({ key: 'Escape' });
  assert.equal(SigK.annotate.getSelection().length, 1, '下の画面の選択は外れない');
  assert.equal(SigK.annotate.getTool(), 'shape', '道具も外れない');
  press({ key: 'z', ctrlKey: true });
  assert.equal(SigK.pageEdit.getHistoryState().at, at);
  press({ key: 'w', ctrlKey: true });
  assert.equal(SigK.tabs.count(), 1);
  press({ key: 'f', ctrlKey: true });
  assert.equal(SigK.findBar.isOpen(), false);
  const top = document.getElementById('view').scrollTop;
  assert.equal(press({ key: 'PageDown' }).defaultPrevented, false);
  assert.equal(document.getElementById('view').scrollTop, top);
  // 窓を閉じれば、いつもどおり効く。
  SigK.docInfo.close(document);
  key(shell, document.body, 'Delete');
  assert.deepEqual(ids(shell), []);
});

test('窓が開いている間は、メニューの保存・開く・文書情報の要求も後ろの画面に効かない（spec-4b-7a 点検の直し）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.print.open();
  assert.equal(document.getElementById('print-dialog').hasAttribute('open'), true);
  shell.fireSaveRequest('saveAs');
  shell.fireOpenRequest(A);
  shell.fireDocInfoRequest();
  await shell.flush();
  assert.equal(shell.savePathCalls.length, 0);
  assert.equal(SigK.tabs.count(), 1);
  assert.equal(document.getElementById('doc-info').hasAttribute('open'), false);
  // 窓を閉じれば効く。
  SigK.print.close();
  shell.fireDocInfoRequest();
  await shell.flush();
  assert.equal(document.getElementById('doc-info').hasAttribute('open'), true);
});
