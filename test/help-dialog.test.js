'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 使い方の窓（spec-4b-7b 確定事項A〜C）。中身は help-content.test.js、組み立ては help-render.test.js が見る。

const A = 'C:\\work\\a.pdf';

async function withShell(t, { open = true } = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  if (open) {
    await shell.SigK.tabs.openPath(A);
    await shell.flush();
  }
  return shell;
}

function key(shell, target, name, init = {}) {
  const event = new shell.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function pointer(shell, type, buttons) {
  shell.document.body.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, buttons }));
}

function click(shell, node) {
  node.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

const dialog = (shell) => shell.document.getElementById('help-dialog');
const isOpen = (shell) => dialog(shell).hasAttribute('open');
const shown = (shell) => [...dialog(shell).querySelectorAll('.help-section')].filter((node) => !node.hidden).map((node) => node.dataset.section);
const marked = (shell) => [...dialog(shell).querySelectorAll('.help-item[aria-current="true"]')].map((node) => node.dataset.section);

// ---- 部品（確定事項A1・B1・E） ----

test('ツールバーの右端（印刷の右）に「？」のボタンがあり、文書が無くても押せる', async (t) => {
  const shell = await withShell(t, { open: false });
  const button = shell.document.getElementById('btn-help');
  assert.equal(button.previousElementSibling.id, 'btn-print');
  assert.equal(button.nextElementSibling, null);
  assert.equal(button.className, 'tb-btn icon');
  assert.equal(button.title, '使い方 (F1)');
  assert.equal(button.getAttribute('aria-label'), '使い方');
  assert.equal(button.getAttribute('aria-disabled'), null);
  assert.ok(shell.SigK.icons.has('help'));
  assert.notEqual(button.querySelector('svg'), null, 'アイコンが出ていない');
});

test('窓の中は、題・目次の 13 節・本文の 13 節を起動のときに組んである', async (t) => {
  const shell = await withShell(t, { open: false });
  const { SigK } = shell;
  assert.equal(shell.document.getElementById('help-title').textContent, SigK.helpContent.TITLE);
  const items = [...dialog(shell).querySelectorAll('.help-nav .help-item')].map((node) => node.dataset.section);
  assert.deepEqual(items, Array.from(SigK.helpContent.SECTIONS, (section) => section.id));
  assert.equal(dialog(shell).querySelectorAll('.help-nav .help-grp').length, 5);
  assert.equal(dialog(shell).querySelectorAll('.help-body .help-section').length, 13);
  assert.deepEqual(shown(shell), []);
  assert.notEqual(shell.document.querySelector('#help-close svg'), null);
  assert.equal(shell.document.getElementById('help-done').textContent, '閉じる');
});

// ---- 入口（確定事項A） ----

test('ボタンで開くと、文書が無いときは「画面とモード」を出し、目次の今の節にフォーカスを置く', async (t) => {
  const shell = await withShell(t, { open: false });
  click(shell, shell.document.getElementById('btn-help'));
  assert.equal(isOpen(shell), true);
  assert.deepEqual(shown(shell), ['basics']);
  assert.deepEqual(marked(shell), ['basics']);
  assert.equal(shell.document.activeElement.dataset.section, 'basics');
  assert.equal(shell.SigK.helpDialog.current(shell.document), 'basics');
});

test('F1 で開く。文書が無くても、文字を打つ欄の中でも開く', async (t) => {
  const shell = await withShell(t, { open: false });
  const event = key(shell, shell.document.body, 'F1');
  assert.equal(event.defaultPrevented, true);
  assert.equal(isOpen(shell), true);
  shell.SigK.helpDialog.close(shell.document);

  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.findBar.open();
  const input = shell.document.getElementById('find-input');
  input.focus();
  key(shell, input, 'F1');
  assert.equal(isOpen(shell), true);
  assert.deepEqual(shown(shell), ['view']);
});

test('Ctrl・Alt を押しながらの F1 では開かない', async (t) => {
  const shell = await withShell(t);
  key(shell, shell.document.body, 'F1', { ctrlKey: true });
  key(shell, shell.document.body, 'F1', { altKey: true });
  assert.equal(isOpen(shell), false);
});

test('メニュー「ヘルプ」→「使い方」の合図で開く', async (t) => {
  const shell = await withShell(t);
  shell.fireHelpRequest();
  assert.equal(isOpen(shell), true);
  assert.deepEqual(shown(shell), ['view']);
});

test('マウスのボタンを押している間の F1 は開かない。離せば開く（確定事項A3）', async (t) => {
  const shell = await withShell(t);
  pointer(shell, 'pointerdown', 1);
  const event = key(shell, shell.document.body, 'F1');
  assert.equal(event.defaultPrevented, true);
  assert.equal(isOpen(shell), false);
  // 左を押したまま右を押した（pointermove で buttons が 3）あとで、両方を離す。
  pointer(shell, 'pointermove', 3);
  key(shell, shell.document.body, 'F1');
  assert.equal(isOpen(shell), false);
  pointer(shell, 'pointerup', 0);
  key(shell, shell.document.body, 'F1');
  assert.equal(isOpen(shell), true);
});

// ---- 二重に開かない・ほかの窓（確定事項B7） ----

test('開いている間に開く口を呼んでも、何もせず今の節も替えない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.helpDialog.open(document);
  SigK.helpDialog.show(document, 'keys');
  assert.equal(SigK.helpDialog.open(document), false);
  key(shell, document.body, 'F1');
  shell.fireHelpRequest();
  assert.deepEqual(shown(shell), ['keys']);
});

test('ほかの窓（文書情報）が開いている間は、F1 でもメニューの合図でも開かない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  await SigK.docInfo.open(document);
  key(shell, document.body, 'F1');
  shell.fireHelpRequest();
  assert.equal(SigK.helpDialog.open(document), false);
  assert.equal(isOpen(shell), false);
});

// ---- 閉じる（確定事項B6） ----

test('× と［閉じる］で閉じる', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.helpDialog.open(document);
  click(shell, document.getElementById('help-close'));
  assert.equal(isOpen(shell), false);
  SigK.helpDialog.open(document);
  click(shell, document.getElementById('help-done'));
  assert.equal(isOpen(shell), false);
  assert.equal(SigK.helpDialog.current(document), null);
  assert.equal(SigK.helpDialog.close(document), false);
});

test('開いている間は下の画面にキーが届かず、閉じたあと道具・選択・検索バーが残る', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'annot');
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  const node = document.querySelector('.pdf-page[data-page="1"]');
  const px = (point) => SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
  const mouse = (type, target, [x, y]) => target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  mouse('mousedown', node, px([100, 700]));
  mouse('mousemove', document.body, px([200, 600]));
  mouse('mouseup', node, px([200, 600]));
  const id = SigK.viewer.getAnnotations().added.at(-1).id;
  SigK.findBar.open();

  key(shell, document.body, 'F1');
  assert.deepEqual(shown(shell), ['shapes']);
  key(shell, document.body, 'Delete');
  key(shell, document.body, 'Escape');
  assert.equal(SigK.viewer.getAnnotations().added.length, 1, '窓の後ろで書き込みが消えた');
  click(shell, document.getElementById('help-done'));

  assert.equal(SigK.annotate.getTool(), 'shape');
  assert.equal(SigK.annotate.getSelected(), id);
  assert.equal(SigK.findBar.isOpen(), true);
});

// ---- 開いたときの節（確定事項C） ----

test('sectionFor は、モード・文書の有無・道具で節を選ぶ', async (t) => {
  const { SigK } = await withShell(t, { open: false });
  const pick = (mode, tool = null, open = true) => SigK.helpDialog.sectionFor({ mode, open, tool });
  assert.equal(pick('tools', null, false), 'tools');
  assert.equal(pick('tools'), 'tools');
  assert.equal(pick('view', null, false), 'basics');
  assert.equal(pick('annot', 'pen', false), 'basics');
  assert.equal(pick('view'), 'view');
  assert.equal(pick('pages'), 'pages');
  const tools = {
    null: 'select', select: 'select', hand: 'select',
    highlight: 'markup', underline: 'markup', strikeout: 'markup',
    text: 'text', callout: 'text', shape: 'shapes',
    pen: 'pen', marker: 'pen', eraser: 'pen', note: 'note', mosaic: 'mosaic-trim', trim: 'mosaic-trim',
  };
  for (const [tool, section] of Object.entries(tools))
    assert.equal(pick('annot', tool === 'null' ? null : tool), section, tool);
  // 中身に無い節を選ばない。
  const ids = new Set(SigK.helpContent.SECTIONS.map((section) => section.id));
  for (const section of Object.values(tools))
    assert.ok(ids.has(section), section);
});

test('開いたときは、今のモードと持っている道具の節を出す', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const openedAt = () => {
    SigK.helpDialog.open(document);
    const [section] = shown(shell);
    SigK.helpDialog.close(document);
    return section;
  };
  SigK.shell.setMode(document, 'pages');
  assert.equal(openedAt(), 'pages');
  SigK.shell.setMode(document, 'annot');
  SigK.annotate.setTool('marker');
  assert.equal(openedAt(), 'pen');
  SigK.annotate.setTool('trim');
  assert.equal(openedAt(), 'mosaic-trim');
  SigK.shell.setMode(document, 'tools');
  assert.equal(openedAt(), 'tools');
});

// ---- 目次（確定事項B3・B4） ----

test('目次の節を押すと、右の本文がその節に替わり、印が移る', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.helpDialog.open(document);
  click(shell, dialog(shell).querySelector('.help-item[data-section="escape"]'));
  assert.deepEqual(shown(shell), ['escape']);
  assert.deepEqual(marked(shell), ['escape']);
  assert.equal(dialog(shell).querySelector('.help-section[data-section="escape"] h3').textContent, 'Esc で取りやめる順');
});

test('目次で ↓↑ は次・前、Home・End は最初・最後の節へ移り、端で止まる', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.helpDialog.open(document);
  const nav = dialog(shell).querySelector('.help-nav');
  const press = (name) => key(shell, document.activeElement ?? nav, name);
  assert.equal(press('ArrowDown').defaultPrevented, true);
  assert.deepEqual(shown(shell), ['pages']);
  assert.equal(document.activeElement.dataset.section, 'pages');
  press('ArrowUp');
  press('ArrowUp');
  assert.deepEqual(shown(shell), ['basics']);
  press('ArrowUp');
  assert.deepEqual(shown(shell), ['basics']);
  press('End');
  assert.deepEqual(shown(shell), ['escape']);
  press('ArrowDown');
  assert.deepEqual(shown(shell), ['escape']);
  press('Home');
  assert.deepEqual(shown(shell), ['basics']);
  assert.deepEqual(marked(shell), ['basics']);
});

// ---- 点検の直し ----

test('目次で Tab が止まるのは今の節のボタンだけ（ロービング）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.helpDialog.open(document);
  const stops = () => [...dialog(shell).querySelectorAll('.help-item')].filter((node) => node.tabIndex === 0).map((node) => node.dataset.section);
  assert.deepEqual(stops(), ['view']);
  SigK.helpDialog.show(document, 'keys');
  assert.deepEqual(stops(), ['keys']);
  assert.equal(dialog(shell).querySelector('.help-body').tabIndex, 0);
});

test('↓↑ は、フォーカスのある目次のボタンから数える。修飾キー付きでは動かない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.helpDialog.open(document);
  const select = dialog(shell).querySelector('.help-item[data-section="select"]');
  select.focus();
  key(shell, select, 'ArrowDown');
  assert.deepEqual(shown(shell), ['markup']);
  assert.equal(key(shell, document.activeElement, 'ArrowDown', { shiftKey: true }).defaultPrevented, false);
  key(shell, document.activeElement, 'ArrowDown', { ctrlKey: true });
  assert.deepEqual(shown(shell), ['markup']);
});

test('開き直すと、本文は先頭から出る', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.helpDialog.open(document);
  const body = dialog(shell).querySelector('.help-body');
  body.scrollTop = 300;
  SigK.helpDialog.close(document);
  SigK.helpDialog.open(document);
  assert.equal(body.scrollTop, 0);
});

test('F1 の押し続けの繰り返しと IME の変換中は開かない', async (t) => {
  const shell = await withShell(t);
  const repeat = key(shell, shell.document.body, 'F1', { repeat: true });
  assert.equal(repeat.defaultPrevented, true);
  key(shell, shell.document.body, 'F1', { isComposing: true });
  key(shell, shell.document.body, 'F1', { keyCode: 229 });
  assert.equal(isOpen(shell), false);
  key(shell, shell.document.body, 'F1');
  assert.equal(isOpen(shell), true);
});

test('マウスのボタンを押している間は、メニューの合図でも開かない', async (t) => {
  const shell = await withShell(t);
  pointer(shell, 'pointerdown', 1);
  shell.fireHelpRequest();
  assert.equal(isOpen(shell), false);
  pointer(shell, 'pointerup', 0);
  shell.fireHelpRequest();
  assert.equal(isOpen(shell), true);
});

test('押しているボタンの控えは、pointercancel と窓の blur でも外れる', async (t) => {
  const shell = await withShell(t);
  pointer(shell, 'pointerdown', 1);
  pointer(shell, 'pointercancel', 0);
  key(shell, shell.document.body, 'F1');
  assert.equal(isOpen(shell), true);
  shell.SigK.helpDialog.close(shell.document);
  pointer(shell, 'pointerdown', 1);
  shell.window.dispatchEvent(new shell.window.Event('blur'));
  key(shell, shell.document.body, 'F1');
  assert.equal(isOpen(shell), true);
});

test('紙の上の文字の入力欄で F1 を押し、窓の中をマウスで押しても、入力欄は確定しない（確定事項A5）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  SigK.shell.setMode(document, 'annot');
  SigK.annotate.setTool('text');
  const page = document.querySelector('.pdf-page[data-page="1"]');
  const [x, y] = SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(100, 700);
  for (const type of ['mousedown', 'mouseup'])
    page.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  const editor = document.querySelector('textarea.free-text-editor');
  editor.value = '打ちかけ';
  editor.dispatchEvent(new window.Event('input', { bubbles: true }));
  key(shell, editor, 'F1');
  assert.equal(isOpen(shell), true);

  // 本物のマウスと同じ順（pointerdown → mousedown → pointerup → mouseup → click）で、目次・本文・［閉じる］を押す。
  const press = (node) => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      node.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, buttons: type.endsWith('down') ? 1 : 0 }));
  };
  press(dialog(shell).querySelector('.help-item[data-section="keys"]'));
  press(dialog(shell).querySelector('.help-body'));
  press(document.getElementById('help-done'));
  assert.equal(isOpen(shell), false);
  assert.notEqual(document.querySelector('textarea.free-text-editor'), null, '入力欄が閉じた');
  assert.equal(SigK.viewer.getAnnotations().added.length, 0, '打ちかけが書き込みになった');
});
