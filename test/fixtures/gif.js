'use strict';

// テストに使う GIF をその場で組み立てる（spec-3-2 事前調査 B・F）。
//
// LZW は vendor/omggif.js の GifWriter に任せる（同じライブラリの Reader を検証する
// ことになるが、画素の期待値は自分で持つので循環にはならない）。GifWriter は
// インターレースを書けないので、行を飛び越しの順に並べ替えて書き、Image Descriptor の
// フラグを立てて作る。
//
//   palette      … [0xRRGGBB, …]。2 の冪の長さ（2〜256）
//   indices      … 幅×高さのインデックス列
//   transparent  … 透過にするインデックス（省略可）
//   interlaced   … 飛び越し
//   frames       … アニメ。[{ x, y, width, height, indices, palette?, transparent? }]（indices の代わりに）
//   gif87a       … ヘッダーを GIF87a にする

const path = require('node:path');

const { GifWriter } = require(path.join(__dirname, '..', '..', 'vendor', 'omggif.js'));

const HEADER_BYTES = 13;                 // "GIF89a" ＋ Logical Screen Descriptor

function interlacedOrder(height) {
  const order = [];
  for (let y = 0; y < height; y += 8) order.push(y);
  for (let y = 4; y < height; y += 8) order.push(y);
  for (let y = 2; y < height; y += 4) order.push(y);
  for (let y = 1; y < height; y += 2) order.push(y);
  return order;
}

function reorderRows(indices, width, height) {
  const out = new Uint8Array(width * height);
  interlacedOrder(height).forEach((y, index) => out.set(indices.subarray(y * width, (y + 1) * width), index * width));
  return out;
}

// 先頭の Image Descriptor（0x2C）を探し、飛び越しのビット（0x40）を立てる。
function markInterlaced(bytes, paletteLength) {
  let at = HEADER_BYTES + paletteLength * 3;
  while (at < bytes.length && bytes[at] !== 0x2c) {
    if (bytes[at] !== 0x21)
      throw new Error(`fixture: 予期しないブロック 0x${bytes[at].toString(16)}`);
    at += 2;                                       // 拡張の導入部とラベル
    while (bytes[at] !== 0)
      at += bytes[at] + 1;                         // サブブロック
    at += 1;
  }
  bytes[at + 9] |= 0x40;
}

function makeGif({ width, height, palette, indices = null, transparent, interlaced = false, frames = null, gif87a = false }) {
  const buffer = Buffer.alloc(2048 + width * height * 2);
  const writer = new GifWriter(buffer, width, height, { palette });
  if (frames === null) {
    const pixels = interlaced ? reorderRows(indices, width, height) : indices;
    writer.addFrame(0, 0, width, height, pixels, transparent === undefined ? {} : { transparent });
  } else {
    for (const frame of frames)
      writer.addFrame(frame.x ?? 0, frame.y ?? 0, frame.width ?? width, frame.height ?? height, frame.indices,
        { palette: frame.palette, delay: 10, transparent: frame.transparent });
  }
  const bytes = Buffer.from(buffer.subarray(0, writer.end()));
  if (gif87a)
    bytes[4] = 0x37;                               // "GIF87a"
  if (interlaced)
    markInterlaced(bytes, palette.length);
  return bytes;
}

// palette[i] の色を RGB の3バイトで返す（期待値の組み立てに使う）。
function paletteRgb(palette, index) {
  const color = palette[index];
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

module.exports = { makeGif, paletteRgb, interlacedOrder };
