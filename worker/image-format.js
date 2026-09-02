'use strict';

// 差し込むファイルの形式を先頭バイトで見分ける層（spec-1-6 確定事項53〜56）。
//
// **拡張子は見ない。**中身と食い違っていることがあるうえ、pdf-lib の埋め込みは
// 形式が違うと投げ方が揃わない（`embedPng` は**素の文字列**を、`embedJpg` は
// `Error` を投げる。実測 H）。**そもそも投げさせない**ために、渡す前にここで断る。
//
// 既定拒否にしてあるので、WebP・HEIC・TIFF なども自動的に落ちる。GIF と BMP だけは
// 名指しで断る（確定事項54）。よく間違えて選ばれる形式で、「対応していない形式です」
// だけでは何を選び直せばよいか分からないためである。
//
// pdf-lib にも fs にも依存しない。docs/07 第4章の「依存なしで回る層」である。

const SIGNATURES = [
  { kind: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },                    // %PDF-
  { kind: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { kind: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { kind: 'gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },              // GIF87a
  { kind: 'gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },              // GIF89a
  { kind: 'bmp', bytes: [0x42, 0x4d] },                                      // BM
];

const SUPPORTED = new Set(['pdf', 'png', 'jpeg']);

// 長さを持たない JPEG のマーカー。TEM・RSTn・SOI・EOI。
const JPEG_STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9]);

// SOF（Start Of Frame）のマーカー。C4（DHT）・C8（JPG）・CC（DAC）は SOF ではない。
const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const JPEG_PROGRESSIVE = 0xc2;

function startsWith(bytes, signature) {
  if (bytes.length < signature.length)
    return false;
  return signature.every((value, index) => bytes[index] === value);
}

// 分かるものだけ名前を返す。判別できなければ null（＝既定拒否）。
function detectFormat(bytes) {
  if (bytes === null || bytes === undefined || typeof bytes.length !== 'number')
    return null;
  for (const { kind, bytes: signature } of SIGNATURES) {
    if (startsWith(bytes, signature))
      return kind;
  }
  return null;
}

function isSupported(kind) {
  return SUPPORTED.has(kind);
}

// 断る理由。分かる形式は名指しで、それ以外はひとまとめにする（確定事項54）。
function describeFormat(kind) {
  switch (kind) {
    case 'gif':
      return 'GIF は挿入できません。PNG・JPEG・PDF を選んでください。';
    case 'bmp':
      return 'BMP は挿入できません。PNG・JPEG・PDF を選んでください。';
    default:
      return '対応していない形式です。PNG・JPEG・PDF を選んでください。';
  }
}

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

function readUint16(bytes, at) {
  return (bytes[at] << 8) | bytes[at + 1];
}

function readUint32(bytes, at) {
  return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
}

// 画素の寸法を、埋め込む**前**に読む（確定事項58）。
//
// pdf-lib は PNG を一度 RGBA へ完全展開するので、4032×3024 で rss が +50MB 増える
// （実測 H）。埋め込んでから測ったのでは、断る前に払わされてしまう。
//
//   PNG  … 署名8 ＋ 長さ4 ＋ "IHDR"4 のあとに幅・高さ（各4バイト・ビッグエンディアン）
//   JPEG … SOF セグメントの `FF Cx LL LL P HH HH WW WW`
// 読み取れなければ null を返す（呼び出し側が「壊れている」として扱う）。
function imageSize(kind, bytes) {
  if (kind === 'png') {
    if (bytes.length < 24)
      return null;
    return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) };
  }
  if (kind === 'jpeg') {
    const frame = jpegStartOfFrame(bytes);
    if (frame === null || frame.offset + 8 >= bytes.length)
      return null;
    return { width: readUint16(bytes, frame.offset + 7), height: readUint16(bytes, frame.offset + 5) };
  }
  return null;
}

module.exports = {
  SIGNATURES,
  JPEG_PROGRESSIVE,
  detectFormat,
  isSupported,
  describeFormat,
  jpegStartOfFrame,
  isProgressiveJpeg,
  imageSize,
};
