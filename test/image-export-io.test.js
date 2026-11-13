'use strict';

// PDF→画像のメイン側の口（spec-3-3 確定事項19）。描いたバイト列を書く防具。fs は偽物を渡す。
// 対象を 1 本選ぶ窓（pickToolSource）は、対象が選んでいる帯になったので無くした（spec-2-5 確定事項E4・G14）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { IMAGE_WRITE_EXTENSIONS, isImageWritePath, writeImage, createImageIo } = require('../image-io.js');
const { tempPathFor } = require('../pdf-write.js');

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

  assert.deepEqual({ ...result, signature: undefined }, { ok: true, path: target, bytes: 4, signature: undefined, backup: null });
  assert.equal(result.signature.size, 4, '書いたあとの印（画像のタブの開き直しに使う。spec-7-1 確定事項B5）');
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
  assert.deepEqual(await writeImage('C:/out/a.pdf', new Uint8Array([1])), { error: '出力先が画像ファイルではありません。' });
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

// ---- 画像のタブの上書き保存（spec-7-1 確定事項B1） ----

test('writeImage は頼まれたら控えを残し、開いたときの印と食い違えば何も書かずに changed を返す', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-image-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'shot.png');
  fs.writeFileSync(target, 'old');
  const stat = fs.statSync(target);
  const expect = { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };

  assert.deepEqual(await writeImage(target, new Uint8Array([1, 2]), { expect: { size: 999, mtimeMs: 1 } }), { changed: true });
  assert.equal(fs.readFileSync(target, 'utf8'), 'old', '食い違えば書かない');

  const written = await writeImage(target, new Uint8Array([1, 2]), { makeBackup: true, expect });
  assert.equal(written.ok, true);
  assert.equal(written.backup, `${target}.bak`);
  assert.equal(fs.readFileSync(`${target}.bak`, 'utf8'), 'old', '元の画像は控えに残る');
  assert.deepEqual([...fs.readFileSync(target)], [1, 2]);
});

test('createImageIo の write は makeBackup と expect だけを通す', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-image-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'a.jpg');
  fs.writeFileSync(target, 'old');
  const io = createImageIo({ dialog: {} });
  const result = await io.write(target, new Uint8Array([3]), { makeBackup: true, fsLike: null });
  assert.equal(result.ok, true, '画面から fsLike を渡しても使わない');
  assert.equal(fs.existsSync(`${target}.bak`), true);
});

