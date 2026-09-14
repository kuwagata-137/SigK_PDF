'use strict';

// TIFF の IFD（Image File Directory）を自分で読む層（spec-3-2 確定事項4・5）。
//
// utif にも IFD 読み（`UTIF.decode`）はあるが、境界検査が無く、次 IFD が自分を指す
// 輪のある TIFF で無限ループしてヒープを使い切る（事前調査 A）。ここは**必要なタグだけ**を
// utif と同じ `tNNN` キーで読み、`UTIF.decodeImage(buffer, ifd)` へ渡せる object を返す。
//
// 先頭 64KB だけを渡されることがある（image-io.js）。IFD や値がバッファの外にあれば
// `{ error, incomplete: true }` を返し、呼ぶ側が全体を読み直す。
//
// pdf-lib にも fs にも依存しない。docs/07 第4章の「依存なしで回る層」である。

// 読むタグ。それ以外は読み飛ばす（EXIF・SubIFD・MakerNote の中には入らない）。
const WANTED_TAGS = new Set([254, 256, 257, 258, 259, 262, 266, 273, 277, 278, 279, 284, 317, 320, 322, 323, 324, 325, 338, 347]);

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const BYTE_TYPES = new Set([1, 6, 7]);
const NUMBER_TYPES = new Set([3, 4, 8, 9]);

// 1ファイルで辿る IFD の上限。輪は別に見張るが、鎖が異様に長いものもここで止める。
const MAX_PAGES = 10000;

// 対応する圧縮（確定事項5）。utif が伸長でき、検体で確かめたものだけ。
const SUPPORTED_COMPRESSION = new Set([1, 3, 4, 5, 7, 8, 32773, 32946]);

// 断るときに名前を添える圧縮。
const COMPRESSION_NAMES = {
  2: 'CCITT RLE', 6: '旧 JPEG', 9: 'ITU-T T.85', 10: 'ITU-T T.43', 32809: 'ThunderScan',
  34661: 'JBIG', 34712: 'JPEG 2000', 34925: 'LZMA', 50000: 'ZSTD', 50001: 'WebP',
};

const BROKEN = 'TIFF の構造を読み取れませんでした。ファイルが壊れている可能性があります。';
const NOT_TIFF = 'TIFF として読めませんでした。';
const NO_PAGES = 'この TIFF にはページがありません。';
const UNSUPPORTED_COLOR = 'この TIFF には対応していません（色の形式）。';

function describeCompression(compression) {
  return COMPRESSION_NAMES[compression] ?? null;
}

function readEntryValues(view, bytes, entryAt, littleEndian) {
  const type = view.getUint16(entryAt + 2, littleEndian);
  const count = view.getUint32(entryAt + 4, littleEndian);
  const size = TYPE_SIZE[type];
  if (size === undefined)
    return { skip: true };
  const total = size * count;
  const at = total <= 4 ? entryAt + 8 : view.getUint32(entryAt + 8, littleEndian);
  if (at + total > bytes.length)
    return { incomplete: true };
  if (BYTE_TYPES.has(type))
    return { values: bytes.subarray(at, at + count) };
  if (!NUMBER_TYPES.has(type))
    return { skip: true };
  const values = [];
  for (let index = 0; index < count; index += 1) {
    if (type === 3) values.push(view.getUint16(at + index * 2, littleEndian));
    else if (type === 4) values.push(view.getUint32(at + index * 4, littleEndian));
    else if (type === 8) values.push(view.getInt16(at + index * 2, littleEndian));
    else values.push(view.getInt32(at + index * 4, littleEndian));
  }
  return { values };
}

// 1つの IFD を読む。戻りは { ifd, next } か { incomplete } か { error }。
function readIfd(view, bytes, offset, littleEndian) {
  if (offset + 2 > bytes.length)
    return { incomplete: true };
  const count = view.getUint16(offset, littleEndian);
  const nextAt = offset + 2 + count * 12;
  if (nextAt + 4 > bytes.length)
    return { incomplete: true };
  const ifd = { offset };
  for (let index = 0; index < count; index += 1) {
    const entryAt = offset + 2 + index * 12;
    const tag = view.getUint16(entryAt, littleEndian);
    if (!WANTED_TAGS.has(tag))
      continue;
    const read = readEntryValues(view, bytes, entryAt, littleEndian);
    if (read.incomplete === true)
      return { incomplete: true };
    if (read.skip !== true)
      ifd[`t${tag}`] = read.values;
  }
  return { ifd, next: view.getUint32(nextAt, littleEndian) };
}

// 縮小画像（bit 0）と透明マスク（bit 2）はページではない（確定事項4）。
function isPageIfd(ifd) {
  const subfile = ifd.t254?.[0] ?? 0;
  return (subfile & 1) === 0 && (subfile & 4) === 0;
}

function readTiffDirectory(bytes) {
  if (bytes === null || bytes === undefined || bytes.length < 8)
    return { error: NOT_TIFF };
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if ((!littleEndian && !bigEndian) || view.getUint16(2, littleEndian) !== 42)
    return { error: NOT_TIFF };

  const pages = [];
  const visited = new Set();
  let offset = view.getUint32(4, littleEndian);
  while (offset !== 0) {
    if (visited.has(offset) || visited.size >= MAX_PAGES)
      return { error: BROKEN };
    visited.add(offset);
    const read = readIfd(view, bytes, offset, littleEndian);
    if (read.incomplete === true)
      return { error: BROKEN, incomplete: true };
    if (isPageIfd(read.ifd))
      pages.push(read.ifd);
    offset = read.next;
  }
  if (pages.length === 0)
    return { error: NO_PAGES };
  return { ok: true, littleEndian, pages };
}

function tiffFrameSize(ifd) {
  return { width: ifd?.t256?.[0] ?? 0, height: ifd?.t257?.[0] ?? 0 };
}

// 色の形式が、確定事項12 の解釈で扱えるものか。
function colorSupported(ifd) {
  const bits = ifd.t258 ?? [1];
  const samples = ifd.t277?.[0] ?? bits.length;
  const photometric = ifd.t262?.[0] ?? (samples >= 3 ? 2 : 1);
  const depth = bits[0];
  if (!bits.every((value) => value === depth) || ![1, 2, 4, 8, 16].includes(depth))
    return false;
  if ((ifd.t284?.[0] ?? 1) !== 1)
    return false;
  switch (photometric) {
    case 0:
    case 1:
      return samples === 1;
    case 2:
      return (samples === 3 || samples === 4) && (depth === 8 || depth === 16);
    case 3:
      return samples === 1 && depth <= 8 && Array.isArray(ifd.t320);
    case 5:
      return samples === 4 && depth === 8;
    case 6:
      return (ifd.t259?.[0] ?? 1) === 7 && samples === 3 && depth === 8;
    default:
      return false;
  }
}

// 対応できるページなら null、できなければ断る文言（確定事項5）。
function checkTiffSupport(ifd) {
  const compression = ifd.t259?.[0] ?? 1;
  if (!SUPPORTED_COMPRESSION.has(compression)) {
    const name = describeCompression(compression);
    return name === null
      ? `この TIFF には対応していません（圧縮方式 ${compression}）。`
      : `この TIFF には対応していません（圧縮方式: ${name}）。`;
  }
  if (!colorSupported(ifd))
    return UNSUPPORTED_COLOR;
  if (!Array.isArray(ifd.t273) && !Array.isArray(ifd.t324))
    return BROKEN;
  return null;
}

module.exports = {
  WANTED_TAGS,
  SUPPORTED_COMPRESSION,
  MAX_PAGES,
  describeCompression,
  readTiffDirectory,
  tiffFrameSize,
  checkTiffSupport,
};
