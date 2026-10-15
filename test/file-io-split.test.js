'use strict';

// PDF を選ぶ窓と出力フォルダの選択（spec-2-2 確定事項14）。分割の対象を 1 本選ぶ窓は、対象が選んでいる帯になったので無くした（spec-2-5 確定事項G14）。
// file-io-merge.test.js と同じ作法で、dialog は偽物を渡す。

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDF_FILTERS, pickPdfPaths, pickMergeSources, pickFolder, createFileIo } = require('../file-io.js');

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

test('pickMergeSources は複数を返す', async () => {
  const calls = [];
  const dialogLike = {
    showOpenDialog: async (options) => {
      calls.push(options);
      return { canceled: false, filePaths: [IN_A, IN_B] };
    },
  };
  assert.deepEqual(await pickMergeSources({ dialogLike }), { paths: [IN_A, IN_B] });
  assert.deepEqual(calls[0].properties, ['openFile', 'multiSelections']);
  assert.equal(calls[0].title, '結合する PDF を選ぶ');
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
  await pickMergeSources({ dialogLike });
  await pickMergeSources({ dialogLike, parentWindow: { fake: true } });
  await pickFolder({ dialogLike });
  await pickFolder({ dialogLike, parentWindow: { fake: true } });
  assert.deepEqual(seen, [1, 2, 1, 2]);
});

test('createFileIo はフォルダー選択も出せる', async () => {
  const dialog = { showOpenDialog: async (options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? DIR : IN_A] }) };
  const io = createFileIo({ dialog });
  assert.deepEqual(await io.pickFolder(null, { defaultPath: 'C:/in' }), { path: DIR });
});

// 分割の画面が、読んだあとで書き換わっていないかを照らす口（spec-2-2b 確定事項D7）。
test('statPdf は読まずに大きさと更新日時だけを返す。PDF でないパスと無いファイルは error', async () => {
  const fs = require('node:fs');
  const { fixturePath } = require('./fixtures/build.js');
  const { statPdf } = require('../file-io.js');
  const fixture = fixturePath('three-pages.pdf');
  const real = fs.statSync(fixture);
  assert.deepEqual(await statPdf(fixture), { ok: true, size: real.size, mtimeMs: Math.round(real.mtimeMs) });
  assert.equal(typeof (await statPdf('C:/in/a.txt')).error, 'string');
  assert.equal(typeof (await statPdf(`${fixture}.nothing.pdf`)).error, 'string');
  assert.deepEqual(await createFileIo({ dialog: {} }).stat(fixture), { ok: true, size: real.size, mtimeMs: Math.round(real.mtimeMs) });
});
