'use strict';

// BMP を画素列へ展開する層のテスト（spec-3-2 確定事項10・事前調査 C）。依存なしで回る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { decodeBmp } = require('../worker/decode-bmp.js');
const { makeBmp, rgbaGradient } = require('./fixtures/bmp.js');
const { toRgb, rgbOf, maxDifference, pixelAt } = require('./fixtures/pixels.js');

const W = 7;
const H = 5;
const gradient = rgbaGradient(W, H);
const expectRgb = rgbOf(gradient);

const PALETTE_2 = [[0, 0, 0], [255, 255, 255]];
const PALETTE_16 = Array.from({ length: 16 }, (_, i) => [i * 17, 255 - i * 17, (i * 40) & 255]);
const PALETTE_256 = Array.from({ length: 256 }, (_, i) => [i, (i * 3) & 255, (i * 7) & 255]);

// パレットの色そのものを並べた絵（index = (i * 5) % 色数）
function paletteImage(palette) {
  const pixels = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i += 1) {
    const color = palette[(i * 5) % palette.length];
    pixels.set([...color, 255], i * 4);
  }
  return pixels;
}

// 連続の多い絵（RLE の連続モードと絶対モードの両方が出る）
function runsImage(palette) {
  const pixels = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) {
      const color = palette[x < 4 ? y % palette.length : (x + y) % palette.length];
      pixels.set([...color, 255], (y * W + x) * 4);
    }
  return pixels;
}

function decodedRgb(file) {
  const decoded = decodeBmp(file);
  assert.equal(decoded.ok, true, decoded.error);
  assert.equal(decoded.width, W);
  assert.equal(decoded.height, H);
  return { decoded, rgb: toRgb(decoded) };
}

test('24bit は下からでも上からでも同じ絵になる', () => {
  for (const topDown of [false, true]) {
    const { decoded, rgb } = decodedRgb(makeBmp({ width: W, height: H, bits: 24, pixels: gradient, topDown }));
    assert.equal(decoded.colorSpace, 'rgb');
    assert.equal(maxDifference(rgb, expectRgb), 0);
  }
});

test('V4・V5 ヘッダーと画素の前の余白（bfOffBits）を正しく読む', () => {
  for (const spec of [{ headerSize: 108 }, { headerSize: 124 }, { gap: 10 }, { headerSize: 124, gap: 3 }]) {
    const { rgb } = decodedRgb(makeBmp({ width: W, height: H, bits: 24, pixels: gradient, ...spec }));
    assert.equal(maxDifference(rgb, expectRgb), 0, JSON.stringify(spec));
  }
});

test('32bit BI_RGB の4バイト目は無視し、不透明として読む', () => {
  const { rgb } = decodedRgb(makeBmp({ width: W, height: H, bits: 32, pixels: gradient }));
  assert.equal(maxDifference(rgb, expectRgb), 0);
});

test('32bit BITFIELDS の alpha は白で合成する（spec-3-2 確定事項17）', () => {
  const withAlpha = new Uint8Array(gradient);
  for (let i = 0; i < W * H; i += 1)
    withAlpha[i * 4 + 3] = (i * 23) & 255;
  const expected = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i += 1) {
    const a = withAlpha[i * 4 + 3];
    for (let c = 0; c < 3; c += 1)
      expected[i * 3 + c] = (withAlpha[i * 4 + c] * a + 255 * (255 - a) + 127) / 255 | 0;
  }
  const masks = { r: 0x00ff0000, g: 0x0000ff00, b: 0x000000ff, a: 0xff000000 };
  const { rgb } = decodedRgb(makeBmp({ width: W, height: H, bits: 32, pixels: withAlpha, headerSize: 108, compression: 3, masks }));
  assert.equal(maxDifference(rgb, expected), 0);
  // alpha マスクの無い BITFIELDS（40 バイトヘッダー）は不透明
  const opaque = decodedRgb(makeBmp({ width: W, height: H, bits: 32, pixels: withAlpha, headerSize: 40, compression: 3, masks: { ...masks, a: 0 } }));
  assert.equal(maxDifference(opaque.rgb, expectRgb), 0);
});

test('16bit は 555 の既定でも 565 の BITFIELDS でも 8bit へ伸ばす', () => {
  const { rgb: rgb555 } = decodedRgb(makeBmp({ width: W, height: H, bits: 16, pixels: gradient }));
  assert.ok(maxDifference(rgb555, expectRgb) <= 8, '5bit → 8bit の丸め');
  assert.deepEqual(pixelAt(rgb555, W, 0, 0), [0, 0, 255], '0 は 0、31 は 255 になる');
  const masks = { r: 0xf800, g: 0x07e0, b: 0x001f, a: 0 };
  const { rgb: rgb565 } = decodedRgb(makeBmp({ width: W, height: H, bits: 16, pixels: gradient, compression: 3, headerSize: 40, masks }));
  assert.ok(maxDifference(rgb565, expectRgb) <= 8);
  assert.deepEqual(pixelAt(rgb565, W, W - 1, H - 1), [255, 255, 0]);
});

test('8／4／1bit のパレットは packed のまま indexed で返す', () => {
  for (const [bits, palette] of [[8, PALETTE_256], [4, PALETTE_16], [1, PALETTE_2]]) {
    const pixels = paletteImage(palette);
    const { decoded, rgb } = decodedRgb(makeBmp({ width: W, height: H, bits, pixels, palette }));
    assert.equal(decoded.colorSpace, 'indexed');
    assert.equal(decoded.bitsPerComponent, bits);
    assert.equal(decoded.bytes.length, Math.ceil(W * bits / 8) * H, '行の詰め物は外れている');
    assert.equal(decoded.palette.length, palette.length * 3);
    assert.equal(maxDifference(rgb, rgbOf(pixels)), 0, `${bits}bit`);
  }
});

test('パレットの色数（biClrUsed）が 2^bits より少なくてもよい', () => {
  const pixels = paletteImage(PALETTE_16);
  const { decoded, rgb } = decodedRgb(makeBmp({ width: W, height: H, bits: 8, pixels, palette: PALETTE_16 }));
  assert.equal(decoded.palette.length, 16 * 3);
  assert.equal(maxDifference(rgb, rgbOf(pixels)), 0);
});

test('RLE8 と RLE4 は 8bit のインデックス列に展開する', () => {
  for (const [bits, compression] of [[8, 1], [4, 2]]) {
    for (const topDown of [false, true]) {
      const pixels = runsImage(PALETTE_16);
      const { decoded, rgb } = decodedRgb(makeBmp({ width: W, height: H, bits, pixels, palette: PALETTE_16, compression, topDown }));
      assert.equal(decoded.bitsPerComponent, 8);
      assert.equal(maxDifference(rgb, rgbOf(pixels)), 0, `RLE bits=${bits} topDown=${topDown}`);
    }
  }
});

test('対応していないものと壊れたものは文言で断り、投げない', () => {
  const file = makeBmp({ width: W, height: H, bits: 24, pixels: gradient });
  assert.match(decodeBmp(file.subarray(0, 20)).error, /大きさを読み取れません/);
  assert.match(decodeBmp(file.subarray(0, file.length - 5)).error, /壊れている/);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const patched = (at, value, size = 4) => { const copy = Buffer.from(file); const v = new DataView(copy.buffer, copy.byteOffset); if (size === 2) v.setUint16(at, value, true); else v.setUint32(at, value, true); return copy; };
  assert.match(decodeBmp(patched(14, 12)).error, /古い形式/);                  // OS/2 ヘッダー
  assert.match(decodeBmp(patched(30, 4)).error, /圧縮か色深度/);               // BI_JPEG
  assert.match(decodeBmp(patched(28, 2, 2)).error, /圧縮か色深度/);            // 2bit
  assert.match(decodeBmp(patched(18, 0)).error, /大きさを読み取れません/);      // 幅 0
  assert.equal(view.getUint16(28, true), 24);
});
