'use strict';

// pdf-lib が埋め込めない形式（BMP・GIF・TIFF）を画素列へ展開する入口（spec-3-2 確定事項9）。
//
// 戻りは `{ ok, pixels }` か `{ error }`。pixels の形は確定事項8:
//   { width, height, colorSpace: 'gray' | 'rgb' | 'cmyk' | 'indexed', bitsPerComponent: 1 | 2 | 4 | 8,
//     bytes, palette?, inverted? }
// bytes は PDF の画像ストリームにそのまま入る並びで、pixel-image.js が /XObject にする。
// PNG・JPEG はここへ来ない（image-page.js が pdf-lib の embedPng／embedJpg へ渡す）。

const { decodeBmp } = require('./decode-bmp.js');
const { decodeGif } = require('./decode-gif.js');
const { decodeTiff, frameCountOf } = require('./decode-tiff.js');

const DECODERS = {
  bmp: (bytes) => decodeBmp(bytes),
  gif: (bytes) => decodeGif(bytes),
  tiff: (bytes, frame) => decodeTiff(bytes, { frame }),
};

function decodeImage(kind, bytes, { frame = 0 } = {}) {
  const decode = DECODERS[kind];
  if (decode === undefined)
    return { error: '対応していない形式です。' };
  if (frame !== 0 && kind !== 'tiff')
    return { error: '差し込む画像にそのページがありません。' };
  const decoded = decode(bytes, frame);
  if (decoded.ok !== true)
    return { error: decoded.error };
  const { ok, ...pixels } = decoded;
  return { ok: true, pixels };
}

// ページ（フレーム）の数。複数ページを持つのは TIFF だけ（GIF のアニメは先頭だけを使う）。
function frameCount(kind, bytes) {
  if (kind === 'tiff')
    return frameCountOf(bytes);
  return DECODERS[kind] === undefined ? 0 : 1;
}

module.exports = { decodeImage, frameCount };
