'use strict';

// GIF を画素列へ展開する（spec-3-2 確定事項11）。伸長は vendor/omggif.js の GifReader。
//
// **先頭フレームだけ**を使う（アニメ GIF の2枚目以降は見ない。起草者判断）。
// 論理画面の大きさで RGBA を白で埋めてから描く。GifReader は透過の画素を書かずに飛ばす
// ので、透過は白のまま残り、白い紙に載せたのと同じ見え方になる（確定事項17）。

const path = require('node:path');

const { GifReader } = require(path.join(__dirname, '..', 'vendor', 'omggif.js'));

const BROKEN = '画像を読み込めませんでした。ファイルが壊れている可能性があります。';
const SIZE_UNREADABLE = '画像の大きさを読み取れませんでした。';

function decodeGif(bytes) {
  let reader;
  try {
    reader = new GifReader(bytes);
  } catch (error) {
    return { error: BROKEN };
  }
  if (reader.numFrames() === 0)
    return { error: BROKEN };
  const { width, height } = reader;
  if (!(width > 0) || !(height > 0))
    return { error: SIZE_UNREADABLE };

  const rgba = new Uint8Array(width * height * 4).fill(255);
  try {
    reader.decodeAndBlitFrameRGBA(0, rgba);
  } catch (error) {
    return { error: BROKEN };
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let from = 0, to = 0; from < rgba.length; from += 4, to += 3) {
    rgb[to] = rgba[from];
    rgb[to + 1] = rgba[from + 1];
    rgb[to + 2] = rgba[from + 2];
  }
  return { ok: true, width, height, colorSpace: 'rgb', bitsPerComponent: 8, bytes: rgb };
}

module.exports = { decodeGif };
