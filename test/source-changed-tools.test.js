'use strict';

// ツールモードの実行で、帯のファイルがタブで開いたあとでほかのアプリに書き換えられていたら止める（決定81 ⑫。spec-6-1 確定事項C-9）。
// 分割と同じ動き（図 screenshots/phase6-question-12-tool-source-changed.png の案 A）。照らすのは実行の前の確かめ（run-guard.js の
// confirmUnsaved）で、保存していない帯の確認のあと・保存ダイアログより前。ワーカーも読む前に照らし（保存ダイアログの間の書き換え）、
// { sourceChanged: true } を返す。止めたときの文は画面が組む。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const OUT = 'C:\\out\\a_out.pdf';
const changedText = (name, verb) => `「${name}」がほかのアプリで書き換えられていたので、${verb}を止めました。タブを閉じて開き直してから、もう一度実行してください。`;

async function createToolShell(t, tool, options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A, mtimeMs: 1000 }), [B]: makeSource({ path: B, mtimeMs: 1000 }), [OUT]: makeSource({ path: OUT }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select(tool);
  return shell;
}

async function openTabs(shell, ...paths) {
  for (const filePath of paths)
    await shell.SigK.tabs.openPath(filePath);
  await shell.flush();
}

// ほかのアプリが書き換えた（大きさと更新時刻が変わった）ことにする。
function rewriteOutside(shell, filePath) {
  shell.files[filePath] = makeSource({ path: filePath, size: 9999, mtimeMs: 9999 });
}

const plain = (value) => structuredClone(value);
const bannerText = (shell) => shell.SigK.viewBanner.text();

test('実行の前の確かめは、動作の名前を渡されたら帯のファイルの書き換えも照らし、書き換えられていたら止める', async (t) => {
  const shell = await createToolShell(t, 'merge');
  await openTabs(shell, A, B);
  const ids = shell.SigK.tabs.list().map((tab) => tab.id);
  assert.deepEqual(plain(await shell.SigK.runGuard.confirmUnsaved(ids, { verb: '結合' })), { go: true, saved: false });
  rewriteOutside(shell, B);
  assert.deepEqual(plain(await shell.SigK.runGuard.confirmUnsaved(ids)), { go: true, saved: false }, '名前を渡さなければ照らさない');
  assert.deepEqual(plain(await shell.SigK.runGuard.confirmUnsaved(ids, { verb: '結合' })), { go: false, saved: false, error: changedText('b.pdf', '結合') });
  assert.equal(bannerText(shell), changedText('b.pdf', '結合'));
});

test('印を読めない（ファイルが無くなった）ときも、書き換えられたとみなして止める（分割と同じ）', async (t) => {
  const shell = await createToolShell(t, 'merge');
  await openTabs(shell, A);
  delete shell.files[A];
  const guard = await shell.SigK.runGuard.confirmUnsaved([shell.SigK.tabs.activeId()], { verb: '結合' });
  assert.equal(guard.error, changedText('a.pdf', '結合'));
});

test('結合: 書き換えられた帯があれば、保存先を聞かずに止める。ワーカーが知らせたら、その帯の名前で止める', async (t) => {
  const shell = await createToolShell(t, 'merge', { savePathResults: [{ path: OUT }], taskResults: [{ sourceChanged: true, name: 'b.pdf' }] });
  await openTabs(shell, A, B);
  rewriteOutside(shell, B);
  assert.deepEqual(plain(await shell.SigK.toolsMerge.run()), { error: changedText('b.pdf', '結合') });
  assert.equal(shell.savePathCalls.length, 0);
  assert.equal(shell.taskCalls.length, 0);
  shell.files[B] = makeSource({ path: B, mtimeMs: 1000 });
  assert.deepEqual(plain(await shell.SigK.toolsMerge.run()), { sourceChanged: true, name: 'b.pdf', error: changedText('b.pdf', '結合') });
  assert.deepEqual(plain(shell.taskCalls[0].spec.inputs.map((input) => input.expect)), [{ size: 2048, mtimeMs: 1000 }, { size: 2048, mtimeMs: 1000 }]);
  assert.equal(bannerText(shell), changedText('b.pdf', '結合'));
});

test('透かし: 書き換えられていたら止める。ワーカーへは開いたときの印を渡し、ワーカーが知らせたら同じ文で止める', async (t) => {
  const shell = await createToolShell(t, 'watermark', { savePathResults: [{ path: OUT }], taskResults: [{ sourceChanged: true }] });
  await openTabs(shell, A);
  rewriteOutside(shell, A);
  assert.deepEqual(plain(await shell.SigK.toolsWatermark.run()), { error: changedText('a.pdf', '透かしの追加') });
  assert.equal(shell.taskCalls.length, 0);
  shell.files[A] = makeSource({ path: A, mtimeMs: 1000 });
  const result = await shell.SigK.toolsWatermark.run();
  assert.equal(result.error, changedText('a.pdf', '透かしの追加'));
  assert.deepEqual(plain(shell.taskCalls[0].spec.expectSource), { size: 2048, mtimeMs: 1000 });
  assert.equal(bannerText(shell), changedText('a.pdf', '透かしの追加'));
});

test('フラット化: 書き換えられていたら止める。ワーカーへは開いたときの印を渡す', async (t) => {
  const census = { ok: true, baked: 1, kept: 0, notes: 0, bake: { markup: 1, text: 0, shape: 0, note: 0, other: 0 }, keep: { functional: 0, noAppearance: 0, hidden: 0 },
    pages: [{ bake: { markup: 1, text: 0, shape: 0, note: 0, other: 0 }, keep: { functional: 0, noAppearance: 0, hidden: 0 } }] };
  const shell = await createToolShell(t, 'flatten', { savePathResults: [{ path: OUT }], taskResults: [census, { sourceChanged: true }] });
  await openTabs(shell, A);
  await shell.SigK.toolsFlatten.census().waiting;
  await shell.flush();
  rewriteOutside(shell, A);
  assert.deepEqual(plain(await shell.SigK.toolsFlatten.run()), { error: changedText('a.pdf', 'フラット化') });
  shell.files[A] = makeSource({ path: A, mtimeMs: 1000 });
  const running = shell.SigK.toolsFlatten.run();
  await shell.flush();
  shell.document.getElementById('confirm-flatten-ok').click();
  const result = await running;
  assert.equal(result.error, changedText('a.pdf', 'フラット化'));
  assert.deepEqual(plain(shell.taskCalls.at(-1).spec.expectSource), { size: 2048, mtimeMs: 1000 });
});

test('PDF→画像: 書き換えられていたら止める。描く前に読み直した中身の印が違っても止める', async (t) => {
  const shell = await createToolShell(t, 'toImage');
  await openTabs(shell, A);
  rewriteOutside(shell, A);
  assert.deepEqual(plain(await shell.SigK.toolsToImage.run()), { error: changedText('a.pdf', '画像にするの') });
  assert.equal(shell.imageWrites.length, 0);
  // 確かめのあと・読み直す前に書き換えられた（照らしは通り、読み直した中身の印が違う）。
  shell.files[A] = makeSource({ path: A, mtimeMs: 1000 });
  const read = shell.window.pdfAPI.read;
  shell.window.pdfAPI.read = async (filePath) => ({ ...(await read(filePath)), mtimeMs: 5555 });
  const result = await shell.SigK.toolsToImage.run();
  assert.equal(result.error, changedText('a.pdf', '画像にするの'));
  assert.equal(shell.imageWrites.length, 0);
});

test('分割: 書き換えられていたら止める（文をほかのツールとそろえた）。ワーカーが知らせたら同じ文で止める', async (t) => {
  const shell = await createToolShell(t, 'split', { taskResults: [{ sourceChanged: true }] });
  await openTabs(shell, A);
  shell.SigK.toolsSplitEdit.bulk('each');
  rewriteOutside(shell, A);
  assert.deepEqual(plain(await shell.SigK.toolsSplit.run()), { error: changedText('a.pdf', '分割') });
  assert.equal(shell.taskCalls.length, 0);
  shell.files[A] = makeSource({ path: A, mtimeMs: 1000 });
  const result = await shell.SigK.toolsSplit.run();
  assert.equal(result.error, changedText('a.pdf', '分割'));
  assert.equal(bannerText(shell), changedText('a.pdf', '分割'));
});
