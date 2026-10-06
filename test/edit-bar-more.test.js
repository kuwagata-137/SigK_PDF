'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 道具の段の「その他」の一覧（spec-4b-5b 確定事項26〜28）。隠す道具は測った値を渡して決める（edit-bar-overflow.test.js と同じ）。

const A = 'C:\\work\\a.pdf';

function childrenOf(document) {
  return [...document.getElementById('edit-bar').children].filter((node) => node.matches('.edit-sep, .edit-item:not(.edit-more)'));
}

// 右端の hide 個（ノートから左へ）を隠す。
function hideRight(shell, hide) {
  const children = childrenOf(shell.document).map((node) => ({ width: node.classList.contains('edit-sep') ? 7 : 48, sep: node.classList.contains('edit-sep') }));
  const keep = children.length - hide;
  const span = children.slice(0, keep).reduce((sum, child, index) => sum + child.width + (index > 0 ? 5 : 0), 0);
  shell.SigK.editBarOverflow.fit({ children, available: span + 5 + 48, gap: 5, padding: [0, 0], moreWidth: 48 });
}

async function withHidden(t, hide = 2) {
  const shell = await createShell({ pdfjs: createPdfjsStub(), files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  hideRight(shell, hide);
  return shell;
}

function key(shell, target, name) {
  const event = new shell.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

const rowNames = (document) => [...document.querySelectorAll('#edit-more-menu .edit-more-row')].map((row) => row.textContent);

test('「その他」を押すと隠した道具の一覧が開き、もう一度押すと閉じる', async (t) => {
  const { document, SigK } = await withHidden(t);
  const button = document.getElementById('edit-more');
  const menu = document.getElementById('edit-more-menu');
  button.click();
  assert.equal(menu.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(rowNames(document), ['マーカー', 'ノート']);
  assert.ok(document.querySelector('#edit-more-menu .edit-more-row svg') !== null, '行に道具のアイコン');
  assert.equal(document.activeElement.textContent, 'マーカー', '先頭の行に移る');
  button.click();
  assert.equal(menu.hidden, true);
  assert.equal(SigK.editBarMore.isOpen(), false);
});

test('一覧の道具を押すとその道具を持ち、一覧は閉じて「その他」が青くなる。もう一度選ぶと離す', async (t) => {
  const { document, SigK } = await withHidden(t);
  const button = document.getElementById('edit-more');
  button.click();
  document.querySelectorAll('#edit-more-menu .edit-more-row')[1].click();
  assert.equal(SigK.annotate.getTool(), 'note');
  assert.equal(SigK.editBarMore.isOpen(), false);
  assert.equal(button.classList.contains('active'), true);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(document.activeElement, button);
  // 開くと押している道具の行が青く、そこへ移る。
  button.click();
  const active = document.querySelector('#edit-more-menu .edit-more-row.active');
  assert.equal(active.textContent, 'ノート');
  assert.equal(document.activeElement, active);
  active.click();
  assert.equal(SigK.annotate.getTool(), null);
  assert.equal(button.classList.contains('active'), false);
  // 見えている道具を持っても「その他」は青くならない。
  SigK.annotate.setTool('pen');
  assert.equal(button.classList.contains('active'), false);
});

test('キーボード: ↓ で開き、↑↓・Home・End で移り、Enter で選び、Esc で閉じて「その他」へ戻る', async (t) => {
  const shell = await withHidden(t, 3);
  const { document, SigK } = shell;
  const button = document.getElementById('edit-more');
  key(shell, button, 'ArrowDown');
  assert.deepEqual(rowNames(document), ['ペン', 'マーカー', 'ノート']);
  const menu = document.getElementById('edit-more-menu');
  key(shell, menu, 'ArrowDown');
  assert.equal(document.activeElement.textContent, 'マーカー');
  key(shell, menu, 'End');
  assert.equal(document.activeElement.textContent, 'ノート');
  key(shell, menu, 'ArrowDown');
  assert.equal(document.activeElement.textContent, 'ペン', '端で反対の端へ');
  key(shell, menu, 'ArrowUp');
  assert.equal(document.activeElement.textContent, 'ノート');
  key(shell, menu, 'Home');
  assert.equal(document.activeElement.textContent, 'ペン');
  const enter = key(shell, menu, 'Enter');
  assert.equal(enter.defaultPrevented, true);
  assert.equal(SigK.annotate.getTool(), 'pen');
  assert.equal(SigK.editBarMore.isOpen(), false);
  key(shell, button, 'ArrowDown');
  key(shell, menu, 'Escape');
  assert.equal(SigK.editBarMore.isOpen(), false);
  assert.equal(document.activeElement, button);
  assert.equal(SigK.annotate.getTool(), 'pen', 'Esc で一覧を閉じても道具は離さない');
  key(shell, button, 'ArrowDown');
  key(shell, menu, 'Tab');
  assert.equal(SigK.editBarMore.isOpen(), false);
});

test('Esc の順の先頭で一覧を閉じ（道具は離さない）、一覧の外を押す・段の大きさが変わると閉じる', async (t) => {
  const shell = await withHidden(t);
  const { document, SigK } = shell;
  SigK.annotate.setTool('pen');
  document.getElementById('edit-more').click();
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(SigK.editBarMore.isOpen(), false);
  assert.equal(SigK.annotate.getTool(), 'pen');
  document.getElementById('edit-more').click();
  document.getElementById('view').dispatchEvent(new shell.window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(SigK.editBarMore.isOpen(), false);
  document.getElementById('edit-more').click();
  hideRight(shell, 1);
  assert.equal(SigK.editBarMore.isOpen(), false);
});

test('隠した道具が無ければ一覧は開かない', async (t) => {
  const { SigK } = await withHidden(t, 0);
  assert.equal(SigK.editBarMore.open(), false);
  assert.equal(SigK.editBarMore.close(), false);
});
