'use strict';

// TIFF を画素列へ展開する層のテスト（spec-3-2 確定事項12・13）。vendor/utif.js に依る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { decodeTiff } = require('../worker/decode-tiff.js');
const { decodeImage, frameCount } = require('../worker/image-decode.js');
const { loadCommonJs } = require('../worker/vendor-loader.js');
const { makeTiff, TYPE } = require('./fixtures/tiff.js');
const { G4_TIFF, G3_TIFF, JPEG_32X24, triangleBits } = require('./fixtures/ccitt.js');
const { toRgb, maxDifference, pixelAt } = require('./fixtures/pixels.js');

const W = 13;
const H = 7;

function rgbRows(width = W, height = H) {
  const rows = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      rows.set([x * 16 & 255, y * 16 & 255, (x + y) * 8 & 255], (y * width + x) * 3);
  return rows;
}

const rgbPage = (extra = {}) => ({ width: W, height: H, bitsPerSample: [8, 8, 8], photometric: 2, compression: 1, pixels: rgbRows(), ...extra });

function decodedPixels(bytes, frame = 0) {
  const decoded = decodeTiff(bytes, { frame });
  assert.equal(decoded.ok, true, decoded.error);
  return decoded;
}

test('vendor-loader は require の一部を差し替えて CommonJS を読む', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-loader-')), 'sample.js');
  fs.writeFileSync(file, 'const dep = require("pako"); const os = require("node:os"); module.exports = { dep, hasOs: typeof os.platform === "function", dir: __dirname };');
  const loaded = loadCommonJs(file, { overrides: { pako: { inflate: 'shim' } } });
  assert.deepEqual(loaded.dep, { inflate: 'shim' });
  assert.equal(loaded.hasOs, true, '差し替えに無いものは普通の require');
  assert.equal(loaded.dir, path.dirname(file));
});

test('RGB の無圧縮を II と MM の両方で読む', () => {
  for (const littleEndian of [true, false]) {
    const pixels = decodedPixels(makeTiff([rgbPage()], { littleEndian }));
    assert.equal(pixels.colorSpace, 'rgb');
    assert.equal(pixels.bitsPerComponent, 8);
    assert.equal(maxDifference(toRgb(pixels), rgbRows()), 0);
  }
});

test('PackBits・Deflate（8・32946）・LZW（Predictor 2 込み）を伸長する', () => {
  for (const compression of [32773, 8, 32946, 5])
    assert.equal(maxDifference(toRgb(decodedPixels(makeTiff([rgbPage({ compression, rowsPerStrip: 3 })]))), rgbRows()), 0, `compression ${compression}`);
  // Predictor 2: 横の差分を書いておく
  const rows = rgbRows();
  const predicted = new Uint8Array(rows);
  for (let y = 0; y < H; y += 1)
    for (let x = W - 1; x >= 1; x -= 1)
      for (let s = 0; s < 3; s += 1)
        predicted[(y * W + x) * 3 + s] = (rows[(y * W + x) * 3 + s] - rows[(y * W + x - 1) * 3 + s]) & 255;
  const bytes = makeTiff([rgbPage({ compression: 5, pixels: predicted, extra: [[317, TYPE.SHORT, [2]]] })]);
  assert.equal(maxDifference(toRgb(decodedPixels(bytes)), rows), 0);
});

test('2値は 1bit のまま返し、WhiteIsZero は inverted になる（確定事項12）', () => {
  const bits = triangleBits(W, H);
  const white0 = decodedPixels(makeTiff([{ width: W, height: H, bitsPerSample: [1], photometric: 0, compression: 1, pixels: bits }]));
  assert.equal(white0.colorSpace, 'gray');
  assert.equal(white0.bitsPerComponent, 1);
  assert.equal(white0.inverted, true);
  assert.deepEqual(Array.from(white0.bytes), Array.from(bits));
  assert.deepEqual(pixelAt(toRgb(white0), W, 0, 0), [0, 0, 0], '左上は黒');
  assert.deepEqual(pixelAt(toRgb(white0), W, W - 1, H - 1), [255, 255, 255], '右下は白');
  const black0 = decodedPixels(makeTiff([{ width: W, height: H, bitsPerSample: [1], photometric: 1, compression: 32773, pixels: bits }]));
  assert.equal(black0.inverted, false);
  assert.deepEqual(pixelAt(toRgb(black0), W, 0, 0), [255, 255, 255]);
});

test('FillOrder 2 の無圧縮はビットを反転して読む', () => {
  const rows = Uint8Array.from([0b10000000, 0b00000001, 0b11110000, 0b00001111]);
  const bytes = makeTiff([{ width: 16, height: 2, bitsPerSample: [1], photometric: 1, compression: 1, pixels: rows, extra: [[266, TYPE.SHORT, [2]]] }]);
  assert.deepEqual(Array.from(decodedPixels(bytes).bytes), [0b00000001, 0b10000000, 0b00001111, 0b11110000]);
});

test('CCITT G4・G3 の検体を伸長すると左上の三角が黒になる', () => {
  for (const [name, bytes] of [['G4', G4_TIFF], ['G3', G3_TIFF]]) {
    const pixels = decodedPixels(bytes);
    assert.equal(pixels.bitsPerComponent, 1, name);
    assert.equal(pixels.inverted, true, name);
    assert.deepEqual(Array.from(pixels.bytes), Array.from(triangleBits(64, 48)), name);
  }
});

test('gray の 4bit・8bit・16bit、パレットの 4bit・8bit を読む', () => {
  const g8 = Uint8Array.from({ length: W * H }, (_, i) => i * 3 & 255);
  const gray8 = decodedPixels(makeTiff([{ width: W, height: H, bitsPerSample: [8], photometric: 1, compression: 1, pixels: g8 }]));
  assert.equal(gray8.colorSpace, 'gray');
  assert.deepEqual(Array.from(gray8.bytes), Array.from(g8));
  const g4 = new Uint8Array(Math.ceil(W / 2) * H);
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1)
      g4[y * Math.ceil(W / 2) + (x >> 1)] |= (x & 1) ? (x + y) & 15 : ((x + y) & 15) << 4;
  const gray4 = decodedPixels(makeTiff([{ width: W, height: H, bitsPerSample: [4], photometric: 1, compression: 1, pixels: g4 }]));
  assert.equal(gray4.bitsPerComponent, 4);
  assert.deepEqual(pixelAt(toRgb(gray4), W, 3, 2), [85, 85, 85], '5/15 → 85');
  for (const littleEndian of [true, false]) {
    const g16 = new Uint8Array(W * H * 2);
    for (let i = 0; i < W * H; i += 1) { g16[i * 2 + (littleEndian ? 1 : 0)] = (i * 37) & 255; g16[i * 2 + (littleEndian ? 0 : 1)] = 7; }
    const gray16 = decodedPixels(makeTiff([{ width: W, height: H, bitsPerSample: [16], photometric: 1, compression: 1, pixels: g16 }], { littleEndian }));
    assert.equal(gray16.bitsPerComponent, 8, '16bit は上位バイトへ');
    assert.deepEqual(Array.from(gray16.bytes), Array.from({ length: W * H }, (_, i) => (i * 37) & 255), `littleEndian=${littleEndian}`);
  }
  const colorMap = [];
  for (let c = 0; c < 3; c += 1)
    for (let i = 0; i < 16; i += 1)
      colorMap.push((i * 17 * (c + 1) & 255) << 8);
  const palette4 = decodedPixels(makeTiff([{ width: W, height: H, bitsPerSample: [4], photometric: 3, compression: 5, pixels: g4, extra: [[320, TYPE.SHORT, colorMap]] }]));
  assert.equal(palette4.colorSpace, 'indexed');
  assert.equal(palette4.bitsPerComponent, 4);
  assert.equal(palette4.palette.length, 16 * 3);
  assert.deepEqual(pixelAt(toRgb(palette4), W, 3, 2), [85, 170, 255]);
  const map256 = [];
  for (let c = 0; c < 3; c += 1)
    for (let i = 0; i < 256; i += 1)
      map256.push((i * (c + 1) & 255) << 8);
  const palette8 = decodedPixels(makeTiff([{ width: W, height: H, bitsPerSample: [8], photometric: 3, compression: 1, pixels: g8, extra: [[320, TYPE.SHORT, map256]] }]));
  assert.deepEqual(pixelAt(toRgb(palette8), W, 1, 0), [3, 6, 9]);
});

test('RGBA は白で合成し、CMYK はそのまま渡す', () => {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i += 1)
    rgba.set([i & 255, 100, 200, (i * 9) & 255], i * 4);
  const unassociated = decodedPixels(makeTiff([{ width: W, height: H, bitsPerSample: [8, 8, 8, 8], photometric: 2, compression: 1, pixels: rgba, extra: [[338, TYPE.SHORT, [2]]] }]));
  assert.equal(unassociated.colorSpace, 'rgb');
  const alpha = rgba[4 * 4 + 3];
  assert.deepEqual(pixelAt(toRgb(unassociated), W, 4, 0), [0, 1, 2].map((c) => (rgba[16 + c] * alpha + 255 * (255 - alpha) + 127) / 255 | 0));
  const premultiplied = decodedPixels(makeTiff([{ width: W, height: H, bitsPerSample: [8, 8, 8, 8], photometric: 2, compression: 1, pixels: rgba, extra: [[338, TYPE.SHORT, [1]]] }]));
  assert.deepEqual(pixelAt(toRgb(premultiplied), W, 4, 0), [0, 1, 2].map((c) => Math.min(255, rgba[16 + c] + 255 - alpha)));
  const ignored = decodedPixels(makeTiff([{ width: W, height: H, bitsPerSample: [8, 8, 8, 8], photometric: 2, compression: 1, pixels: rgba, extra: [[338, TYPE.SHORT, [0]]] }]));
  assert.deepEqual(pixelAt(toRgb(ignored), W, 4, 0), [4, 100, 200], '未指定の4番目は捨てる');
  const cmyk = new Uint8Array(W * H * 4).fill(30);
  const decodedCmyk = decodedPixels(makeTiff([{ width: W, height: H, bitsPerSample: [8, 8, 8, 8], photometric: 5, compression: 1, pixels: cmyk, extra: [[332, TYPE.SHORT, [1]]] }]));
  assert.equal(decodedCmyk.colorSpace, 'cmyk');
  assert.deepEqual(Array.from(decodedCmyk.bytes), Array.from(cmyk));
});

test('JPEG 圧縮（7）は YCbCr でも RGB でも伸長できる', () => {
  for (const photometric of [6, 2]) {
    const bytes = makeTiff([{ width: 32, height: 24, bitsPerSample: [8, 8, 8], photometric, compression: 7, strips: [new Uint8Array(JPEG_32X24)] }]);
    const rgb = toRgb(decodedPixels(bytes));
    assert.ok(maxDifference(pixelAt(rgb, 32, 4, 4), [255, 0, 0]) <= 4, `photometric ${photometric}: 左は赤`);
    assert.ok(maxDifference(pixelAt(rgb, 32, 24, 20), [0, 0, 255]) <= 4, '右下は青');
    assert.ok(maxDifference(pixelAt(rgb, 32, 24, 4), [255, 255, 255]) <= 4, '右上は白');
  }
});

test('複数ページとタイルを読む', () => {
  const pages = makeTiff([rgbPage(), rgbPage({ width: 5, height: 4, pixels: rgbRows(5, 4) }), rgbPage({ width: 3, height: 2, pixels: rgbRows(3, 2) })]);
  assert.equal(frameCount('tiff', pages), 3);
  assert.equal(maxDifference(toRgb(decodedPixels(pages, 1)), rgbRows(5, 4)), 0);
  assert.equal(maxDifference(toRgb(decodedPixels(pages, 2)), rgbRows(3, 2)), 0);
  assert.match(decodeTiff(pages, { frame: 3 }).error, /そのページがありません/);
  const tiled = makeTiff([rgbPage({ tile: { width: 8, height: 8 } })]);
  assert.equal(maxDifference(toRgb(decodedPixels(tiled)), rgbRows()), 0);
});

test('対応外・壊れたものは文言で断り、投げない', () => {
  const bytes = makeTiff([rgbPage()]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifd = view.getUint32(4, true);
  const count = view.getUint16(ifd, true);
  for (let i = 0; i < count; i += 1)
    if (view.getUint16(ifd + 2 + i * 12, true) === 259) view.setUint16(ifd + 2 + i * 12 + 8, 6, true);
  assert.equal(decodeTiff(bytes).error, 'この TIFF には対応していません（圧縮方式: 旧 JPEG）。');
  assert.match(decodeTiff(bytes.subarray(0, 30)).error, /壊れている/);
  assert.match(decodeTiff(Buffer.from('not a tiff at all')).error, /TIFF/);
  // 画素が足りない（ストリップの長さを切り詰める）
  const short = makeTiff([rgbPage({ compression: 1 })]);
  const shortView = new DataView(short.buffer, short.byteOffset, short.byteLength);
  const shortIfd = shortView.getUint32(4, true);
  for (let i = 0; i < shortView.getUint16(shortIfd, true); i += 1)
    if (shortView.getUint16(shortIfd + 2 + i * 12, true) === 279) shortView.setUint32(shortIfd + 2 + i * 12 + 8, 5, true);
  const result = decodeTiff(short);
  assert.ok(result.ok === true || /壊れている/.test(result.error), '投げなければよい');
});

test('ディスクの検体 image-pages.tif と image-fax.tif', () => {
  const pages = fs.readFileSync(path.join(__dirname, 'fixtures', 'image-pages.tif'));
  assert.equal(frameCount('tiff', pages), 3);
  const second = decodeImage('tiff', pages, { frame: 1 });
  assert.equal(second.ok, true);
  assert.equal(second.pixels.colorSpace, 'gray');
  assert.deepEqual(pixelAt(toRgb(second.pixels), 320, 5, 5), [40, 40, 40]);
  const third = decodeImage('tiff', pages, { frame: 2 });
  assert.equal(third.pixels.bitsPerComponent, 1);
  const fax = decodeImage('tiff', fs.readFileSync(path.join(__dirname, 'fixtures', 'image-fax.tif')));
  assert.equal(fax.ok, true);
  assert.deepEqual(pixelAt(toRgb(fax.pixels), 64, 0, 0), [0, 0, 0]);
});
