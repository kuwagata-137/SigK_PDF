'use strict';

// 書き出すときの最初のフォルダ（spec-6-1 タスク E の確定事項E-5。決定81 ⑥⑨）。設定の窓で「決めたフォルダ」を選んでいれば、
// 保存の窓の最初の場所（名前を付けて保存・ページの抽出・結合・透かし・フラット化）と、右の欄の「フォルダ」の最初の値
// （分割・画像→PDF・PDF→画像）にそのフォルダを使う。無ければ今の決め方（元のファイルと同じフォルダ）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const OUT = 'D:\\out';
const FIXED = { preferences: { outputFolder: { mode: 'fixed', fixed: OUT } }, existingFolders: [OUT] };

async function withShell(t, options = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) }, ...options });
  t.after(() => shell.cleanup());
  await shell.flush();
  return shell;
}

async function openTabs(shell, ...paths) {
  for (const filePath of paths)
    await shell.SigK.tabs.openPath(filePath);
  await shell.flush();
}

const tools = (shell, tool) => {
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select(tool);
};

test('名前を付けて保存の窓は、決めたフォルダで開く（ファイルの名前は元のまま）', async (t) => {
  const shell = await withShell(t, FIXED);
  await openTabs(shell, A);
  await shell.SigK.save.saveAsActive();
  assert.equal(shell.savePathCalls[0].defaultPath, `${OUT}\\a.pdf`);
});

test('決めたフォルダが無くなっていたら、今の決め方（元のファイルと同じフォルダ）で開く', async (t) => {
  const shell = await withShell(t, { preferences: FIXED.preferences });
  await openTabs(shell, A);
  await shell.SigK.save.saveAsActive();
  assert.equal(shell.savePathCalls[0].defaultPath, A);
});

test('ページの抽出の保存の窓も、決めたフォルダで開く', async (t) => {
  const shell = await withShell(t, FIXED);
  await openTabs(shell, A);
  shell.SigK.pageGrid.setSelection([0]);
  const running = shell.SigK.extract.run();
  await shell.flush();
  shell.document.getElementById('confirm-extract-ok').click();
  await running;
  assert.equal(shell.savePathCalls[0].defaultPath, `${OUT}\\a_抽出.pdf`);
});

test('結合・透かし・フラット化の保存の窓も、決めたフォルダで開く', async (t) => {
  const merge = await withShell(t, FIXED);
  await openTabs(merge, A, B);
  tools(merge, 'merge');
  await merge.SigK.toolsMerge.run();
  assert.equal(merge.savePathCalls[0].defaultPath, `${OUT}\\a_結合.pdf`);

  const watermark = await withShell(t, FIXED);
  await openTabs(watermark, A);
  tools(watermark, 'watermark');
  await watermark.SigK.toolsWatermark.run();
  assert.equal(watermark.savePathCalls[0].defaultPath, `${OUT}\\a_透かし.pdf`);
});

test('分割・PDF→画像の右の欄の「フォルダ」の最初の値は決めたフォルダ。［変更…］で変えた値は上書きしない', async (t) => {
  const split = await withShell(t, FIXED);
  tools(split, 'split');
  await openTabs(split, A);
  assert.equal(split.SigK.toolsSplit.settings().folder, OUT);

  const toImage = await withShell(t, { ...FIXED, folderResults: [{ path: 'E:\\pick' }] });
  tools(toImage, 'toImage');
  await openTabs(toImage, A);
  assert.equal(toImage.SigK.toolsToImage.currentPlan().targets[0].startsWith(`${OUT}\\`), true);
  await toImage.SigK.toolsToImage.pickFolder();
  assert.equal(toImage.SigK.toolsToImage.currentPlan().targets[0].startsWith('E:\\pick\\'), true);
});

test('画像→PDF の右の欄の「フォルダ」の最初の値も決めたフォルダ（元のファイルと同じフォルダは 1 枚目の画像のフォルダ）', async (t) => {
  const IMG = 'C:\\img\\a.png';
  const shell = await withShell(t, { ...FIXED, imageInfos: { [IMG]: { kind: 'png', width: 100, height: 100 } } });
  tools(shell, 'convert');
  await shell.SigK.toolsConvert.addPaths([IMG]);
  await shell.flush();
  assert.equal(shell.SigK.toolsConvert.settings().folder, OUT);
});
