'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

require('../renderer/annotation-menu.js');

// 書き込みの上の右クリックで出す「削除」のメニュー（spec-4b-3b 確定事項D7〜D10。モック screenshots/phase4b-3-menu.png）。
// 開くきっかけ（右クリックの当たり）は annotate-right-button.test.js が見る。ここはメニューそのもの（置き場所・項目・閉じるきっかけ）。

const { placeAt, MARGIN } = globalThis.SigK.annotationMenu;
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

function menuEl(shell) {
  return shell.document.getElementById('annot-menu');
}

test('placeAt は窓に収まればその点に置き、はみ出せば端から 4px の内側へ押し戻す（確定事項D7）', () => {
  const size = { width: 132, height: 40 };
  const win = { width: 800, height: 600 };
  assert.equal(MARGIN, 4);
  assert.deepEqual(placeAt({ x: 100, y: 200 }, size, win), { left: 100, top: 200 });
  assert.deepEqual(placeAt({ x: 790, y: 200 }, size, win), { left: 664, top: 200 });
  assert.deepEqual(placeAt({ x: 100, y: 590 }, size, win), { left: 100, top: 556 });
  assert.deepEqual(placeAt({ x: 790, y: 590 }, size, win), { left: 664, top: 556 });
  assert.deepEqual(placeAt({ x: -10, y: 1 }, size, win), { left: 4, top: 4 });
  assert.deepEqual(placeAt({ x: 50, y: 50 }, size, { width: 100, height: 30 }), { left: 4, top: 4 }, '窓より大きければ左上に寄せる');
});

test('メニューは役割 menu で、項目は「削除」1 つ（ごみ箱のアイコンと、右に Delete）。開いた点に置く（確定事項D7）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const el = menuEl(shell);
  assert.equal(el.getAttribute('role'), 'menu');
  assert.equal(el.hidden, true);
  const items = el.querySelectorAll('[role="menuitem"]');
  assert.equal(items.length, 1);
  assert.equal(items[0].querySelector('.label').textContent, '削除');
  assert.equal(items[0].querySelector('.key').textContent, 'Delete');
  assert.notEqual(items[0].querySelector('svg'), null);
  assert.equal(SigK.annotationMenu.open(120, 240), true);
  assert.equal(SigK.annotationMenu.isOpen(), true);
  assert.equal(el.hidden, false);
  assert.equal(el.style.left, '120px');
  assert.equal(el.style.top, '240px');
});

test('「削除」を押すと、選んでいる全部を消して 1 世代積み、メニューを閉じる。押してもフォーカスは移さない（確定事項D3・D8・D10）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  SigK.annotate.selectKeys([a, b]);
  SigK.annotationMenu.open(10, 10);
  const item = menuEl(shell).querySelector('[role="menuitem"]');
  const down = new shell.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 });
  item.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true, 'フォーカスを移さない');
  item.click();
  assert.equal(SigK.annotationMenu.isOpen(), false);
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.length, 2, 'Ctrl+Z 1 回で 2 件とも戻る');
});

test('メニューの外を左で押すと閉じ、その押しが紙の上なら飲む（テキストを置かない）。右で押して閉じたら飲まない（確定事項D8・D9）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('text');
  SigK.annotationMenu.open(10, 10);
  mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
  assert.equal(SigK.annotationMenu.isOpen(), false);
  mouse(shell, 'mouseup', pageNode(shell), [300, 300]);
  assert.equal(document.querySelector('.free-text-editor'), null, '閉じた押しではテキストを置かない');
  // 次の押しはふつうに効く。
  mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
  mouse(shell, 'mouseup', pageNode(shell), [300, 300]);
  assert.notEqual(document.querySelector('.free-text-editor'), null);
  SigK.annotate.finishEditing();

  SigK.annotationMenu.open(10, 10);
  mouse(shell, 'mousedown', pageNode(shell), [300, 300], { button: 2 });
  assert.equal(SigK.annotationMenu.isOpen(), false);
  mouse(shell, 'mouseup', pageNode(shell), [300, 300], { button: 2 });
  assert.equal(SigK.annotationMenu.takeSwallow(), false, '右の押しは飲まない');
});

test('Esc はメニューだけを閉じ、選択は残す。ほかのキーも閉じる（確定事項D8・G）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  SigK.annotationMenu.open(10, 10);
  document.body.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(SigK.annotationMenu.isOpen(), false);
  assert.equal(SigK.annotate.getSelected(), a);
  SigK.annotationMenu.open(10, 10);
  document.body.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Shift', bubbles: true, cancelable: true }));
  assert.equal(SigK.annotationMenu.isOpen(), true, '修飾キーだけでは閉じない');
  document.body.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
  assert.equal(SigK.annotationMenu.isOpen(), false);
});

test('スクロール・ホイール・窓の大きさ・窓のフォーカス・モードの切り替え・選択の変化で閉じる（確定事項D8）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const view = document.getElementById('view');
  const triggers = [
    () => view.dispatchEvent(new window.Event('scroll')),
    () => view.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 })),
    () => window.dispatchEvent(new window.Event('resize')),
    () => window.dispatchEvent(new window.Event('blur')),
    () => SigK.annotate.select(a),
    () => SigK.shell.setMode(document, 'view'),
  ];
  for (const [i, fire] of triggers.entries()) {
    SigK.shell.setMode(document, 'annot');
    SigK.annotate.select(null);
    SigK.annotationMenu.open(10, 10);
    fire();
    assert.equal(SigK.annotationMenu.isOpen(), false, `きっかけ ${i}`);
  }
});
