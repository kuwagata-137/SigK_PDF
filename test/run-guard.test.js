'use strict';

// 保存していない帯をツールで使う前の確認（spec-2-5 確定事項F1〜F4。決定80 ⑥㉜。見本 screenshots/strips2-confirm-run.png）。
// ツールはファイルに保存してある中身を使うので、保存していない変更は結果に入らない。結合で確かめる（ほかのツールも同じ口を通る）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const C = 'C:\\work\\c.pdf';
const OUT = 'C:\\work\\a_結合.pdf';
const saved = (filePath) => ({ ok: true, path: filePath, signature: { size: 2048, mtimeMs: 2000 } });
const merged = { ok: true, path: OUT, pages: 6 };

async function createRunShell(t, options = {}) {
  const files = Object.fromEntries([A, B, C, OUT].map((filePath) => [filePath, makeSource({ path: filePath, mtimeMs: 1000 })]));
  const shell = await createShell({ files, ...options });
  t.after(() => shell.cleanup());
  await shell.flush();
  for (const filePath of [A, B, C])
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('merge');
  return shell;
}

const plain = (value) => structuredClone(value);
const dialog = (shell) => shell.document.getElementById('confirm-unsaved-run');
const press = (shell, id) => shell.document.getElementById(id).click();
const kinds = (shell) => shell.taskCalls.map((call) => call.spec.kind);
const idOf = (shell, index) => shell.SigK.tabs.list()[index].id;

// index のタブで 1 ページ目を消し、2 ページ目を回す（保存していない変更）。
function edit(shell, index) {
  shell.SigK.tabs.activate(idOf(shell, index));
  shell.SigK.pageEdit.rotate(90, [1]);
  shell.SigK.pageEdit.remove([0]);
}

test('保存していない帯が無ければ、窓を出さずに保存先を聞く', async (t) => {
  const shell = await createRunShell(t, { savePathResults: [{ canceled: true }] });
  assert.deepEqual(plain(await shell.SigK.toolsMerge.run()), { canceled: true });
  assert.equal(shell.SigK.confirmUnsavedRun.isOpen(), false);
  assert.equal(shell.savePathCalls.length, 1);
});

test('1 本なら F1 の文で聞き、最初のフォーカスは［キャンセル］。［キャンセル］なら何もせず、実行中も下ろす', async (t) => {
  const shell = await createRunShell(t);
  edit(shell, 0);
  const running = shell.SigK.toolsMerge.run();
  await shell.flush();
  assert.equal(dialog(shell).hasAttribute('open'), true);
  assert.equal(shell.document.getElementById('confirm-unsaved-run-text').textContent,
    '「a.pdf」には、保存していない変更（ページの削除 1 件・ページの回転 1 件）があります。ツールはファイルに保存してある中身を使うので、このまま実行すると、その変更は結果に入りません。');
  assert.equal(shell.document.getElementById('confirm-unsaved-run-list').hidden, true);
  assert.equal(shell.document.activeElement.id, 'confirm-unsaved-run-cancel');
  assert.equal(shell.SigK.toolsMerge.isRunning(), true, '聞いている間も実行中と数える（右クリックの束を預かる）');

  press(shell, 'confirm-unsaved-run-cancel');
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(shell.savePathCalls.length, 0);
  assert.equal(shell.SigK.toolsMerge.isRunning(), false);
});

test('［保存せずに実行］は保存せずに、保存してある中身で実行する', async (t) => {
  const shell = await createRunShell(t, { savePathResults: [{ path: OUT }], taskResults: [merged] });
  edit(shell, 1);
  const running = shell.SigK.toolsMerge.run();
  await shell.flush();
  press(shell, 'confirm-unsaved-run-run');
  assert.equal((await running).ok, true);
  assert.deepEqual(kinds(shell), ['merge']);
  assert.equal(shell.SigK.tabs.isDirty(idOf(shell, 1)), true, '変更は残る');
});

test('［上書き保存してから実行］は、帯の順に 1 本ずつ上書き保存し、元の帯へ戻してから実行する。2 本以上なら名前を並べる', async (t) => {
  const shell = await createRunShell(t, { savePathResults: [{ path: OUT }], taskResults: [saved(A), saved(C), merged] });
  const { SigK, document } = shell;
  edit(shell, 2);
  edit(shell, 0);
  SigK.tabs.activate(idOf(shell, 1));
  const running = SigK.toolsMerge.run();
  await shell.flush();
  assert.equal(document.getElementById('confirm-unsaved-run-text').textContent,
    '次の 2 個のファイルには、保存していない変更があります。ツールはファイルに保存してある中身を使うので、このまま実行すると、その変更は結果に入りません。');
  assert.deepEqual([...document.querySelectorAll('#confirm-unsaved-run-list li')].map((node) => node.textContent),
    ['「a.pdf」（ページの削除 1 件・ページの回転 1 件）', '「c.pdf」（ページの削除 1 件・ページの回転 1 件）']);

  press(shell, 'confirm-unsaved-run-save');
  assert.equal((await running).ok, true);
  assert.deepEqual(plain(shell.taskCalls.map((call) => [call.spec.kind, call.spec.target])), [['save', A], ['save', C], ['merge', OUT]]);
  assert.equal(SigK.tabs.isDirty(idOf(shell, 0)), false);
  assert.equal(SigK.tabs.isDirty(idOf(shell, 2)), false);
  assert.equal(SigK.tabs.list()[1].name, 'b.pdf');
  assert.equal(SigK.tabs.activeId(), SigK.tabs.list().at(-1).id, '実行のあとはできた PDF の帯を選ぶ（保存の間は元の帯へ戻していた）');
});

test('上書き保存に失敗したら、その帯を選んだまま実行しない', async (t) => {
  const shell = await createRunShell(t, { taskResults: [saved(A), { error: '書けませんでした。' }] });
  const { SigK } = shell;
  edit(shell, 0);
  edit(shell, 1);
  SigK.tabs.activate(idOf(shell, 2));
  const running = SigK.toolsMerge.run();
  await shell.flush();
  press(shell, 'confirm-unsaved-run-save');
  assert.deepEqual(plain(await running), { canceled: true });
  assert.deepEqual(kinds(shell), ['save', 'save']);
  assert.equal(SigK.tabs.activeId(), idOf(shell, 1), '保存できなかった帯を選んだまま');
  assert.equal(shell.savePathCalls.length, 0, '保存先も聞かない');
});

// パスワード付きの PDF はどのツールも対象にしない（行・対象の欄で止める）ので、ここは窓の守りだけを直に確かめる。
test('パスワード付きの帯があれば［上書き保存してから実行］を押せず、理由を出す', async (t) => {
  const shell = await createRunShell(t);
  edit(shell, 0);
  const peek = shell.SigK.tabs.peek;
  shell.window.SigK.tabs.peek = (id) => ({ ...peek(id), file: { ...peek(id).file, encrypted: true } });
  const running = shell.SigK.runGuard.confirmUnsaved([idOf(shell, 0), idOf(shell, 1)]);
  await shell.flush();
  const save = shell.document.getElementById('confirm-unsaved-run-save');
  assert.equal(save.getAttribute('aria-disabled'), 'true');
  assert.equal(shell.document.getElementById('confirm-unsaved-run-note').textContent, shell.SigK.runGuard.NOTE_ENCRYPTED);
  save.click();
  assert.equal(shell.SigK.confirmUnsavedRun.isOpen(), true, '押せないボタンは何もしない');
  dialog(shell).dispatchEvent(new shell.window.Event('cancel'));
  assert.deepEqual(plain(await running), { go: false, saved: false });
});
