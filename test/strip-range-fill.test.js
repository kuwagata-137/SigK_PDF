'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// 帯で選択したページの番号を、ツールの範囲欄に入力する（版 1.5.0 の②。docs/spec-7-11-view-font.md 確定事項R1〜R6）。
// 質問 RG1「案A 選択時入力」・RG2「案C 入力なし」・RG3「案A 4 ツール対象」。

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const MESSAGE = '保存していない並べ替えがあるので、選択したページの番号を範囲に入れませんでした。上書き保存してから、ページを選択し直してください。';

async function withTool(t, tool) {
  const files = Object.fromEntries([A, B].map((filePath) => [filePath, makeSource({ path: filePath, mtimeMs: 1000 })]));
  const shell = await createShell({ files, pdfjs: createPdfjsStub({ sizes: [A4, A4, A4, A4, A4, A4, A4] }) });
  t.after(() => shell.cleanup());
  for (const filePath of [A, B])
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select(tool);
  shell.SigK.strips.setShown(true);
  await shell.flush();
  return shell;
}

const strip = (shell, index) => shell.document.querySelectorAll('#strips .strip')[index];
const pages = (shell, index) => [...strip(shell, index).querySelectorAll('.strip-page')];
function clickPage(shell, stripIndex, page, init = {}) {
  pages(shell, stripIndex)[page].dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}
const banner = (shell) => shell.document.querySelector('#view-banner .banner-text')?.textContent ?? null;

test('PDF→画像: 帯でページを選択するたびに、範囲欄を「2-4, 7」の形に置き換え、［範囲］を選択する', async (t) => {
  const shell = await withTool(t, 'toImage');
  const { SigK, document } = shell;
  clickPage(shell, 0, 1);
  clickPage(shell, 0, 3, { shiftKey: true });
  clickPage(shell, 0, 6, { ctrlKey: true });
  assert.deepEqual([SigK.toolsToImage.settings().mode, SigK.toolsToImage.settings().range], ['range', '2-4, 7']);
  assert.equal(document.getElementById('toimage-range').value, '2-4, 7');

  SigK.toolsToImage.setRange('1, 5');
  clickPage(shell, 0, 4);
  assert.equal(SigK.toolsToImage.settings().range, '5', '手で入力した番号も、次に選択すると置き換える');
});

test('選択を解除した時（Esc）は、範囲欄をそのままにする', async (t) => {
  const shell = await withTool(t, 'toImage');
  const { SigK } = shell;
  clickPage(shell, 0, 2);
  assert.equal(SigK.stripSelection.escape(), true);
  assert.equal(SigK.toolsToImage.settings().range, '3');
  assert.equal(SigK.toolsToImage.settings().mode, 'range');
});

test('Ctrl+A ですべてのページを選択した時も入れる', async (t) => {
  const shell = await withTool(t, 'flatten');
  const { SigK } = shell;
  clickPage(shell, 0, 0);
  shell.document.body.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.deepEqual(SigK.toolsFlatten.choices().range, '1-7');
  assert.equal(SigK.toolsFlatten.choices().mode, 'range');
});

test('透かしとフラット化でも入れる。ほかの帯を選択すると、その帯が対象になって番号を入れる', async (t) => {
  const shell = await withTool(t, 'watermark');
  const { SigK } = shell;
  clickPage(shell, 1, 0);
  clickPage(shell, 1, 1, { shiftKey: true });
  assert.equal(SigK.tabs.activeId(), SigK.tabs.list()[1].id);
  assert.deepEqual([SigK.toolsWatermark.settings().pageMode, SigK.toolsWatermark.settings().range], ['range', '1-2']);

  SigK.tools.select('flatten');
  await shell.flush();
  clickPage(shell, 0, 5);
  assert.equal(SigK.tabs.activeId(), SigK.tabs.list()[0].id);
  assert.deepEqual([SigK.toolsFlatten.choices().mode, SigK.toolsFlatten.choices().range], ['range', '6'], '対象が替わった時の初期化の後に入れる');
});

test('結合: ページを選択した帯の行の範囲欄に入れる（ほかの行は変えない）', async (t) => {
  const shell = await withTool(t, 'merge');
  const { SigK, document } = shell;
  const [a, b] = SigK.tabs.list().map((tab) => tab.id);
  SigK.toolsMerge.setRange(a, '1');
  clickPage(shell, 1, 2);
  clickPage(shell, 1, 4, { ctrlKey: true });
  const rangeOf = (tabId) => SigK.toolsMerge.rows().find((row) => row.tabId === tabId).range;
  assert.equal(rangeOf(b), '3, 5');
  assert.equal(rangeOf(a), '1');
  assert.equal(document.querySelector(`#merge-list .merge-pick[data-tab-id="${b}"] .rng`).value, '3, 5');
});

test('保存していない並べ替え・削除がある帯では入れず、通知バーに理由を表示する（質問 RG2「案C」）', async (t) => {
  const shell = await withTool(t, 'toImage');
  const { SigK } = shell;
  SigK.tabs.activate(SigK.tabs.list()[0].id);
  SigK.pageEdit.remove([0]);
  await shell.flush();
  assert.equal(SigK.tabs.peek(SigK.tabs.activeId()).plan.length, 6);
  clickPage(shell, 0, 1);
  assert.equal(SigK.toolsToImage.settings().range, '');
  assert.equal(SigK.toolsToImage.settings().mode, 'all');
  assert.equal(banner(shell), MESSAGE);
});

test('回転だけの帯では、帯の下の番号とファイルのページ番号が同じなので入れる', async (t) => {
  const shell = await withTool(t, 'toImage');
  const { SigK } = shell;
  SigK.tabs.activate(SigK.tabs.list()[0].id);
  SigK.pageEdit.rotate(90, [1]);
  await shell.flush();
  assert.equal(SigK.tabs.isDirty(SigK.tabs.activeId()), true);
  clickPage(shell, 0, 1);
  assert.equal(SigK.toolsToImage.settings().range, '2');
  assert.notEqual(banner(shell), MESSAGE);
});

test('範囲欄が無いツール（分割・画像→PDF）では何もしない', async (t) => {
  const shell = await withTool(t, 'split');
  const { SigK } = shell;
  clickPage(shell, 0, 1);
  assert.equal(SigK.toolsToImage.settings().range, '');
  assert.equal(SigK.stripRangeFill.fill(SigK.tabs.activeId()), false);
});
