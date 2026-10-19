'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, A4 } = require('./harness.js');

// ツールモードの Ctrl+Z・Ctrl+Y（spec-2-5 確定事項I6。PR-4 の起草者の判断 I-j）。tool-history.js。
// ツールモードでしたこと（帯の並べ替え・写し・✂ の盤の操作）を、した順に 1 本の記録に控え、新しい方から、その帯の履歴を戻す。
// 戻しても枠は動かさない。記録はツールモードを離れたら捨てる。戻せない記録（閉じた帯・保存して開き直した帯）は飛ばす。記録が空なら今どおり
// （分割なら盤、ほかは枠の帯のページ編集）。

const A = 'C:\\work\\会議資料.pdf';
const B = 'C:\\work\\見積書.pdf';
const C = 'C:\\work\\議事録.pdf';
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const copied = (pages = 1) => ({ ok: true, bytes: new Uint8Array(PDF), pages, sizes: Array.from({ length: pages }, () => ({ ...A4 })) });

async function withStrips(t, { taskResults = [] } = {}) {
  const files = Object.fromEntries([A, B, C].map((filePath) => [filePath, makeSource({ path: filePath })]));
  const shell = await createShell({ files, taskResults });
  t.after(() => shell.cleanup());
  await shell.flush();
  for (const filePath of [B, C, A])
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('merge');
  await shell.flush();
  return shell;
}

const idOf = (shell, filePath) => shell.SigK.tabs.list().find((tab) => tab.path === filePath).id;
const srcs = (shell, filePath) => structuredClone(shell.SigK.tabs.peek(idOf(shell, filePath)).plan).map((page) => page.src ?? `i${page.insert}`);
const cuts = (shell) => structuredClone(shell.SigK.toolsSplitEdit.board().cuts);

function key(shell, name, { shift = false } = {}) {
  const event = new shell.window.KeyboardEvent('keydown', { key: name, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true });
  shell.document.body.dispatchEvent(event);
  return event;
}

// 帯 1（会議資料。枠の帯）の 1 ページ目を末尾へ、2 ページ目を見積書へ写し、分割で 2 ページ目の前に ✂ を入れる。
async function threeChanges(shell) {
  assert.equal(shell.SigK.pageTransfer.move([0], 3), true);
  assert.equal((await shell.SigK.pageTransfer.copyTo(idOf(shell, B), [0], 0)).ok, true);
  shell.SigK.tools.select('split');
  await shell.flush();
  assert.equal(shell.SigK.toolsSplitEdit.cut(1), true);
  await shell.flush();
}

test('並べ替え → 写し → ✂ の順にしたら、Ctrl+Z は ✂ → 写し → 並べ替えの順に戻し、Ctrl+Y は逆に進める。枠は動かない', async (t) => {
  const shell = await withStrips(t, { taskResults: [copied(1)] });
  const a = idOf(shell, A);
  await threeChanges(shell);
  assert.deepEqual(srcs(shell, A), [1, 2, 0]);
  assert.deepEqual(srcs(shell, B), ['i0', 0, 1, 2]);
  assert.deepEqual(cuts(shell), [1]);

  assert.equal(key(shell, 'z').defaultPrevented, true);
  assert.deepEqual(cuts(shell), []);
  key(shell, 'z');
  assert.deepEqual(srcs(shell, B), [0, 1, 2]);
  assert.deepEqual(srcs(shell, A), [1, 2, 0]);
  key(shell, 'z');
  assert.deepEqual(srcs(shell, A), [0, 1, 2]);
  assert.equal(shell.SigK.tabs.activeId(), a, '戻しても枠は動かない');
  assert.equal(shell.SigK.splitStrip.hostId(), a);

  key(shell, 'y');
  assert.deepEqual(srcs(shell, A), [1, 2, 0]);
  key(shell, 'z', { shift: true });
  assert.deepEqual(srcs(shell, B), ['i0', 0, 1, 2]);
  key(shell, 'y');
  assert.deepEqual(cuts(shell), [1]);
});

test('閉じた帯の記録は飛ばして、その前の記録を戻す', async (t) => {
  const shell = await withStrips(t, { taskResults: [copied(1)] });
  shell.SigK.pageTransfer.move([0], 3);
  await shell.SigK.pageTransfer.copyTo(idOf(shell, B), [0], 0);
  shell.SigK.tabs.forceCloseTab(idOf(shell, B));
  shell.SigK.tabs.activate(idOf(shell, C));
  key(shell, 'z');
  assert.deepEqual(srcs(shell, A), [0, 1, 2], '枠が議事録にあっても、記録のとおり会議資料を戻す');
});

test('保存して開き直した帯の記録は飛ばす（ほかの帯を戻さない）', async (t) => {
  const shell = await withStrips(t, { taskResults: [copied(1), { ok: true, path: B, signature: { size: 9, mtimeMs: 9 } }] });
  shell.SigK.pageTransfer.move([0], 3);
  await shell.SigK.pageTransfer.copyTo(idOf(shell, B), [0], 0);
  shell.SigK.tabs.activate(idOf(shell, B));
  await shell.SigK.save.saveActive();
  await shell.flush();
  shell.SigK.tabs.activate(idOf(shell, C));
  key(shell, 'z');
  assert.deepEqual(srcs(shell, A), [0, 1, 2], '見積書の記録は戻せないので飛ばし、会議資料の並べ替えを戻す');
  assert.deepEqual(srcs(shell, B), [0, 1, 2]);
});

test('ツールモードを離れると記録を捨て、戻ると今どおり枠の帯のページ編集を戻す', async (t) => {
  const shell = await withStrips(t, { taskResults: [copied(1)] });
  shell.SigK.pageTransfer.move([0], 3);
  await shell.SigK.pageTransfer.copyTo(idOf(shell, B), [0], 0);
  shell.SigK.shell.setMode(shell.document, 'view');
  shell.SigK.shell.setMode(shell.document, 'tools');
  key(shell, 'z');
  assert.deepEqual(srcs(shell, A), [0, 1, 2], '枠の帯（会議資料）のページ編集を戻す');
  assert.deepEqual(srcs(shell, B), ['i0', 0, 1, 2], '見積書は戻さない');
});

test('分割の画面のツールバーの［元に戻す］［やり直し］は、キーと同じに盤を戻す', async (t) => {
  const shell = await withStrips(t);
  shell.SigK.tools.select('split');
  await shell.flush();
  shell.SigK.toolsSplitEdit.cut(1);
  await shell.flush();
  const undo = shell.document.getElementById('btn-undo');
  assert.notEqual(undo.getAttribute('aria-disabled'), 'true');
  undo.click();
  assert.deepEqual(cuts(shell), []);
  shell.document.getElementById('btn-redo').click();
  assert.deepEqual(cuts(shell), [1]);
});

test('✂ の盤の箱の末尾に落としたときの並べ替えと ✂ の動きは、Ctrl+Z 1 回で戻る', async (t) => {
  const shell = await withStrips(t);
  shell.SigK.tools.select('split');
  await shell.flush();
  shell.SigK.toolsSplitEdit.cut(1);
  await shell.flush();
  assert.equal(shell.SigK.pageTransfer.move([2], 1, { board: true, boxEnd: true }), true);
  await shell.flush();
  assert.deepEqual(srcs(shell, A), [0, 2, 1]);
  assert.deepEqual(cuts(shell), [2]);
  key(shell, 'z');
  await shell.flush();
  assert.deepEqual(srcs(shell, A), [0, 1, 2]);
  assert.deepEqual(cuts(shell), [1]);
});
