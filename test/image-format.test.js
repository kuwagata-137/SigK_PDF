'use strict';

// 差し込むファイルの形式を見分ける層のテスト（spec-1-6 確定事項53〜58）。
//
// 依存なしで回る層である（`docs/07` 第4章）。pdf-lib も fs も要らない。

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectFormat,
  isSupported,
  describeFormat,
  jpegStartOfFrame,
  isProgressiveJpeg,
  imageSize,
} = require('../worker/image-format.js');
const { makePng, makeJpeg, GIF87A, GIF89A, BMP, WEBP } = require('./fixtures/images.js');
const { makeBmp, rgbaGradient } = require('./fixtures/bmp.js');
const { makeGif } = require('./fixtures/gif.js');
const { makeTiff } = require('./fixtures/tiff.js');
const { G4_TIFF } = require('./fixtures/ccitt.js');

const rgbTiffPage = (width, height, extra = {}) => ({
  width, height, bitsPerSample: [8, 8, 8], photometric: 2, compression: 1, pixels: new Uint8Array(width * height * 3), ...extra,
});

test('先頭バイトで形式を見分ける', () => {
  assert.equal(detectFormat(makePng()), 'png');
  assert.equal(detectFormat(makeJpeg()), 'jpeg');
  assert.equal(detectFormat(Buffer.from('%PDF-1.7\n')), 'pdf');
  assert.equal(detectFormat(GIF87A), 'gif');
  assert.equal(detectFormat(GIF89A), 'gif');
  assert.equal(detectFormat(BMP), 'bmp');
  assert.equal(detectFormat(Buffer.from('II*\0')), 'tiff');
  assert.equal(detectFormat(Buffer.from('MM\0*')), 'tiff');
});

test('知らない形式は既定拒否になる', () => {
  // WebP・HEIC・BigTIFF を1つずつ足さなくても、既定拒否なので自動的に落ちる。
  assert.equal(detectFormat(WEBP), null);
  assert.equal(detectFormat(Buffer.from('II+\0\x08\0\0\0')), null);
  assert.equal(detectFormat(Buffer.from('これはただのテキストです')), null);
  assert.equal(detectFormat(Buffer.alloc(0)), null);
  assert.equal(detectFormat(null), null);
  assert.equal(detectFormat(undefined), null);
});

test('受け付けるのは PDF と5つの画像形式である（spec-3-2 確定事項1）', () => {
  for (const kind of ['pdf', 'png', 'jpeg', 'gif', 'bmp', 'tiff'])
    assert.equal(isSupported(kind), true, kind);
  assert.equal(isSupported('webp'), false);
  assert.equal(isSupported(null), false);
});

test('断る文言は、何を選べばよいかを伝える（spec-3-2 確定事項2）', () => {
  assert.equal(describeFormat(null), '対応していない形式です。PNG・JPEG・BMP・GIF・TIFF・PDF を選んでください。');
  assert.equal(describeFormat('webp'), describeFormat(null));
});

test('JPEG の SOF マーカーを見つける', () => {
  assert.equal(jpegStartOfFrame(makeJpeg({ marker: 0xc0 })).marker, 0xc0);
  assert.equal(jpegStartOfFrame(makeJpeg({ marker: 0xc2 })).marker, 0xc2);
  // SOI だけで SOF が無ければ null。
  assert.equal(jpegStartOfFrame(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null);
});

test('SOS より先は走査しない', () => {
  // SOS のあとの本体には 0xFF が普通に現れる。マーカーとして読むと、
  // 本体の中身しだいでプログレッシブと誤判定してしまう。
  const body = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    Buffer.from([0xff, 0xc2, 0x00, 0x0b]),           // 本体の中に現れた「SOF2 らしきもの」
    Buffer.from([0xff, 0xd9]),
  ]);
  assert.equal(jpegStartOfFrame(body), null);
  assert.equal(isProgressiveJpeg(body), false);
});

test('SOF2 のものだけをプログレッシブと呼ぶ', () => {
  assert.equal(isProgressiveJpeg(makeJpeg({ marker: 0xc2 })), true);
  assert.equal(isProgressiveJpeg(makeJpeg({ marker: 0xc0 })), false);
  assert.equal(isProgressiveJpeg(makeJpeg({ marker: 0xc1 })), false, '拡張シーケンシャルは断らない');
});

test('埋め込む前に画素の寸法を読む', () => {
  // pdf-lib は PNG を RGBA へ完全展開するので、埋め込んでから測ったのでは遅い。
  assert.deepEqual(imageSize('png', makePng({ width: 40, height: 30 })), { width: 40, height: 30 });
  assert.deepEqual(imageSize('jpeg', makeJpeg({ width: 4032, height: 3024 })), { width: 4032, height: 3024 });
  assert.equal(imageSize('pdf', Buffer.from('%PDF-1.7')), null);
  assert.equal(imageSize('png', Buffer.alloc(10)), null, '短すぎるものは読み取れない');
});

test('0画素の PNG も寸法として読める', () => {
  // embedPng は 0×0 でも成功し、pdf.js は US Letter の白紙として描く（実測）。
  // 無言で紙が増えないよう、ここで 0 が見えるようにしておく。
  assert.deepEqual(imageSize('png', makePng({ width: 0, height: 0 })), { width: 0, height: 0 });
});

// ---- 変換向けの判定（spec-3-1 確定事項1・4・17） ----

const { inspectImageBytes, describeImageFormat, IMAGE_KINDS, MAX_PIXELS } = require('../worker/image-format.js');

test('画像として載せられるかを1本で判定する', () => {
  assert.deepEqual(inspectImageBytes(makePng({ width: 40, height: 30 })), { ok: true, kind: 'png', width: 40, height: 30, pages: 1, frames: [{ width: 40, height: 30 }] });
  assert.deepEqual(inspectImageBytes(makeJpeg({ width: 4032, height: 3024 })), { ok: true, kind: 'jpeg', width: 4032, height: 3024, pages: 1, frames: [{ width: 4032, height: 3024 }] });
  assert.equal(IMAGE_KINDS.has('pdf'), false, 'PDF は画像ではない');
  for (const kind of ['gif', 'bmp', 'tiff'])
    assert.equal(IMAGE_KINDS.has(kind), true, kind);
});

test('形式・プログレッシブ・寸法・画素上限の順で断る', () => {
  assert.equal(inspectImageBytes(Buffer.from('%PDF-1.7\n')).error, 'PDF は画像ではありません。PNG・JPEG・BMP・GIF・TIFF を選んでください。');
  assert.equal(inspectImageBytes(WEBP).error, '対応していない形式です。PNG・JPEG・BMP・GIF・TIFF を選んでください。');
  assert.match(inspectImageBytes(makeJpeg({ marker: 0xc2 })).error, /プログレッシブ形式/);
  assert.match(inspectImageBytes(makePng({ width: 0, height: 0 })).error, /大きさを読み取れません/);
  assert.ok(9000 * 5000 > MAX_PIXELS);
  assert.match(inspectImageBytes(makeJpeg({ width: 9000, height: 5000 })).error, /大きすぎます/);
});

// ---- BMP・GIF・TIFF の寸法とページ数（spec-3-2 確定事項3・6） ----

test('BMP と GIF の寸法は先頭のヘッダーから読む', () => {
  const bmp = makeBmp({ width: 37, height: 21, bits: 24, pixels: rgbaGradient(37, 21) });
  assert.deepEqual(imageSize('bmp', bmp), { width: 37, height: 21 });
  const topDown = makeBmp({ width: 37, height: 21, bits: 24, pixels: rgbaGradient(37, 21), topDown: true });
  assert.deepEqual(imageSize('bmp', topDown), { width: 37, height: 21 }, '高さが負でも絶対値');
  const gif = makeGif({ width: 300, height: 7, palette: [0, 0xffffff], indices: new Uint8Array(300 * 7) });
  assert.deepEqual(imageSize('gif', gif), { width: 300, height: 7 });
  assert.deepEqual(inspectImageBytes(bmp), { ok: true, kind: 'bmp', width: 37, height: 21, pages: 1, frames: [{ width: 37, height: 21 }] });
  assert.equal(inspectImageBytes(gif).pages, 1);
  // 先頭の数バイトしか無ければ寸法が読めず、incomplete になる
  assert.equal(inspectImageBytes(BMP).incomplete, true);
  assert.equal(inspectImageBytes(GIF89A.subarray(0, 8)).incomplete, true);
});

test('TIFF は全ページの寸法とページ数を返す', () => {
  const bytes = makeTiff([rgbTiffPage(640, 480), rgbTiffPage(320, 240), rgbTiffPage(8, 8)]);
  assert.deepEqual(inspectImageBytes(bytes), {
    ok: true, kind: 'tiff', width: 640, height: 480, pages: 3,
    frames: [{ width: 640, height: 480 }, { width: 320, height: 240 }, { width: 8, height: 8 }],
  });
  assert.deepEqual(imageSize('tiff', bytes), { width: 640, height: 480 });
  assert.deepEqual(imageSize('tiff', bytes, { frame: 2 }), { width: 8, height: 8 });
  assert.equal(imageSize('tiff', bytes, { frame: 3 }), null);
  assert.equal(inspectImageBytes(G4_TIFF).pages, 1);
});

// 2ページ目の圧縮タグを書き換える（fixture では作れない値を試すため）。
function patchSecondPageCompression(bytes, compression) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const first = view.getUint32(4, true);
  const second = view.getUint32(first + 2 + view.getUint16(first, true) * 12, true);
  const count = view.getUint16(second, true);
  for (let i = 0; i < count; i += 1)
    if (view.getUint16(second + 2 + i * 12, true) === 259) view.setUint16(second + 2 + i * 12 + 8, compression, true);
}

test('TIFF は IFD が先頭の外なら incomplete を立て、1ページでも対応外なら断る', () => {
  const whole = makeTiff([rgbTiffPage(640, 480)]);
  const head = inspectImageBytes(whole.subarray(0, 64 * 1024));
  assert.equal(head.incomplete, true);
  assert.equal(head.kind, 'tiff');
  const oldJpeg = makeTiff([rgbTiffPage(4, 4), rgbTiffPage(4, 4)]);
  patchSecondPageCompression(oldJpeg, 6);
  assert.equal(inspectImageBytes(oldJpeg).error, 'この TIFF には対応していません（圧縮方式: 旧 JPEG）。');
  const huge = makeTiff([rgbTiffPage(4, 4), { ...rgbTiffPage(4, 4), width: 9000, height: 5000 }]);
  assert.match(inspectImageBytes(huge).error, /大きすぎます/);
  assert.match(inspectImageBytes(Buffer.from('II*\0\x08\0\0\0\0\0')).error, /壊れている|ページ/);
});

test('先頭だけでは寸法が見つからないときは incomplete を立てる', () => {
  // 画面は先頭 64KB しか読まない（確定事項4）。SOF がその先にあれば、全体を読み直す合図になる。
  const head = makeJpeg().subarray(0, 4);
  const result = inspectImageBytes(head);
  assert.equal(result.incomplete, true);
  assert.equal(result.kind, 'jpeg');
});

test('断る文言は形式ごとに1か所で決める', () => {
  assert.match(describeImageFormat('pdf'), /PDF は画像ではありません/);
  assert.match(describeImageFormat(null), /対応していない形式/);
  assert.doesNotMatch(describeImageFormat(null), /まだ/);
});
