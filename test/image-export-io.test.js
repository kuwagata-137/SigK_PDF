'use strict';

// PDF→画像のメイン側の口（spec-3-3 確定事項2・19）。対象を1本選ぶダイアログの題名と、
// 描いたバイト列を書く防具。fs と dialog は偽物を渡す。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { pickToolSource, pickSplitSource, createFileIo } = require('../file-io.js');
const { IMAGE_WRITE_EXTENSIONS, isImageWritePath, writeImage, createImageIo } = require('../image-io.js');
const { tempPathFor } = require('../pdf-write.js');

const IN_A = 'C:/in/a.pdf';

// ---- 対象を1本選ぶ（確定事項2）----

test('pickToolSource は題名を受け、1本だけ返す', async () => {
  const calls = [];
  const dialogLike = {
    showOpenDialog: async (options) => {
      calls.push(options);
      return { canceled: false, filePaths: [IN_A, 'C:/in/b.pdf'] };
    },
  };
  assert.deepEqual(await pickToolSource({ dialogLike, title: '画像にする PDF を選ぶ' }), { path: IN_A });
  assert.equal(calls[0].title, '画像にする PDF を選ぶ');
  assert.deepEqual(calls[0].properties, ['openFile']);
  // 題名を省いても壊れない。
  await pickToolSource({ dialogLike });
  assert.equal(calls[1].title, '対象の PDF を選ぶ');
});

test('pickSplitSource は pickToolSource を分割の題名で呼ぶ（従来どおり）', async () => {
  const calls = [];
  const dialogLike = { showOpenDialog: async (options) => { calls.push(options); return { canceled: false, filePaths: [IN_A] }; } };
  assert.deepEqual(await pickSplitSource({ dialogLike }), { path: IN_A });
  assert.equal(calls[0].title, '分割する PDF を選ぶ');
});

test('createFileIo の pickToolSource は親ウィンドウと題名を dialog へ渡す', async () => {
  const calls = [];
  const dialog = { showOpenDialog: async (parent, options) => { calls.push({ parent, options }); return { canceled: true }; } };
  const io = createFileIo({ dialog });
  const parent = { id: 'win' };
  assert.deepEqual(await io.pickToolSource(parent, { defaultPath: IN_A, title: 'T' }), { canceled: true });
  assert.equal(calls[0].parent, parent);
  assert.equal(calls[0].options.title, 'T');
  assert.equal(calls[0].options.defaultPath, IN_A);
});

// ---- 書く（確定事項19）----

test('書けるのは .png / .jpg / .jpeg だけ', () => {
  assert.deepEqual(IMAGE_WRITE_EXTENSIONS, ['.png', '.jpg', '.jpeg']);
  assert.equal(isImageWritePath('C:/out/a_001.png'), true);
  assert.equal(isImageWritePath('C:/out/a_001.JPG'), true);
  assert.equal(isImageWritePath('C:/out/a_001.jpeg'), true);
  assert.equal(isImageWritePath('C:/out/a_001.pdf'), false);
  assert.equal(isImageWritePath('C:/out/a_001'), false);
  assert.equal(isImageWritePath(null), false);
});

test('writeImage は一時ファイル → rename で書き、バイト数を返す', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-image-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'a_001.png');

  const result = await writeImage(target, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

  assert.deepEqual(result, { ok: true, path: target, bytes: 4 });
  assert.deepEqual([...fs.readFileSync(target)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(fs.existsSync(tempPathFor(target)), false, '一時ファイルは残らない');
});

test('writeImage は ArrayBuffer も受け、既にあるファイルは置き換える', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-image-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'a_001.jpg');
  fs.writeFileSync(target, 'old');

  const result = await writeImage(target, new Uint8Array([1, 2, 3]).buffer);

  assert.equal(result.ok, true);
  assert.deepEqual([...fs.readFileSync(target)], [1, 2, 3]);
});

test('writeImage は画像以外の出力先と空のバイト列を断る', async () => {
  assert.deepEqual(await writeImage('C:/out/a.pdf', new Uint8Array([1])), { error: '画像の出力先ではありません。' });
  assert.deepEqual(await writeImage('C:/out/a.png', new Uint8Array(0)), { error: '書き出す画像がありません。' });
  assert.deepEqual(await writeImage('C:/out/a.png', 'abc'), { error: '書き出す画像がありません。' });
});

test('writeImage は書けなかった理由を人が読める文言で返す', async () => {
  const fsLike = {
    promises: {
      stat: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
      writeFile: async () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); },
      rename: async () => {},
      unlink: async () => {},
      rm: async () => {},
    },
  };
  const result = await writeImage('C:/out/a.png', new Uint8Array([1]), { fsLike });
  assert.equal(result.ok, undefined);
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0);
});

test('createImageIo の write は writeImage を呼ぶ', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-image-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const io = createImageIo({ dialog: {} });
  const result = await io.write(path.join(dir, 'p.png'), new Uint8Array([7]));
  assert.equal(result.ok, true);
  assert.equal(result.bytes, 1);
});
