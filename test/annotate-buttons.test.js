'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 紙の上の押し離しのボタンと Ctrl（spec-4b-3a 確定事項B）。書き込みを描く・置く・掴む・選ぶのは左ボタンだけ（決定52 ⑥）。
// テキストの入力欄の中を押したら pointer は何もしない（事前調査 G）。Ctrl＋クリックで同じページの中だけ足し引きする。
// jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま .pdf-page 基準の CSS px になる。

const ITEMS = [
  { str: 'あいうえお', transform: [12, 0, 0, 12, 50, 700], width: 60, fontName: 'f1' },
  { str: 'かきくけこ', transform: [12, 0, 0, 12, 50, 680], width: 60, fontName: 'f1' },
];
const STYLES = { f1: { ascent: 0.9, descent: -0.2 } };
const A = 'C:\\work\\a.pdf';

async function withShell(t) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ textItems: ITEMS, textStyles: STYLES }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  // 文字の選択の矩形は span に残した pt の位置から作る（annotate.test.js と同じ）。
  shell.SigK.annotate.setRectsOf((range, div) => {
    const handle = shell.SigK.viewer.getTextLayer(Number(div.closest('.pdf-page').dataset.page) - 1);
    const [left, bottom] = handle.viewport.convertToViewportPoint(Number(div.dataset.x), Number(div.dataset.y) - 3);
    const [right, top] = handle.viewport.convertToViewportPoint(Number(div.dataset.x) + Number(div.dataset.w), Number(div.dataset.y) + 12);
    return [{ left, top, right, bottom, width: right - left, height: bottom - top }];
  });
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function pageNode(shell, index = 0) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

function px(shell, point, index = 0) {
  return shell.SigK.viewer.getTextLayer(index).viewport.convertToViewportPoint(point[0], point[1]);
}

// button は押した・離したボタン（0 左・1 中・2 右）。buttons は押している間のボタン。
function mouse(shell, type, target, [x, y], { button = 0, ctrl = false, shift = false } = {}) {
  const buttons = type === 'mouseup' ? 0 : [1, 4, 2][button];
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons, ctrlKey: ctrl, shiftKey: shift });
  target.dispatchEvent(event);
  return event;
}

// pt の from から to まで引く。
function dragPt(shell, from, to, options = {}) {
  mouse(shell, 'mousedown', pageNode(shell), px(shell, from), options);
  mouse(shell, 'mousemove', shell.document.body, px(shell, to), options);
  mouse(shell, 'mouseup', pageNode(shell), px(shell, to), options);
}

function clickPt(shell, at, options = {}) {
  dragPt(shell, at, at, options);
}

function drawSquare(shell, from, to) {
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  dragPt(shell, from, to);
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

const count = (shell) => shell.SigK.viewer.getAnnotations().added.length;

test('四角の道具を持って右ボタンや中ボタンで引いても、何も描かれない（決定52 ⑥。事前調査 B4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  dragPt(shell, [100, 700], [200, 600], { button: 2 });
  dragPt(shell, [100, 500], [200, 400], { button: 1 });
  assert.equal(count(shell), 0);
  assert.equal(SigK.annotatePointer.isDrawing(), false);
  dragPt(shell, [100, 700], [200, 600]);
  assert.equal(count(shell), 1, '左ボタンなら描ける');
});

test('描きかけの途中に右ボタンを押し離しても、描きかけは続き、左を離したときに 1 つだけ描かれる', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, [100, 700]));
  mouse(shell, 'mousemove', shell.document.body, px(shell, [150, 650]));
  mouse(shell, 'mousedown', pageNode(shell), px(shell, [150, 650]), { button: 2 });
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [150, 650]), { button: 2 });
  assert.equal(SigK.annotatePointer.isDrawing(), true, '右の押し離しでは描きかけは終わらない');
  assert.equal(count(shell), 0);
  mouse(shell, 'mousemove', shell.document.body, px(shell, [200, 600]));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [200, 600]));
  assert.equal(count(shell), 1);
  assert.deepEqual([...SigK.viewer.getAnnotations().added[0].rect].map(Math.round), [100, 600, 200, 700]);
});

test('テキスト・ノートの道具を持って右クリックしても、何も置かれない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('text');
  clickPt(shell, [100, 700], { button: 2 });
  assert.equal(document.querySelector('.free-text-editor'), null);
  SigK.annotate.setTool('note');
  clickPt(shell, [100, 600], { button: 2 });
  assert.equal(count(shell), 0);
});

test('右ボタンでは書き込みを選ばず、選んでいる書き込みを右ボタンで引いても動かない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const key = drawSquare(shell, [100, 700], [200, 600]);
  clickPt(shell, [150, 700], { button: 2 });
  assert.equal(SigK.annotate.getSelected(), null);
  SigK.annotate.select(key);
  const before = [...SigK.viewer.getAnnotations().added[0].rect];
  dragPt(shell, [150, 700], [250, 650], { button: 2 });
  assert.deepEqual([...SigK.viewer.getAnnotations().added[0].rect], before);
  assert.equal(SigK.annotatePointer.isDragging(), false);
});

test('マークアップの道具で文字を選んでいても、右ボタンを離しただけでは付かない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  SigK.annotate.setTool('highlight');
  const span = document.querySelector('.pdf-page[data-page="1"] .textLayer span');
  const range = document.createRange();
  range.setStart(span.firstChild, 0);
  range.setEnd(span.firstChild, span.textContent.length);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [60, 705]), { button: 2 });
  assert.equal(count(shell), 0);
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [60, 705]));
  assert.equal(count(shell), 1, '左ボタンを離せば付く');
});

test('確定したテキストを直している最中に、入力欄の中を押して引いても、そのテキストを掴まない（事前調査 G）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('text');
  clickPt(shell, [100, 500]);
  const editorNode = document.querySelector('textarea.free-text-editor');
  editorNode.value = 'テキスト';
  editorNode.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  editorNode.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  SigK.annotate.setTool(null);
  const entry = SigK.viewer.getAnnotations().added.at(-1);
  assert.equal(entry.kind, 'text');
  assert.equal(SigK.annotateText.beginEdit(entry.id), true);
  const editing = document.querySelector('textarea.free-text-editor');
  const at = px(shell, [entry.rect[0] + 3, entry.rect[3] - 3]);
  const down = mouse(shell, 'mousedown', editing, at);
  assert.equal(SigK.annotatePointer.isDragging(), false);
  assert.equal(down.defaultPrevented, false, 'カーソルを置き直せるよう、既定の動きを止めない');
  mouse(shell, 'mousemove', document.body, [at[0] + 40, at[1] + 20]);
  mouse(shell, 'mouseup', editing, [at[0] + 40, at[1] + 20]);
  assert.deepEqual([...SigK.viewer.getAnnotations().added.at(-1).rect], [...entry.rect]);
});

test('Ctrl＋クリックで同じページの書き込みを足し、選んでいるものを動かさずに離すと外す（確定事項B3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  clickPt(shell, [150, 700]);
  assert.deepEqual([...SigK.annotate.getSelection()], [a]);
  clickPt(shell, [350, 700], { ctrl: true });
  assert.deepEqual([...SigK.annotate.getSelection()], [a, b]);
  clickPt(shell, [150, 700], { ctrl: true });
  assert.deepEqual([...SigK.annotate.getSelection()], [b]);
});

test('Ctrl を押して書き込みの無い所を押しても、選択は変わらず、何も置かれない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  SigK.annotate.selectKeys([a, b]);
  clickPt(shell, [500, 300], { ctrl: true });
  assert.deepEqual([...SigK.annotate.getSelection()], [a, b]);
  SigK.annotate.setTool('note');
  clickPt(shell, [500, 300], { ctrl: true });
  assert.equal(count(shell), 2);
});

test('複数を選んでいるとき、素のクリックで 1 つを押して離すと、その 1 件だけに畳む（確定事項B5）。Shift＋クリックも同じ（B4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  SigK.annotate.selectKeys([a, b]);
  clickPt(shell, [150, 700]);
  assert.deepEqual([...SigK.annotate.getSelection()], [a]);
  SigK.annotate.selectKeys([a, b]);
  clickPt(shell, [350, 700], { shift: true });
  assert.deepEqual([...SigK.annotate.getSelection()], [b]);
});

test('Ctrl を押していれば、四角の道具を持って書き込みの無い所を引いても描き始めない（選んでいない書き込みの上から引けば写し。確定事項G1）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  dragPt(shell, [300, 400], [400, 300], { ctrl: true });
  assert.equal(count(shell), 1);
  assert.deepEqual([...SigK.annotate.getSelection()], [a]);
});
