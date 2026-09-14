'use strict';

// GIF を画素列へ展開する層のテスト（spec-3-2 確定事項11）。vendor/omggif.js に依る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { decodeGif } = require('../worker/decode-gif.js');
const { decodeImage, frameCount } = require('../worker/image-decode.js');
const { makeGif, paletteRgb } = require('./fixtures/gif.js');
const { toRgb, maxDifference, pixelAt } = require('./fixtures/pixels.js');
const { GIF89A } = require('./fixtures/images.js');

const W = 10;
const H = 9;
const PALETTE = [0xff0000, 0x00ff00, 0x0000ff, 0xffffff];
const indices = new Uint8Array(W * H);
for (let y = 0; y < H; y += 1)
  for (let x = 0; x < W; x += 1)
    indices[y * W + x] = (x + y) & 3;

function expectedRgb(transparentIndex = null) {
  const out = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i += 1)
    out.set(indices[i] === transparentIndex ? [255, 255, 255] : paletteRgb(PALETTE, indices[i]), i * 3);
  return out;
}

function decodedRgb(bytes) {
  const decoded = decodeGif(bytes);
  assert.equal(decoded.ok, true, decoded.error);
  assert.equal(decoded.colorSpace, 'rgb');
  assert.equal(decoded.bitsPerComponent, 8);
  return toRgb(decoded);
}

test('素の GIF と GIF87a を RGB に展開する', () => {
  assert.equal(maxDifference(decodedRgb(makeGif({ width: W, height: H, palette: PALETTE, indices })), expectedRgb()), 0);
  assert.equal(maxDifference(decodedRgb(makeGif({ width: W, height: H, palette: PALETTE, indices, gif87a: true })), expectedRgb()), 0);
});

test('透過の画素は白になる（白い紙に載せたのと同じ見え方。確定事項17）', () => {
  const rgb = decodedRgb(makeGif({ width: W, height: H, palette: PALETTE, indices, transparent: 2 }));
  assert.equal(maxDifference(rgb, expectedRgb(2)), 0);
  assert.deepEqual(pixelAt(rgb, W, 2, 0), [255, 255, 255]);
});

test('インターレースの GIF も正しい並びで読む', () => {
  const rgb = decodedRgb(makeGif({ width: W, height: H, palette: PALETTE, indices, interlaced: true }));
  assert.equal(maxDifference(rgb, expectedRgb()), 0);
});

test('アニメ GIF は先頭フレームだけを使う', () => {
  const bytes = makeGif({
    width: W, height: H, palette: PALETTE,
    frames: [
      { indices },
      { x: 2, y: 2, width: 3, height: 3, indices: new Uint8Array(9).fill(1), palette: [0x101010, 0x202020] },
    ],
  });
  const rgb = decodedRgb(bytes);
  assert.equal(maxDifference(rgb, expectedRgb()), 0, '2枚目の部分矩形が混ざっていない');
  assert.equal(frameCount('gif', bytes), 1);
});

test('壊れた GIF は文言で断り、投げない', () => {
  const bytes = makeGif({ width: W, height: H, palette: PALETTE, indices });
  for (const cut of [10, 20, 30, bytes.length - 3])
    assert.match(decodeGif(bytes.subarray(0, cut)).error, /壊れている/, `cut ${cut}`);
  // ヘッダーと画面の記述だけでフレームが無い
  assert.match(decodeGif(Buffer.concat([GIF89A.subarray(0, 6), Buffer.from([4, 0, 3, 0, 0, 0, 0, 0x3b])])).error, /壊れている/);
});

test('ディスクの検体 image-palette.gif は透過の市松が白地になる', () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'image-palette.gif'));
  const decoded = decodeImage('gif', bytes);
  assert.equal(decoded.ok, true);
  const rgb = toRgb(decoded.pixels);
  assert.deepEqual(pixelAt(rgb, 320, 5, 5), [255, 255, 255], '透過（index 0）');
  assert.deepEqual(pixelAt(rgb, 320, 40, 5), [51, 204, 128]);
});
