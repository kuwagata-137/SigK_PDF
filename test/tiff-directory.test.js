'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { readTiffDirectory, checkTiffSupport, tiffFrameSize, describeCompression } = require('../worker/tiff-directory.js');
const { makeTiff, TYPE } = require('./fixtures/tiff.js');
const { G4_TIFF } = require('./fixtures/ccitt.js');

const rgbPage = (extra = {}) => ({
  width: 5, height: 3, bitsPerSample: [8, 8, 8], photometric: 2, compression: 1,
  pixels: new Uint8Array(5 * 3 * 3).fill(7), ...extra,
});

function setNextIfd(bytes, ifdOffset, value, le = true) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(ifdOffset, le);
  view.setUint32(ifdOffset + 2 + count * 12, value, le);
}

test('readTiffDirectory は II と MM の両方でページを読む', () => {
  for (const littleEndian of [true, false]) {
    const read = readTiffDirectory(makeTiff([rgbPage()], { littleEndian }));
    assert.equal(read.ok, true);
    assert.equal(read.littleEndian, littleEndian);
    assert.equal(read.pages.length, 1);
    assert.deepEqual(read.pages[0].t256, [5]);
    assert.deepEqual(read.pages[0].t257, [3]);
    assert.deepEqual(read.pages[0].t258, [8, 8, 8]);       // 4 バイトを超える値（後ろに置かれる）
    assert.deepEqual(read.pages[0].t262, [2]);
    assert.equal(read.pages[0].t273.length, 1);
    assert.equal(read.pages[0].t279[0], 45);
  }
});

test('readTiffDirectory は IFD の鎖をページの順に辿る', () => {
  const bytes = makeTiff([rgbPage(), rgbPage({ width: 7, height: 2, pixels: new Uint8Array(7 * 2 * 3) }), rgbPage({ width: 1, height: 1, pixels: new Uint8Array(3) })]);
  const read = readTiffDirectory(bytes);
  assert.equal(read.pages.length, 3);
  assert.deepEqual(read.pages.map((page) => page.t256[0]), [5, 7, 1]);
});

test('readTiffDirectory は縮小画像と透明マスクの IFD をページに数えない', () => {
  const bytes = makeTiff([
    rgbPage(),
    rgbPage({ width: 2, height: 1, pixels: new Uint8Array(6), extra: [[254, TYPE.LONG, [1]]] }),   // reduced-resolution
    rgbPage({ width: 3, height: 1, pixels: new Uint8Array(9), extra: [[254, TYPE.LONG, [4]]] }),   // transparency mask
    rgbPage({ width: 4, height: 1, pixels: new Uint8Array(12), extra: [[254, TYPE.LONG, [2]]] }),  // 複数ページの1ページ（数える）
  ]);
  const read = readTiffDirectory(bytes);
  assert.deepEqual(read.pages.map((page) => page.t256[0]), [5, 4]);
});

test('readTiffDirectory は次の IFD が自分を指す輪で止まる', () => {
  const bytes = makeTiff([rgbPage()]);
  const ifdOffset = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
  setNextIfd(bytes, ifdOffset, ifdOffset);
  const read = readTiffDirectory(bytes);
  assert.equal(read.ok, undefined);
  assert.match(read.error, /壊れている/);
});

test('readTiffDirectory は先頭だけでは IFD に届かないとき incomplete を返す', () => {
  const whole = makeTiff([rgbPage()]);
  const head = whole.subarray(0, 8 + 10);                   // ヘッダーと画素の途中まで
  const read = readTiffDirectory(head);
  assert.equal(read.incomplete, true);
  assert.match(read.error, /TIFF/);
});

test('readTiffDirectory は後ろに置かれた値に届かないときも incomplete を返す', () => {
  const whole = makeTiff([rgbPage()]);
  // IFD の表までは含み、その後ろ（t258 の3値・次 IFD の 4 バイト）を切る
  const ifdOffset = new DataView(whole.buffer, whole.byteOffset).getUint32(4, true);
  const count = new DataView(whole.buffer, whole.byteOffset).getUint16(ifdOffset, true);
  const head = whole.subarray(0, ifdOffset + 2 + count * 12 + 4);
  const read = readTiffDirectory(head);
  assert.equal(read.incomplete, true);
});

test('readTiffDirectory は先頭 8 バイトが TIFF でなければ断る', () => {
  const read = readTiffDirectory(Buffer.from('II*\0\0\0\0'));
  assert.match(read.error, /TIFF/);
});

test('readTiffDirectory はページの無い TIFF（縮小画像だけ）を断る', () => {
  const bytes = makeTiff([rgbPage({ extra: [[254, TYPE.LONG, [1]]] })]);
  const read = readTiffDirectory(bytes);
  assert.match(read.error, /ページ/);
});

test('readTiffDirectory は JPEGTables をバイト列で、ColorMap を数値で持つ', () => {
  const colorMap = Array.from({ length: 3 * 4 }, (_, i) => i * 1000);
  const bytes = makeTiff([{
    width: 2, height: 2, bitsPerSample: [2], photometric: 3, compression: 1, pixels: new Uint8Array(2),
    extra: [[320, TYPE.SHORT, colorMap], [347, TYPE.UNDEFINED, [0xff, 0xd8, 0xff, 0xd9, 1, 2]]],
  }]);
  const read = readTiffDirectory(bytes);
  assert.deepEqual(read.pages[0].t320, colorMap);
  assert.ok(read.pages[0].t347 instanceof Uint8Array);
  assert.deepEqual(Array.from(read.pages[0].t347), [0xff, 0xd8, 0xff, 0xd9, 1, 2]);
});

test('readTiffDirectory は GDI+ の G4 検体を読む', () => {
  const read = readTiffDirectory(G4_TIFF);
  assert.equal(read.ok, true);
  assert.deepEqual(tiffFrameSize(read.pages[0]), { width: 64, height: 48 });
  assert.deepEqual(read.pages[0].t259, [4]);
  assert.deepEqual(read.pages[0].t262, [0]);
});

test('checkTiffSupport は対応する圧縮と色の形式を通す', () => {
  const ok = (page) => assert.equal(checkTiffSupport(page), null);
  ok({ t256: [4], t257: [4], t258: [8, 8, 8], t259: [5], t262: [2], t277: [3], t273: [8] });
  ok({ t256: [4], t257: [4], t258: [1], t259: [4], t262: [0], t277: [1], t273: [8] });
  ok({ t256: [4], t257: [4], t258: [8], t259: [32773], t262: [1], t277: [1], t273: [8] });
  ok({ t256: [4], t257: [4], t258: [4], t259: [1], t262: [3], t277: [1], t273: [8], t320: new Array(48).fill(0) });
  ok({ t256: [4], t257: [4], t258: [8, 8, 8, 8], t259: [32946], t262: [5], t277: [4], t273: [8] });
  ok({ t256: [4], t257: [4], t258: [8, 8, 8, 8], t259: [8], t262: [2], t277: [4], t338: [2], t273: [8] });
  ok({ t256: [4], t257: [4], t258: [8, 8, 8], t259: [7], t262: [6], t277: [3], t324: [8] });   // JPEG の YCbCr
  ok({ t256: [4], t257: [4], t258: [16], t259: [1], t262: [1], t277: [1], t273: [8] });
  ok({ t256: [4], t257: [4], t259: [1], t273: [8] });                                       // bps・photometric 省略 = 2値
});

test('checkTiffSupport は非対応の圧縮を名指しで断る', () => {
  const page = (compression) => ({ t256: [4], t257: [4], t258: [8], t259: [compression], t262: [1], t277: [1], t273: [8] });
  assert.equal(checkTiffSupport(page(6)), 'この TIFF には対応していません（圧縮方式: 旧 JPEG）。');
  assert.equal(checkTiffSupport(page(2)), 'この TIFF には対応していません（圧縮方式: CCITT RLE）。');
  assert.equal(checkTiffSupport(page(34712)), 'この TIFF には対応していません（圧縮方式: JPEG 2000）。');
  assert.equal(checkTiffSupport(page(99999)), 'この TIFF には対応していません（圧縮方式 99999）。');
  assert.equal(describeCompression(34661), 'JBIG');
});

test('checkTiffSupport は色の形式で断る', () => {
  const base = { t256: [4], t257: [4], t273: [8] };
  const bad = (page) => assert.equal(checkTiffSupport({ ...base, ...page }), 'この TIFF には対応していません（色の形式）。');
  bad({ t258: [8, 8, 8], t259: [1], t262: [2], t277: [3], t284: [2] });     // PlanarConfiguration 2
  bad({ t258: [8, 8, 8], t259: [1], t262: [6], t277: [3] });                 // YCbCr の非圧縮
  bad({ t258: [8], t259: [1], t262: [8], t277: [1] });                       // CIELab
  bad({ t258: [32], t259: [1], t262: [1], t277: [1] });                      // 32bit
  bad({ t258: [8, 8], t259: [1], t262: [1], t277: [2] });                    // gray に 2ch
  bad({ t258: [8, 8, 8, 8, 8], t259: [1], t262: [2], t277: [5] });           // RGB に 5ch
  bad({ t258: [16], t259: [1], t262: [3], t277: [1], t320: [] });            // 16bit パレット
  bad({ t258: [8], t259: [1], t262: [3], t277: [1] });                       // ColorMap 無し
  bad({ t258: [8, 8, 8], t259: [1], t262: [5], t277: [3] });                 // CMYK に 3ch
  bad({ t258: [8, 8, 8], t259: [1], t262: [2], t277: [3], t258_: null, t258: [8, 8, 4] }); // bps が揃わない
});

test('checkTiffSupport は画素の置き場が無いと壊れていると言う', () => {
  assert.match(checkTiffSupport({ t256: [4], t257: [4], t258: [8], t259: [1], t262: [1], t277: [1] }), /壊れている/);
});
