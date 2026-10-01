'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 右クリック（spec-4b-3b 確定事項D）。書き込みの上なら（選んでいなければそれだけ選んでから）「削除」のメニューを出す。紙の空白では
// 何もしない（道具も替えない。決定53 ⑥）。ハンドのときも同じ。メニューを出すかどうかは、離した後に届く contextmenu で決める。
// jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま .pdf-page 基準の CSS px になる。

const A = 'C:\\work\\a.pdf';

async function withShell(t) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
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

function mouse(shell, type, target, [x, y], { button = 0 } = {}) {
  const buttons = type === 'mouseup' ? 0 : [1, 4, 2][button];
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons });
  target.dispatchEvent(event);
  return event;
}

// 右で押して離し、contextmenu を投げる（事前調査 A の順）。返すのは { down, menu }（どちらも投げたイベント）。
function rightClick(shell, target, at) {
  const down = mouse(shell, 'mousedown', target, at, { button: 2 });
  mouse(shell, 'mouseup', target, at, { button: 2 });
  const menu = new shell.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], button: 2 });
  target.dispatchEvent(menu);
  return { down, menu };
}

function drawSquare(shell, from, to) {
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, from));
  mouse(shell, 'mousemove', shell.document.body, px(shell, to));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, to));
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

const selection = (shell) => [...shell.SigK.annotate.getSelection()];

test('編集モードでは右の mousedown と contextmenu の既定の動きを止める。閲覧モードでは止めない（確定事項D1・D2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const inAnnot = rightClick(shell, pageNode(shell), [300, 300]);
  assert.equal(inAnnot.down.defaultPrevented, true, '今ある文字の選択を消さない');
  assert.equal(inAnnot.menu.defaultPrevented, true);
  SigK.shell.setMode(document, 'view');
  const inView = rightClick(shell, pageNode(shell), [300, 300]);
  assert.equal(inView.down.defaultPrevented, false);
  assert.equal(inView.menu.defaultPrevented, false);
});

test('選んでいない書き込みの上で右クリックすると、それだけを選んでから、押した点に「削除」のメニューを出す。道具は替えない（確定事項D3・B）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  for (const tool of [null, 'select', 'pen', 'hand']) {
    SigK.annotate.setTool(tool);
    SigK.annotate.select(b);
    SigK.annotationMenu.close();
    const at = px(shell, [150, 650]);
    rightClick(shell, pageNode(shell), at);
    assert.deepEqual(selection(shell), [a], String(tool));
    assert.equal(SigK.annotationMenu.isOpen(), true, String(tool));
    assert.equal(shell.document.getElementById('annot-menu').style.left, `${at[0]}px`);
    assert.equal(SigK.annotate.getTool(), tool, '道具はそのまま');
  }
});

test('複数選んでいる 1 件の上で右クリックすると、選択はそのままでメニューを出し、「削除」で全部消える（確定事項D3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  SigK.annotate.selectKeys([a, b]);
  rightClick(shell, pageNode(shell), px(shell, [150, 650]));
  assert.deepEqual(selection(shell), [a, b]);
  assert.equal(SigK.annotationMenu.isOpen(), true);
  shell.document.querySelector('#annot-menu [role="menuitem"]').click();
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
});

test('紙の空白・紙の外で右クリックしても、メニューは出ず、選択も道具も変わらない。開いていたメニューは閉じる（確定事項D4）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  for (const tool of [null, 'select', 'shape', 'hand']) {
    SigK.annotate.setTool(tool);
    SigK.annotate.select(a);
    SigK.annotationMenu.open(10, 10);
    rightClick(shell, pageNode(shell), px(shell, [450, 300]));
    assert.equal(SigK.annotationMenu.isOpen(), false, String(tool));
    assert.deepEqual(selection(shell), [a]);
    assert.equal(SigK.annotate.getTool(), tool);
    rightClick(shell, document.getElementById('view'), [5, 5]);
    assert.equal(SigK.annotationMenu.isOpen(), false);
  }
});

test('選んでいる書き込みの枠の余白（書き込みの外、枠の中）で右クリックしても、メニューを出す（確定事項D3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const entry = SigK.viewer.getAnnotations().added.find((candidate) => candidate.id === a);
  const box = SigK.annotationFrame.boundsOf(entry, SigK.viewer.getTextLayer(0).viewport);
  // 右下の角のすぐ外（枠の余白 3px の中）。当たり判定（書き込みの箱）には当たらない。
  const at = [box.x + box.width + 2, box.y + box.height + 2];
  assert.equal(SigK.annotate.hitTest(0, at), null);
  rightClick(shell, pageNode(shell), at);
  assert.equal(SigK.annotationMenu.isOpen(), false, '選んでいなければ当たらない');
  SigK.annotate.select(a);
  rightClick(shell, pageNode(shell), at);
  assert.equal(SigK.annotationMenu.isOpen(), true);
  assert.deepEqual(selection(shell), [a]);
});

test('テキストの入力欄の上の右クリックは入力欄に任せる（確定事項D5）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotateText.place({ index: 0, point: [300, 300] });
  const field = document.querySelector('.free-text-editor');
  assert.notEqual(field, null);
  const { down, menu } = rightClick(shell, field, [305, 305]);
  assert.equal(down.defaultPrevented, false);
  assert.equal(menu.defaultPrevented, false);
  assert.equal(SigK.annotationMenu.isOpen(), false);
  assert.notEqual(document.querySelector('.free-text-editor'), null, '入力欄は開いたまま');
});

test('入力欄を閉じた右の押しのあとに届いた contextmenu は飲む（書き込みの上でもメニューを出さず、選ばない。確定事項D6）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotateText.place({ index: 0, point: [400, 100] });
  assert.notEqual(document.querySelector('.free-text-editor'), null);
  rightClick(shell, pageNode(shell), px(shell, [150, 650]));
  assert.equal(document.querySelector('.free-text-editor'), null, '入力欄は閉じた');
  assert.equal(SigK.annotationMenu.isOpen(), false);
  assert.deepEqual(selection(shell), []);
  // 次の右クリックはふつうに効く。
  rightClick(shell, pageNode(shell), px(shell, [150, 650]));
  assert.equal(SigK.annotationMenu.isOpen(), true);
  assert.deepEqual(selection(shell), [a]);
});
