'use strict';

// ICO の読み書き（scripts/ico-file.js。docs/spec-5-2-open-with-icon.md 確定事項B5）。

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const { packIco, readIco, pngInfo } = require('../scripts/ico-file.js');

// 1 色で塗った size×size の PNG（既定は RGBA・8 ビット）。テストのためだけの小さな作り。
function solidPng(size, colorType = 6) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++)
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf)
      c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * (colorType === 6 ? 4 : 3), 0x80)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('PNG の頭から幅・高さ・色の型を読む', () => {
  assert.deepEqual(pngInfo(solidPng(20)), { width: 20, height: 20, bitDepth: 8, colorType: 6 });
  assert.throws(() => pngInfo(Buffer.from('not a png at all, just some text bytes')), /PNG ではありません/);
});

test('小さい順に並べて詰め、読み戻すと同じ中身になる。256px は目録に 0 と書く', () => {
  const pngs = [256, 16, 32].map((size) => solidPng(size));
  const ico = packIco(pngs);
  assert.deepEqual([...ico.subarray(0, 6)], [0, 0, 1, 0, 3, 0]);
  assert.equal(ico[6 + 16 * 2], 0, '256 は 0');
  const entries = readIco(ico);
  assert.deepEqual(entries.map(({ width, height, bitCount }) => [width, height, bitCount]), [[16, 16, 32], [32, 32, 32], [256, 256, 32]]);
  assert.ok(entries[0].data.equals(pngs[1]));
  assert.ok(entries[2].data.equals(pngs[0]));
  assert.deepEqual(entries.map(({ png }) => png.width), [16, 32, 256]);
  // 中身は目録のすぐ後ろから、隙間なく並ぶ。
  assert.equal(ico.length, 6 + 16 * 3 + pngs.reduce((sum, png) => sum + png.length, 0));
  // 目録の 16 バイトを丸ごと見る（幅・高さ・色の数 0・予約 0・面の数 1・ビット数 32・大きさ・位置）。
  let offset = 6 + 16 * 3;
  entries.forEach(({ width, entry, data }) => {
    const expected = Buffer.alloc(16);
    expected[0] = width === 256 ? 0 : width;
    expected[1] = width === 256 ? 0 : width;
    expected.writeUInt16LE(1, 4);
    expected.writeUInt16LE(32, 6);
    expected.writeUInt32LE(data.length, 8);
    expected.writeUInt32LE(offset, 12);
    assert.deepEqual([...entry], [...expected], `${width}px の目録`);
    offset += data.length;
  });
});

test('正方形でない・256px を超える・同じ大きさが 2 つ・空・RGBA でない絵は詰めない', () => {
  assert.throws(() => packIco([]), /絵がありません/);
  assert.throws(() => packIco([solidPng(512)]), /256px 以下/);
  assert.throws(() => packIco([solidPng(16), solidPng(16)]), /同じ大きさ/);
  assert.throws(() => packIco([solidPng(16, 2)]), /RGBA/);
  const wide = solidPng(16);
  wide.writeUInt32BE(32, 16);
  assert.throws(() => packIco([wide]), /正方形/);
});

test('ICO でないもの・枚数 0・目録や中身が切れている・中身の位置や大きさがおかしいものは読まない', () => {
  assert.throws(() => readIco(Buffer.from([0, 0, 2, 0, 1, 0])), /ICO ではありません/);
  assert.throws(() => readIco(Buffer.from([0, 0, 1, 0, 0, 0])), /1 枚も入っていません/);
  const ico = packIco([solidPng(16)]);
  assert.throws(() => readIco(ico.subarray(0, 10)), /目録が途中で切れています/);
  assert.throws(() => readIco(ico.subarray(0, ico.length - 1)), /ファイルの外/);
  const inHeader = Buffer.from(ico);
  inHeader.writeUInt32LE(6, 6 + 12);
  assert.throws(() => readIco(inHeader), /位置か大きさがおかしい/);
  const empty = Buffer.from(ico);
  empty.writeUInt32LE(0, 6 + 8);
  assert.throws(() => readIco(empty), /位置か大きさがおかしい/);
  const shortPng = Buffer.concat([ico.subarray(0, 22), ico.subarray(22, 22 + 20)]);
  shortPng.writeUInt32LE(20, 6 + 8);
  assert.throws(() => readIco(shortPng), /1 枚目: PNG ではありません/);
});
