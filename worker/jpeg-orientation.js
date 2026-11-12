'use strict';

// JPEG の EXIF の向き（Orientation。タグ 0x0112）を読む層（2026-11-12。画像のタブで縦長の写真が横長で開き、回転して上書き保存すると
// 縦横比が崩れた不具合の直し。spec-7-4 確定事項X1〜X3）。
//
// スマートフォンの写真は、画素を撮ったときの向きのまま書き、「何度回して見せるか」を EXIF の向きに書く。エクスプローラーはこの向きに
// 従って表示するが、PDF の DCTDecode には向きの決まりが無く、pdf.js は画素のまま描く。画像のタブは、向きのうち回転（3・6・8）だけを
// ページの回転（/Rotate）にして表示する（image-open-task.js）。鏡に映した向き（2・4・5・7）は回転では表せないので、画素のまま表示する。
//
// 保存のときに敷き直す元の JPEG（image-render.js）は、向きを 1（そのまま）に書き換えた写しを渡す。Chromium の createImageBitmap は
// imageOrientation: 'none' を指定しても EXIF の向きを当てるので（Electron 44 で実測）、書き換えないと、pdf.js の描いた画素と向きが食い違う。

// 向きの番号と、表示のために回す角度（時計回り）。
const ROTATION_OF = { 1: 0, 3: 180, 6: 90, 8: 270 };

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];   // "Exif\0\0"
const ORIENTATION_TAG = 0x0112;
const SHORT = 3;

// 長さを持たない JPEG のマーカー（jpeg-frame.js と同じ）。
const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9]);

// APP1 の Exif を探し、TIFF の頭の位置と、セグメントの終わりを返す。無ければ null。SOS から先はエントロピー符号なので見ない。
function exifRange(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return null;
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff || bytes[at + 1] === 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1];
    if (STANDALONE.has(marker)) {
      at += 2;
      continue;
    }
    if (marker === 0xda)
      return null;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2)
      return null;
    const end = Math.min(at + 2 + length, bytes.length);
    if (marker === 0xe1 && EXIF_HEADER.every((value, index) => bytes[at + 4 + index] === value))
      return { tiff: at + 10, end };
    at += 2 + length;
  }
  return null;
}

// 0 番目の IFD の向きの項目を探し、値の位置・値・バイトの並び（リトルエンディアンか）を返す。無ければ・壊れていれば null。
function orientationEntry(bytes) {
  const range = exifRange(bytes);
  if (range === null)
    return null;
  const { tiff, end } = range;
  if (tiff + 8 > end)
    return null;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d))
    return null;
  const u16 = (at) => (little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]);
  const u32 = (at) => (little ? u16(at) + u16(at + 2) * 0x10000 : u16(at) * 0x10000 + u16(at + 2));
  if (u16(tiff + 2) !== 42)
    return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end)
    return null;
  const count = u16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end)
      return null;
    if (u16(entry) !== ORIENTATION_TAG)
      continue;
    if (u16(entry + 2) !== SHORT || u32(entry + 4) !== 1)
      return null;
    return { at: entry + 8, value: u16(entry + 8), little };
  }
  return null;
}

// 向きの番号（1〜8）。向きが無い・読めないときは 1（そのまま）。
function jpegOrientation(bytes) {
  const entry = orientationEntry(bytes);
  return entry !== null && entry.value >= 1 && entry.value <= 8 ? entry.value : 1;
}

// 表示のために回す角度（0・90・180・270）。鏡に映した向きは 0。
function rotationOf(orientation) {
  return ROTATION_OF[orientation] ?? 0;
}

// 向きを 1 に書き換えた写し。向きが無い・もともと 1 なら、受け取ったものをそのまま返す（書き換えない）。
function withoutOrientation(bytes) {
  const entry = orientationEntry(bytes);
  if (entry === null || entry.value === 1)
    return bytes;
  const copy = new Uint8Array(bytes);
  copy[entry.at] = entry.little ? 1 : 0;
  copy[entry.at + 1] = entry.little ? 0 : 1;
  return copy;
}

module.exports = { jpegOrientation, rotationOf, withoutOrientation };
