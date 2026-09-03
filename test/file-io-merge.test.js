'use strict';

// 結合の入力の複数選択と、出力先の同名判定（spec-2-1 確定事項9・28）。
// file-io.test.js と同じ作法で、dialog は偽物を渡す。

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDF_FILTERS, pickMergeSources, exists, createFileIo } = require('../file-io.js');
const { fixturePath } = require('./fixtures/build.js');

const THREE_PAGES = fixturePath('three-pages.pdf');
const IN_B = 'C:/in/b.pdf';
const IN_A = 'C:/in/a.pdf';

test('pickMergeSources は複数選択で、選んだ順にパスを返す', async () => {
  const calls = [];
  const dialogLike = {
    showOpenDialog: async (options) => {
      calls.push(options);
      return { canceled: false, filePaths: [IN_B, IN_A] };
    },
  };
  const result = await pickMergeSources({ dialogLike, defaultPath: 'C:/in' });
  assert.deepEqual(result, { paths: [IN_B, IN_A] });
  assert.ok(calls[0].properties.includes('multiSelections'));
  assert.ok(calls[0].properties.includes('openFile'));
  assert.deepEqual(calls[0].filters, PDF_FILTERS);
  assert.equal(calls[0].defaultPath, 'C:/in');
});

test('pickMergeSources を取り消せる（空の選択も取り消し扱い）', async () => {
  assert.deepEqual(
    await pickMergeSources({ dialogLike: { showOpenDialog: async () => ({ canceled: true }) } }),
    { canceled: true });
  assert.deepEqual(
    await pickMergeSources({ dialogLike: { showOpenDialog: async () => ({ canceled: false, filePaths: [] }) } }),
    { canceled: true });
});

test('pickMergeSources も親の有無で呼び分ける', async () => {
  const seen = [];
  const dialogLike = { showOpenDialog: async (...args) => { seen.push(args.length); return { canceled: true }; } };
  await pickMergeSources({ dialogLike });
  await pickMergeSources({ dialogLike, parentWindow: { fake: true } });
  // 親が無いのに undefined を渡すと、options を親として解釈されてしまう。
  assert.deepEqual(seen, [1, 2]);
});

test('exists は同名の有無を返し、無いときも失敗にしない', async () => {
  assert.deepEqual(await exists(THREE_PAGES), { ok: true, exists: true });
  assert.deepEqual(await exists(`${THREE_PAGES}.nothing`), { ok: true, exists: false });
  assert.deepEqual(await exists(''), { ok: true, exists: false });
  assert.deepEqual(await exists(null), { ok: true, exists: false });
});

test('createFileIo は結合の複数選択と同名判定も出せる', async () => {
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [IN_A] }) };
  const io = createFileIo({ dialog });
  assert.deepEqual(await io.pickMergeSources(null, {}), { paths: [IN_A] });
  assert.deepEqual(await io.exists(THREE_PAGES), { ok: true, exists: true });
});
