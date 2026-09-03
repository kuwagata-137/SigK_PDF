'use strict';

// 分割の入力の1本選択・出力フォルダの選択（spec-2-2 確定事項2・14）。
// file-io-merge.test.js と同じ作法で、dialog は偽物を渡す。

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDF_FILTERS, pickPdfPaths, pickSplitSource, pickMergeSources, pickFolder, createFileIo } = require('../file-io.js');

const IN_A = 'C:/in/a.pdf';
const IN_B = 'C:/in/b.pdf';
const DIR = 'C:/out';

test('pickPdfPaths は title と複数選択の有無を受け、選んだ順にパスを返す', async () => {
  const calls = [];
  const dialogLike = {
    showOpenDialog: async (options) => {
      calls.push(options);
      return { canceled: false, filePaths: [IN_B, IN_A] };
    },
  };
  assert.deepEqual(await pickPdfPaths({ dialogLike, title: 'x', multiple: true, defaultPath: 'C:/in' }), { paths: [IN_B, IN_A] });
  assert.equal(calls[0].title, 'x');
  assert.deepEqual(calls[0].properties, ['openFile', 'multiSelections']);
  assert.deepEqual(calls[0].filters, PDF_FILTERS);
  assert.equal(calls[0].defaultPath, 'C:/in');

  assert.deepEqual(await pickPdfPaths({ dialogLike, title: 'y', multiple: false }), { paths: [IN_B, IN_A] });
  assert.deepEqual(calls[1].properties, ['openFile']);
});

test('pickSplitSource は1本だけ返し、pickMergeSources は今までどおり複数を返す', async () => {
  const calls = [];
  const dialogLike = {
    showOpenDialog: async (options) => {
      calls.push(options);
      return { canceled: false, filePaths: [IN_A, IN_B] };
    },
  };
  assert.deepEqual(await pickSplitSource({ dialogLike }), { path: IN_A });
  assert.deepEqual(calls[0].properties, ['openFile']);
  assert.equal(calls[0].title, '分割する PDF を選ぶ');
  assert.deepEqual(await pickMergeSources({ dialogLike }), { paths: [IN_A, IN_B] });
  assert.deepEqual(calls[1].properties, ['openFile', 'multiSelections']);
  assert.equal(calls[1].title, '結合する PDF を選ぶ');
});

test('pickSplitSource を取り消せる', async () => {
  assert.deepEqual(await pickSplitSource({ dialogLike: { showOpenDialog: async () => ({ canceled: true }) } }), { canceled: true });
  assert.deepEqual(await pickSplitSource({ dialogLike: { showOpenDialog: async () => ({ canceled: false, filePaths: [] }) } }), { canceled: true });
});

test('pickFolder はフォルダーだけを選ばせ、{ path } か { canceled } を返す', async () => {
  const calls = [];
  const dialogLike = {
    showOpenDialog: async (options) => {
      calls.push(options);
      return { canceled: false, filePaths: [DIR] };
    },
  };
  assert.deepEqual(await pickFolder({ dialogLike, defaultPath: 'C:/in' }), { path: DIR });
  assert.deepEqual(calls[0].properties, ['openDirectory', 'createDirectory']);
  assert.equal(calls[0].defaultPath, 'C:/in');
  assert.equal(calls[0].filters, undefined);
  assert.deepEqual(await pickFolder({ dialogLike: { showOpenDialog: async () => ({ canceled: true }) } }), { canceled: true });
});

test('どれも親の有無で呼び分ける', async () => {
  const seen = [];
  const dialogLike = { showOpenDialog: async (...args) => { seen.push(args.length); return { canceled: true }; } };
  await pickSplitSource({ dialogLike });
  await pickSplitSource({ dialogLike, parentWindow: { fake: true } });
  await pickFolder({ dialogLike });
  await pickFolder({ dialogLike, parentWindow: { fake: true } });
  assert.deepEqual(seen, [1, 2, 1, 2]);
});

test('createFileIo は分割の1本選択とフォルダー選択も出せる', async () => {
  const dialog = { showOpenDialog: async (options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? DIR : IN_A] }) };
  const io = createFileIo({ dialog });
  assert.deepEqual(await io.pickSplitSource(null, {}), { path: IN_A });
  assert.deepEqual(await io.pickFolder(null, { defaultPath: 'C:/in' }), { path: DIR });
});
