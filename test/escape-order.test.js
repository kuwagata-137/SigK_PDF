'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// Esc の振り分け（spec-4b-7a 確定事項A）。文書の keydown に Esc を流し、どれが 1 つだけ取りやめになるかを見る。

const A = 'C:\\work\\a.pdf';

async function withShell(t, mode = 'annot') {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, mode);
  return shell;
}

function mouse(shell, type, target, [x, y]) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
}

function px(shell, point) {
  return shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
}

// 四角を描いて選んだままにする（描いた直後は選ばれる）。道具は四角のまま。
function drawSquare(shell, from = [100, 700], to = [200, 600]) {
  const { SigK } = shell;
  const node = shell.document.querySelector('.pdf-page[data-page="1"]');
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', node, px(shell, from));
  mouse(shell, 'mousemove', shell.document.body, px(shell, to));
  mouse(shell, 'mouseup', node, px(shell, to));
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

function esc(shell, target = shell.document.body, init = {}) {
  const event = new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

test('検索バーが開いていれば、Esc はまず検索バーだけを閉じ、次の Esc で選択、その次で道具を外す', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  drawSquare(shell);
  assert.equal(SigK.annotate.getSelection().length, 1);
  SigK.findBar.open();
  assert.equal(esc(shell).defaultPrevented, true);
  assert.equal(SigK.findBar.isOpen(), false);
  assert.equal(SigK.annotate.getSelection().length, 1, '選択は残る');
  esc(shell);
  assert.equal(SigK.annotate.getSelection().length, 0);
  assert.equal(SigK.annotate.getTool(), 'shape');
  esc(shell);
  assert.equal(SigK.annotate.getTool(), null);
});

test('ページ編集モードの Esc は、ページの選択を外す', async (t) => {
  const shell = await withShell(t, 'pages');
  const { SigK } = shell;
  SigK.pageGrid.setSelection([0, 1]);
  esc(shell);
  assert.equal(SigK.pageGrid.getSelection().length, 0);
});

test('閲覧モードの Esc は、何も開いていなければ何もしない', async (t) => {
  const shell = await withShell(t, 'view');
  assert.equal(esc(shell).defaultPrevented, false);
  assert.equal(shell.SigK.escapeOrder.handle(new shell.window.KeyboardEvent('keydown', { key: 'Escape' }), shell.document), false);
});

test('ページ番号の欄の Esc は、選択も道具も外さない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  drawSquare(shell);
  const input = document.getElementById('page-current');
  input.focus();
  esc(shell, input);
  assert.equal(SigK.annotate.getSelection().length, 1);
  assert.equal(SigK.annotate.getTool(), 'shape');
});

test('先に処理された Esc・IME の変換中の Esc では何もしない（spec-4b-7a 確定事項C1）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  drawSquare(shell);
  SigK.findBar.open();
  const handle = (init) => SigK.escapeOrder.handle({ key: 'Escape', target: document.body, defaultPrevented: false, isComposing: false, keyCode: 27, preventDefault() {}, ...init }, document);
  assert.equal(handle({ defaultPrevented: true }), false);
  assert.equal(handle({ isComposing: true }), false);
  assert.equal(handle({ keyCode: 229 }), false);
  assert.equal(SigK.findBar.isOpen(), true);
  assert.equal(SigK.annotate.getSelection().length, 1);
  assert.equal(handle({}), true);
  assert.equal(SigK.findBar.isOpen(), false);
});

test('窓が開いていれば、検索バーが開いていても Esc は検索バーを閉じない（spec-4b-7a 確定事項B2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.findBar.open();
  await SigK.docInfo.open(document);
  esc(shell, document.getElementById('doc-info'));
  assert.equal(SigK.findBar.isOpen(), true);
});
