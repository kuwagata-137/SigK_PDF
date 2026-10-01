'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 左＋右（spec-4b-3b 確定事項E。決定53 ④）。編集モードで #view の中で左と右の両方が押された時点で、進んでいる操作（描きかけ・
// 置く前・範囲選択・掴む・つまみ・表示を引く・文字をなぞる）を取りやめ、道具を切り替える（N・S・D → ハンド、ハンド → 戻り先）。
// 全部のボタンを離すまで、動きと離しを捨てる。押す順は問わず、切り替えは 1 回だけ。1000ms 以内の contextmenu は捨てる。
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

function px(shell, point) {
  return shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
}

// buttons は押している間のボタン（1 左・2 右・3 両方）。
function fire(shell, type, target, [x, y], { button = 0, buttons = 0, ctrl = false } = {}) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons, ctrlKey: ctrl });
  target.dispatchEvent(event);
  return event;
}

function contextMenu(shell, target, [x, y]) {
  const event = new shell.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
  target.dispatchEvent(event);
  return event;
}

// 左で from を押して to まで引き、右を押して離し（contextmenu も）、さらに after まで動かしてから左を離す（事前調査 B の順）。
function chordDrag(shell, from, to, { after = to, ctrl = false } = {}) {
  const { document } = shell;
  fire(shell, 'mousedown', pageNode(shell), from, { button: 0, buttons: 1, ctrl });
  fire(shell, 'mousemove', document.body, to, { buttons: 1, ctrl });
  const right = fire(shell, 'mousedown', pageNode(shell), to, { button: 2, buttons: 3, ctrl });
  fire(shell, 'mouseup', pageNode(shell), to, { button: 2, buttons: 1, ctrl });
  const menu = contextMenu(shell, pageNode(shell), to);
  fire(shell, 'mousemove', document.body, after, { buttons: 1, ctrl });
  fire(shell, 'mouseup', pageNode(shell), after, { button: 0, buttons: 0, ctrl });
  return { right, menu };
}

function drawSquare(shell, from, to) {
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  fire(shell, 'mousedown', pageNode(shell), px(shell, from), { buttons: 1 });
  fire(shell, 'mousemove', shell.document.body, px(shell, to), { buttons: 1 });
  fire(shell, 'mouseup', pageNode(shell), px(shell, to));
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

const count = (shell) => shell.SigK.viewer.getAnnotations().added.length;
const selection = (shell) => [...shell.SigK.annotate.getSelection()];
const rectOf = (shell, id) => [...shell.SigK.viewer.getAnnotations().added.find((entry) => entry.id === id).rect];

test('図形とペンの描きかけの途中で左＋右を押すと、描きかけを捨ててハンドになり、離しても何も描かれない（確定事項E2・E5）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  for (const tool of ['shape', 'pen']) {
    SigK.annotate.setTool(tool);
    const { right, menu } = chordDrag(shell, px(shell, [100, 600]), px(shell, [200, 500]), { after: px(shell, [250, 450]) });
    assert.equal(right.defaultPrevented, true);
    assert.equal(menu.defaultPrevented, true);
    assert.equal(count(shell), 0, tool);
    assert.equal(SigK.annotate.getTool(), 'hand', tool);
    assert.equal(document.querySelector('.annot-draft'), null, '下書きが残らない');
    assert.equal(SigK.annotatePointer.isDrawing(), false);
    assert.equal(SigK.annotationMenu.isOpen(), false);
  }
});

test('テキスト・ノートの道具で押した（置く前）ところで左＋右を押すと、離しても置かれない（確定事項E2・E5）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  for (const tool of ['text', 'note']) {
    SigK.annotate.setTool(tool);
    chordDrag(shell, px(shell, [300, 400]), px(shell, [300, 400]));
    assert.equal(document.querySelector('.free-text-editor'), null, tool);
    assert.equal(count(shell), 0, tool);
    assert.equal(SigK.annotate.getTool(), 'hand');
  }
});

test('範囲選択の途中で左＋右を押すと、押す前の選択に戻ってハンドになる（確定事項E2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 600], [150, 550]);
  drawSquare(shell, [300, 600], [350, 550]);
  SigK.annotate.setTool('select');
  SigK.annotate.select(a);
  chordDrag(shell, px(shell, [250, 650]), px(shell, [400, 500]), { after: px(shell, [420, 480]) });
  assert.deepEqual(selection(shell), [a]);
  assert.equal(document.querySelector('.annot-marquee'), null);
  assert.equal(SigK.annotate.getTool(), 'hand');
});

test('掴んで動かしている途中（写しの途中も）で左＋右を押すと、元の位置に戻り、写しは作らない（確定事項E2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 600], [200, 500]);
  const before = rectOf(shell, a);
  for (const ctrl of [false, true]) {
    SigK.annotate.setTool(null);
    SigK.annotate.select(a);
    chordDrag(shell, px(shell, [150, 550]), px(shell, [250, 450]), { after: px(shell, [260, 440]), ctrl });
    assert.deepEqual(rectOf(shell, a), before, String(ctrl));
    assert.equal(count(shell), 1, '写しは作らない');
    assert.equal(document.querySelector('.annot-ghost'), null);
    assert.equal(SigK.annotatePointer.isDragging(), false);
    assert.equal(SigK.annotate.getTool(), 'hand');
  }
});

test('つまみを引いている途中で左＋右を押すと、元の形に戻る（確定事項E2）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 600], [200, 500]);
  const before = rectOf(shell, a);
  SigK.annotate.select(a);
  const corner = SigK.annotationFrame.shown().shape.handles.find((handle) => handle.id === 'x1y1').at;
  chordDrag(shell, corner, [corner[0] - 50, corner[1] - 50]);
  assert.deepEqual(rectOf(shell, a), before);
  assert.equal(SigK.annotate.getTool(), 'hand');
});

test('ハンドで引いている途中で左＋右を押すと、そこで引くのを終えて戻り先の道具になる（確定事項B の表・E2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const view = document.getElementById('view');
  SigK.annotate.setTool('select');
  SigK.annotate.setTool('hand');
  chordDrag(shell, [300, 300], [300, 250], { after: [300, 100] });
  assert.equal(view.scrollTop, 50, '左＋右の後の動きでは引かない');
  assert.equal(document.documentElement.hasAttribute('data-panning'), false);
  assert.equal(SigK.annotate.getTool(), 'select');
});

test('文字をなぞっている途中で左＋右を押すと、文字の選択を外し、全部離すまで選び直させず、マークアップも作らない（確定事項E2・E5。事前調査 B）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  SigK.annotate.setTool('highlight');
  const span = document.querySelector('.pdf-page[data-page="1"] .textLayer span');
  const select = () => {
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  };
  fire(shell, 'mousedown', pageNode(shell), px(shell, [50, 705]), { button: 0, buttons: 1 });
  select();
  fire(shell, 'mousedown', pageNode(shell), px(shell, [100, 705]), { button: 2, buttons: 3 });
  assert.equal(window.getSelection().rangeCount, 0, '右を押した時点で外す');
  const start = new window.Event('selectstart', { bubbles: true, cancelable: true });
  span.dispatchEvent(start);
  assert.equal(start.defaultPrevented, true, '全部離すまで選び直させない');
  // ブラウザが選択を伸ばしても、左で動かすたびに外す。
  select();
  fire(shell, 'mousemove', document.body, px(shell, [110, 705]), { buttons: 1 });
  assert.equal(window.getSelection().rangeCount, 0);
  fire(shell, 'mouseup', pageNode(shell), px(shell, [110, 705]), { button: 2, buttons: 1 });
  fire(shell, 'mouseup', pageNode(shell), px(shell, [110, 705]), { button: 0, buttons: 0 });
  assert.equal(count(shell), 0);
  assert.equal(SigK.annotate.getTool(), 'hand');
  const after = new window.Event('selectstart', { bubbles: true, cancelable: true });
  span.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false, '離した後は止めない');
});

test('右が先で左が後でも、両方そろった時点で 1 回だけ切り替える（確定事項E1）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('pen');
  const at = px(shell, [300, 300]);
  fire(shell, 'mousedown', pageNode(shell), at, { button: 2, buttons: 2 });
  assert.equal(SigK.annotate.getTool(), 'pen', '右だけでは替わらない');
  const left = fire(shell, 'mousedown', pageNode(shell), at, { button: 0, buttons: 3 });
  assert.equal(left.defaultPrevented, true);
  assert.equal(SigK.annotate.getTool(), 'hand');
  fire(shell, 'mousemove', document.body, [at[0] + 30, at[1]], { buttons: 3 });
  fire(shell, 'mouseup', pageNode(shell), at, { button: 0, buttons: 2 });
  fire(shell, 'mouseup', pageNode(shell), at, { button: 2, buttons: 0 });
  contextMenu(shell, pageNode(shell), at);
  assert.equal(SigK.annotate.getTool(), 'hand');
  assert.equal(count(shell), 0);
  assert.equal(document.getElementById('view').scrollLeft, 0, '左＋右の後の動きでは引かない');
});

test('左を押したまま右を何度押しても、切り替えは 1 回だけ（確定事項E3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const at = px(shell, [300, 300]);
  fire(shell, 'mousedown', pageNode(shell), at, { button: 0, buttons: 1 });
  for (let i = 0; i < 3; i += 1) {
    fire(shell, 'mousedown', pageNode(shell), at, { button: 2, buttons: 3 });
    fire(shell, 'mouseup', pageNode(shell), at, { button: 2, buttons: 1 });
    contextMenu(shell, pageNode(shell), at);
  }
  assert.equal(SigK.annotate.getTool(), 'hand');
  fire(shell, 'mouseup', pageNode(shell), at, { button: 0, buttons: 0 });
  assert.equal(SigK.annotateRightButton.isChording(), false);
});

test('全部離した後も 1000ms までの contextmenu は捨てる。過ぎればふつうにメニューを出す（確定事項E4）', async (t) => {
  const shell = await withShell(t);
  const { SigK, window } = shell;
  let clock = 5000;
  window.performance.now = () => clock;
  const a = drawSquare(shell, [100, 600], [200, 500]);
  const on = px(shell, [150, 550]);
  fire(shell, 'mousedown', pageNode(shell), on, { button: 0, buttons: 1 });
  fire(shell, 'mousedown', pageNode(shell), on, { button: 2, buttons: 3 });
  fire(shell, 'mouseup', pageNode(shell), on, { button: 0, buttons: 2 });
  fire(shell, 'mouseup', pageNode(shell), on, { button: 2, buttons: 0 });
  clock += 900;
  assert.equal(contextMenu(shell, pageNode(shell), on).defaultPrevented, true);
  assert.equal(SigK.annotationMenu.isOpen(), false);
  assert.deepEqual(selection(shell), []);
  clock += 200;
  fire(shell, 'mousedown', pageNode(shell), on, { button: 2, buttons: 2 });
  fire(shell, 'mouseup', pageNode(shell), on, { button: 2, buttons: 0 });
  contextMenu(shell, pageNode(shell), on);
  assert.equal(SigK.annotationMenu.isOpen(), true);
  assert.deepEqual(selection(shell), [a]);
});

test('ボタンを押していない動き（窓の外で離したとき）が届いたら、左＋右の後の捨てる状態を解く（確定事項E2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  const at = px(shell, [300, 300]);
  fire(shell, 'mousedown', pageNode(shell), at, { button: 0, buttons: 1 });
  fire(shell, 'mousedown', pageNode(shell), at, { button: 2, buttons: 3 });
  assert.equal(SigK.annotateRightButton.isChording(), true);
  fire(shell, 'mousemove', document.body, at, { buttons: 0 });
  assert.equal(SigK.annotateRightButton.isChording(), false);
  fire(shell, 'mousedown', pageNode(shell), at, { button: 0, buttons: 1 });
  fire(shell, 'mousedown', pageNode(shell), at, { button: 2, buttons: 3 });
  window.dispatchEvent(new window.Event('blur'));
  assert.equal(SigK.annotateRightButton.isChording(), false, '窓のフォーカスが外れても解く');
});

test('閲覧モードと、テキストの入力欄の中では、左＋右は効かない（確定事項E1）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('pen');
  SigK.annotate.setTool('text');
  fire(shell, 'mousedown', pageNode(shell), [300, 300], { button: 0, buttons: 1 });
  fire(shell, 'mouseup', pageNode(shell), [300, 300], { button: 0, buttons: 0 });
  const field = document.querySelector('.free-text-editor');
  assert.notEqual(field, null);
  fire(shell, 'mousedown', field, [305, 305], { button: 0, buttons: 1 });
  const inField = fire(shell, 'mousedown', field, [305, 305], { button: 2, buttons: 3 });
  assert.equal(inField.defaultPrevented, false);
  assert.equal(SigK.annotate.getTool(), 'text');
  fire(shell, 'mouseup', field, [305, 305], { button: 0, buttons: 0 });
  SigK.annotate.finishEditing();

  SigK.shell.setMode(document, 'view');
  fire(shell, 'mousedown', pageNode(shell), [300, 300], { button: 0, buttons: 1 });
  const inView = fire(shell, 'mousedown', pageNode(shell), [300, 300], { button: 2, buttons: 3 });
  assert.equal(inView.defaultPrevented, false);
  assert.equal(SigK.annotate.getTool(), 'text');
});

test('左＋右を 1 秒より長く押したまま右を最後に離しても、続く contextmenu ではメニューを出さない（確定事項E4。1000ms は全部離した時点から数える）', async (t) => {
  const shell = await withShell(t);
  const { SigK, window } = shell;
  let clock = 5000;
  window.performance.now = () => clock;
  drawSquare(shell, [100, 600], [200, 500]);
  const on = px(shell, [150, 550]);
  fire(shell, 'mousedown', pageNode(shell), on, { button: 0, buttons: 1 });
  fire(shell, 'mousedown', pageNode(shell), on, { button: 2, buttons: 3 });
  clock += 1500;
  fire(shell, 'mouseup', pageNode(shell), on, { button: 0, buttons: 2 });
  fire(shell, 'mouseup', pageNode(shell), on, { button: 2, buttons: 0 });
  assert.equal(contextMenu(shell, pageNode(shell), on).defaultPrevented, true);
  assert.equal(SigK.annotationMenu.isOpen(), false);
  assert.deepEqual(selection(shell), []);
});

test('つまみの上で右→左の順に押してハンドになっても、つまみのカーソルの形を残さない（確定事項A4・E2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 600], [200, 500]);
  SigK.annotate.setTool('select');
  SigK.annotate.select(a);
  const corner = SigK.annotationFrame.shown().shape.handles.find((handle) => handle.id === 'x1y1');
  fire(shell, 'mousemove', document.body, corner.at, { buttons: 0 });
  assert.equal(document.documentElement.getAttribute('data-transform-cursor'), corner.cursor);
  fire(shell, 'mousedown', pageNode(shell), corner.at, { button: 2, buttons: 2 });
  fire(shell, 'mousedown', pageNode(shell), corner.at, { button: 0, buttons: 3 });
  assert.equal(SigK.annotate.getTool(), 'hand');
  assert.equal(document.documentElement.hasAttribute('data-transform-cursor'), false);
  fire(shell, 'mouseup', pageNode(shell), corner.at, { button: 0, buttons: 2 });
  fire(shell, 'mouseup', pageNode(shell), corner.at, { button: 2, buttons: 0 });
  fire(shell, 'mousemove', document.body, corner.at, { buttons: 0 });
  assert.equal(document.documentElement.hasAttribute('data-transform-cursor'), false, 'ハンドのときはつまみの上でも付けない');
});

test('左＋右の最中と、全部離してから 1000ms までのダブルクリックでは、書き込みを直し始めない（確定事項E2・E4）', async (t) => {
  const shell = await withShell(t);
  const { SigK, window } = shell;
  let clock = 5000;
  window.performance.now = () => clock;
  drawSquare(shell, [100, 600], [200, 500]);
  const calls = [];
  SigK.annotateText.beginEdit = (key) => { calls.push(key); return true; };
  const on = px(shell, [150, 550]);
  const dblclick = (buttons) => pageNode(shell).dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: on[0], clientY: on[1], button: 0, buttons }));
  SigK.annotate.setTool('hand');
  fire(shell, 'mousedown', pageNode(shell), on, { button: 2, buttons: 2 });
  fire(shell, 'mousedown', pageNode(shell), on, { button: 0, buttons: 3 });
  fire(shell, 'mouseup', pageNode(shell), on, { button: 0, buttons: 2 });
  fire(shell, 'mousedown', pageNode(shell), on, { button: 0, buttons: 3 });
  fire(shell, 'mouseup', pageNode(shell), on, { button: 0, buttons: 2 });
  dblclick(2);
  assert.equal(calls.length, 0, '最中');
  fire(shell, 'mouseup', pageNode(shell), on, { button: 2, buttons: 0 });
  clock += 500;
  dblclick(0);
  assert.equal(calls.length, 0, '離してから 1000ms まで');
  clock += 600;
  dblclick(0);
  assert.equal(calls.length, 1, '過ぎればふつうに直し始める（道具は戻り先の道具なし）');
});
