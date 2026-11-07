'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readImageDocument, createImageOpener } = require('../image-open.js');
const { createFileIo } = require('../file-io.js');

// 画像を開く口（spec-7-1 確定事項A4）。ワーカーを回す関数は差し替える。

function tempFile(t, name, bytes = Buffer.from([1, 2, 3])) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-image-opener-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, name);
  fs.writeFileSync(target, bytes);
  return target;
}

const BUILT = { ok: true, bytes: new Uint8Array([0x25, 0x50]), kind: 'png', frames: [{ width: 4, height: 3 }], signature: { size: 3, mtimeMs: 1234 } };

test('ワーカーが組み立てた PDF を、PDF を読んだときと同じ形に画像の欄を添えて返す', async (t) => {
  const target = tempFile(t, 'shot.png');
  const specs = [];
  const result = await readImageDocument(target, { run: async (spec) => { specs.push(spec); return BUILT; } });
  assert.deepEqual(specs, [{ kind: 'image-open', path: target }]);
  assert.deepEqual(result, {
    ok: true, path: target, name: 'shot.png', size: 3, mtimeMs: 1234, bytes: BUILT.bytes,
    image: { kind: 'png', frames: [{ width: 4, height: 3 }] },
  });
});

test('JPEG の元のバイト列は image.original に入れる', async (t) => {
  const target = tempFile(t, 'photo.jpg');
  const original = new Uint8Array([0xff, 0xd8]);
  const result = await readImageDocument(target, { run: async () => ({ ...BUILT, kind: 'jpeg', original }) });
  assert.equal(result.image.original, original);
});

test('画像の拡張子でない・無いファイル・大きすぎる・ワーカーが断った、はそれぞれ理由を返す', async (t) => {
  const run = async () => BUILT;
  assert.equal((await readImageDocument('C:\\x\\a.pdf', { run })).error, '画像ファイルではありません。');
  const missing = await readImageDocument(path.join(os.tmpdir(), 'sigk-無い.png'), { run });
  assert.deepEqual(missing, { error: 'ファイルが見つかりません。', code: 'ENOENT' });
  const big = tempFile(t, 'big.png', Buffer.alloc(10));
  assert.match((await readImageDocument(big, { run, maxBytes: 5 })).error, /画像が大きすぎます/);
  const target = tempFile(t, 'broken.gif');
  assert.equal((await readImageDocument(target, { run: async () => ({ error: '壊れています。' }) })).error, '壊れています。');
});

test('createFileIo の read と open は、画像を画像の口へ回す', async (t) => {
  const png = tempFile(t, 'a.PNG');
  const opener = createImageOpener({ run: async () => BUILT });
  const io = createFileIo({
    dialog: { showOpenDialog: async (options) => ({ canceled: false, filePaths: [png], options }) },
    readImage: (filePath) => opener.read(filePath),
  });
  assert.equal((await io.read(png)).image.kind, 'png');
  assert.equal((await io.open()).image.kind, 'png');
});
