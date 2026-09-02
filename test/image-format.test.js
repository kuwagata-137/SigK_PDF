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

test('先頭バイトで形式を見分ける', () => {
  assert.equal(detectFormat(makePng()), 'png');
  assert.equal(detectFormat(makeJpeg()), 'jpeg');
  assert.equal(detectFormat(Buffer.from('%PDF-1.7\n')), 'pdf');
  assert.equal(detectFormat(GIF87A), 'gif');
  assert.equal(detectFormat(GIF89A), 'gif');
  assert.equal(detectFormat(BMP), 'bmp');
});

test('知らない形式は既定拒否になる', () => {
  // WebP・HEIC・TIFF を1つずつ足さなくても、既定拒否なので自動的に落ちる。
  assert.equal(detectFormat(WEBP), null);
  assert.equal(detectFormat(Buffer.from('これはただのテキストです')), null);
  assert.equal(detectFormat(Buffer.alloc(0)), null);
  assert.equal(detectFormat(null), null);
  assert.equal(detectFormat(undefined), null);
});

test('受け付けるのは PDF・PNG・JPEG の3つだけである', () => {
  assert.equal(isSupported('pdf'), true);
  assert.equal(isSupported('png'), true);
  assert.equal(isSupported('jpeg'), true);
  assert.equal(isSupported('gif'), false);
  assert.equal(isSupported('bmp'), false);
  assert.equal(isSupported(null), false);
});

test('GIF と BMP は名指しで断る', () => {
  assert.match(describeFormat('gif'), /GIF は挿入できません/);
  assert.match(describeFormat('bmp'), /BMP は挿入できません/);
  // 名指しできないものは、何を選べばよいかだけを伝える。
  assert.match(describeFormat(null), /対応していない形式です/);
  assert.match(describeFormat(null), /PNG・JPEG・PDF/);
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
