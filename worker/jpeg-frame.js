'use strict';

// JPEG のマーカーを走査して SOF（Start Of Frame）を見つける層。
// image-format.js から切り出した（あちらは3形式を足して 200 行を超えたため）。
// 寸法とプログレッシブの判定（spec-1-6 確定事項53-2）がここに依る。

// 長さを持たない JPEG のマーカー。TEM・RSTn・SOI・EOI。
const JPEG_STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9]);

// SOF（Start Of Frame）のマーカー。C4（DHT）・C8（JPG）・CC（DAC）は SOF ではない。
const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const JPEG_PROGRESSIVE = 0xc2;

// JPEG のマーカーを走査して、最初の SOF セグメントを { marker, offset } で返す。
// offset はその `0xFF` の位置である（寸法を読むのに使う）。
//
// SOS（0xDA）から先はエントロピー符号で、その中に 0xFF が普通に現れるため、
// マーカーとして読んではいけない。そこで打ち切る。
function jpegStartOfFrame(bytes) {
  let at = 2;                                    // SOI の次から
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;                                   // ずれ・詰め物を読み飛ばす
      continue;
    }
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1;                                   // 0xFF の連続は詰め物である
      continue;
    }
    if (JPEG_STANDALONE.has(marker)) {
      at += 2;
      continue;
    }
    if (marker === 0xda)
      return null;                               // SOF を見ないまま本体へ入った
    if (at + 3 >= bytes.length)
      return null;
    if (JPEG_START_OF_FRAME.has(marker))
      return { marker, offset: at };
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2)
      return null;                               // 長さが壊れている
    at += 2 + length;
  }
  return null;
}

// プログレッシブ JPEG かどうか（確定事項53-2）。
//
// pdf-lib の JpegEmbedder は SOF2 を受理するが、PDF の DCTDecode はベースラインを
// 前提にしており、ビューアによって描けない恐れがある。**検体を作れず実測できて
// いない**ため、壊れたページが黙って入るより断るほうを採る。
function isProgressiveJpeg(bytes) {
  return jpegStartOfFrame(bytes)?.marker === JPEG_PROGRESSIVE;
}

// SOF セグメント `FF Cx LL LL P HH HH WW WW` から寸法を読む。読めなければ null。
function jpegSize(bytes) {
  const frame = jpegStartOfFrame(bytes);
  if (frame === null || frame.offset + 8 >= bytes.length)
    return null;
  const at = frame.offset;
  return {
    width: (bytes[at + 7] << 8) | bytes[at + 8],
    height: (bytes[at + 5] << 8) | bytes[at + 6],
  };
}

module.exports = { JPEG_PROGRESSIVE, jpegStartOfFrame, isProgressiveJpeg, jpegSize };
