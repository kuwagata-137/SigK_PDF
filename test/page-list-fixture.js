'use strict';

// ページ一覧の右クリックメニュー・コピーと貼り付け・削除確認画面・キーの試験（spec-7-5）で共通に使う準備と操作。
// ファイル名が .test.js ではないので、node --test はこのファイルを単独では回さない。

const { createShell, makeSource, A4 } = require('./harness.js');

const A = 'C:\\work\\会議資料.pdf';
const B = 'C:\\work\\見積書.pdf';
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

// ワーカー（copy-pages）が返すページのコピーの結果（page-transfer.test.js と同じ形）。
const copied = (pages = 1) => ({ ok: true, bytes: new Uint8Array(PDF), pages, sizes: Array.from({ length: pages }, () => ({ ...A4 })) });

// mode は 'pages'・'annot'・'tools'。ツールモードは結合を選んで帯の画面を出す。どのファイルも 3 ページ。
async function openShell(t, { mode = 'pages', paths = [A], taskResults = [], ...options } = {}) {
  const files = Object.fromEntries([A, B].map((filePath) => [filePath, makeSource({ path: filePath })]));
  const shell = await createShell({ files, taskResults, ...options });
  t.after(() => shell.cleanup());
  for (const filePath of paths)
    await shell.SigK.tabs.openPath(filePath);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, mode);
  if (mode === 'tools')
    shell.SigK.tools.select('merge');
  await shell.flush();
  return shell;
}

// 非同期の操作（ワーカー・pdf.js の開き直し・削除確認画面）が落ち着くまで待つ。
async function settle(shell) {
  await shell.flush();
  await shell.flush();
}

const thumbs = (shell) => [...shell.document.querySelectorAll('#thumbs .thumb')];
const stripNodes = (shell) => [...shell.document.querySelectorAll('#strips .strip')];
const stripPages = (shell, index = 0) => [...stripNodes(shell)[index].querySelectorAll('.strip-page')];

function rightClick(shell, node, { x = 30, y = 40 } = {}) {
  const event = new shell.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
  node.dispatchEvent(event);
  return event;
}

// 本物のマウスと同じ順（pointerdown → mousedown → pointerup → click）で左クリックを送る。
function leftClick(shell, node, init = {}) {
  shell.firePointer(node, 'pointerdown');
  node.dispatchEvent(new shell.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init }));
  shell.firePointer(node, 'pointerup');
  node.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
}

const menu = (shell) => shell.document.getElementById('page-menu');
const menuShown = (shell) => menu(shell).hidden === false;
const itemOf = (shell, action) => menu(shell).querySelector(`[data-action="${action}"]`);
// メニューで押せる項目の名前の並び。
const enabledItems = (shell) => [...menu(shell).querySelectorAll('[data-action]')]
  .filter((node) => node.getAttribute('aria-disabled') !== 'true').map((node) => node.dataset.action);

function pick(shell, action) {
  itemOf(shell, action).dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

// フォーカスのある要素（無ければ body）に keydown を送る。
function key(shell, name, { ctrl = false, shift = false, target = null } = {}) {
  const node = target ?? shell.document.activeElement ?? shell.document.body;
  const event = new shell.window.KeyboardEvent('keydown', { key: name, ctrlKey: ctrl, shiftKey: shift, bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event;
}

// 並びを元のページの番号（差し込みは i と差し込みの番号）で表す。
const planOf = (shell) => structuredClone(shell.SigK.viewer.getPlan()).map((page) => page.src ?? `i${page.insert}`);

const deleteDialog = (shell) => shell.document.getElementById('confirm-page-delete');
const deleteShown = (shell) => deleteDialog(shell).hasAttribute('open');

// 削除確認画面のボタンを押す。
async function answerDelete(shell, ok = true) {
  shell.document.getElementById(ok ? 'confirm-page-delete-ok' : 'confirm-page-delete-cancel').click();
  await settle(shell);
}

module.exports = {
  A, B, copied, openShell, settle, thumbs, stripNodes, stripPages, rightClick, leftClick, menu, menuShown, itemOf, enabledItems, pick, key,
  planOf, deleteDialog, deleteShown, answerDelete,
};
