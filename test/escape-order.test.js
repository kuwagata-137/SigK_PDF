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

function mouse(shell, type, target, [x, y], { buttons = 0 } = {}) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
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

// ---- 決定68 ①の順（spec-4b-7a 確定事項A1） ----

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]');
}

// 紙の座標 from から to まで引く。release が false なら離さない。
function pull(shell, from, to, { release = true } = {}) {
  mouse(shell, 'mousedown', pageNode(shell), px(shell, from), { buttons: 1 });
  mouse(shell, 'mousemove', shell.document.body, px(shell, to), { buttons: 1 });
  if (release)
    mouse(shell, 'mouseup', pageNode(shell), px(shell, to));
}

test('押して引いている途中の操作は、検索バーより先に取りやめ、そのまま離しても置かない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  SigK.findBar.open();
  pull(shell, [100, 700], [200, 600], { release: false });
  assert.equal(SigK.annotateDraw.isDrawing(), true);
  assert.equal(esc(shell).defaultPrevented, true);
  assert.equal(SigK.annotateDraw.isDrawing(), false);
  assert.equal(SigK.findBar.isOpen(), true);
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [200, 600]));
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  esc(shell);
  assert.equal(SigK.findBar.isOpen(), false);
});

test('浮いている小窓（色のパレット）は、検索バーより先に閉じる', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  drawSquare(shell);
  SigK.findBar.open();
  document.getElementById('props-color').dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
  assert.equal(document.getElementById('color-pop').hidden, false);
  esc(shell);
  assert.equal(document.getElementById('color-pop').hidden, true);
  assert.equal(SigK.findBar.isOpen(), true);
  assert.equal(SigK.annotate.getSelection().length, 1);
});

test('描きかけ（トリミングの枠）は、検索バーの外で押した Esc なら検索バーより先に捨て、検索バーの中で押した Esc なら残す', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('trim');
  pull(shell, [100, 600], [400, 200]);
  assert.equal(SigK.annotateTrim.hasFrame(), true);
  SigK.findBar.open();
  esc(shell, document.getElementById('find-input'));
  assert.equal(SigK.findBar.isOpen(), false, '検索バーの中の Esc は検索バーを閉じる');
  assert.equal(SigK.annotateTrim.hasFrame(), true);
  SigK.findBar.open();
  esc(shell);
  assert.equal(SigK.annotateTrim.hasFrame(), false, 'ほかの場所の Esc は枠を先に捨てる');
  assert.equal(SigK.findBar.isOpen(), true);
});

test('置く前の押下（ノート）は Esc で捨て、離しても置かない。道具は外さない（確定事項A3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('note');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, [200, 600]));
  assert.equal(SigK.annotatePress.isPending(), true);
  assert.equal(esc(shell).defaultPrevented, true);
  assert.equal(SigK.annotatePress.isPending(), false);
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [200, 600]));
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(SigK.annotate.getTool(), 'note');
});

test('#view の外で離した押下は捨てる（確定事項A3）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('note');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, [200, 600]));
  mouse(shell, 'mouseup', document.getElementById('side'), [5, 5]);
  assert.equal(SigK.annotatePress.isPending(), false);
  esc(shell);
  assert.equal(SigK.annotate.getTool(), null, '空振りせずに道具を外す');
});

test('紙の上の文字の選択を Esc で外す。紙の外の選択には触れない（確定事項F1）', async (t) => {
  const shell = await withShell(t, 'view');
  const { document, window } = shell;
  const span = document.querySelector('#view .textLayer span');
  assert.ok(span !== null);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(span);
  selection.addRange(range);
  assert.equal(esc(shell).defaultPrevented, true);
  assert.equal(selection.rangeCount, 0);
  const outside = document.createRange();
  outside.selectNodeContents(document.getElementById('side-title'));
  selection.addRange(outside);
  assert.equal(esc(shell).defaultPrevented, false);
  assert.equal(selection.rangeCount, 1);
});

test('文字の選択は、書き込みの選択より先に外す（編集モード）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  drawSquare(shell);
  const range = document.createRange();
  range.selectNodeContents(document.querySelector('#view .textLayer span'));
  window.getSelection().addRange(range);
  esc(shell);
  assert.equal(window.getSelection().rangeCount, 0);
  assert.equal(SigK.annotate.getSelection().length, 1);
});

test('Esc で道具を外すと、戻り先は「道具なし」になる（確定事項A4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('select');
  SigK.annotate.setTool('shape');
  assert.equal(SigK.annotateTools.getBase(), 'select');
  esc(shell);
  assert.equal(SigK.annotate.getTool(), null);
  assert.equal(SigK.annotateTools.getBase(), null);
});

test('ページ編集モードで選択が無ければ、何もしない（preventDefault もしない）', async (t) => {
  const shell = await withShell(t, 'pages');
  assert.equal(esc(shell).defaultPrevented, false);
});

// ---- 欄の Esc（確定事項E。決定68 ②） ----

function type(shell, field, value) {
  field.focus();
  field.value = value;
  field.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
}

function enter(shell, field) {
  field.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

test('太さの数値欄の Esc は、打ちかけを捨てて今の値に戻し、欄から抜ける。当てない・選択は残す', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const id = drawSquare(shell);
  const width = document.getElementById('props-width');
  const before = width.value;
  const at = SigK.pageEdit.getHistoryState().at;
  type(shell, width, '9');
  assert.equal(esc(shell, width).defaultPrevented, true);
  assert.equal(width.value, before);
  assert.notEqual(document.activeElement, width);
  assert.equal(SigK.pageEdit.getHistoryState().at, at);
  assert.equal(SigK.viewer.getAnnotations().added.find((entry) => entry.id === id).lineWidth, Number(before));
  assert.equal(SigK.annotate.getSelection().length, 1);
  // Enter で当てたあとの Esc は、当てた値に戻す。
  type(shell, width, '5');
  enter(shell, width);
  type(shell, width, '7');
  esc(shell, width);
  assert.equal(width.value, '5');
});

test('ページ番号の欄の Esc は、打ちかけを捨てて今のページの番号に戻し、ページを送らない', async (t) => {
  const shell = await withShell(t, 'view');
  const { SigK, document } = shell;
  const input = document.getElementById('page-current');
  type(shell, input, '3');
  assert.equal(esc(shell, input).defaultPrevented, true);
  assert.equal(input.value, '1');
  assert.equal(SigK.viewer.getState().current, 0);
  assert.notEqual(document.activeElement, input);
});

test('本文の欄の Esc は、打った文を確定して抜け、検索バーは閉じない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('note');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, [200, 600]));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [200, 600]));
  SigK.findBar.open();
  const contents = document.getElementById('props-contents');
  type(shell, contents, '確認しました');
  assert.equal(esc(shell, contents).defaultPrevented, true);
  assert.equal(SigK.viewer.getAnnotations().added[0].text, '確認しました');
  assert.notEqual(document.activeElement, contents);
  assert.equal(SigK.findBar.isOpen(), true);
});

test('欄にフォーカスがあっても、紙の上で引いている途中の操作を先に取りやめ、欄は次の Esc で戻す（確定事項E4）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  drawSquare(shell);
  const width = document.getElementById('props-width');
  const before = width.value;
  type(shell, width, '9');
  pull(shell, [300, 700], [400, 600], { release: false });
  assert.equal(SigK.annotateDraw.isDrawing(), true);
  esc(shell, width);
  assert.equal(SigK.annotateDraw.isDrawing(), false);
  assert.equal(width.value, '9', '欄はまだ戻さない');
  assert.equal(document.activeElement, width);
  esc(shell, width);
  assert.equal(width.value, before);
});

test('スライダーを引いている途中の Esc は、下見を捨てて引く前の値に戻し、離すまで動かさず、離しても当てない（確定事項E3）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  const id = drawSquare(shell);
  const range = document.getElementById('props-opacity-range');
  const number = document.getElementById('props-opacity');
  const at = SigK.pageEdit.getHistoryState().at;
  shell.firePointer(range, 'pointerdown');
  range.focus();
  range.value = '45';
  range.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(SigK.annotatePreview.isActive(), true);
  assert.equal(SigK.propsRange.isHeld(), true);
  assert.equal(esc(shell, range).defaultPrevented, true);
  assert.equal(SigK.annotatePreview.isActive(), false);
  assert.equal(range.value, '100');
  assert.equal(number.value, '100');
  // 引き続けても、離しても動かない。
  range.value = '30';
  range.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(range.value, '100');
  assert.equal(SigK.annotatePreview.isActive(), false);
  range.value = '30';
  range.dispatchEvent(new window.Event('change', { bubbles: true }));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(SigK.pageEdit.getHistoryState().at, at);
  assert.equal(SigK.viewer.getAnnotations().added.find((entry) => entry.id === id).opacity ?? 1, 1);
  assert.equal(SigK.propsRange.isHeld(), false);
  // 離したあとは、いつもどおり動く。
  range.value = '60';
  range.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(SigK.annotatePreview.isActive(), true);
});
