'use strict';

// BMP を PDF の画像ストリームに入る画素列へ展開する（spec-3-2 確定事項8・10）。
//
// 自作である。bmp-js・bmp-ts は V4／V5 ヘッダーでごみを返す、32bit BI_RGB の予約バイトを
// alpha と見て全透明にする、RLE の添字を誤る、`bfOffBits` を見ない、と**白紙やごみのページを
// 黙って作る**誤りがあり、包んで直すより書くほうが短かった（事前調査 C）。
//
// 対応: BITMAPINFOHEADER 以降（40／52／56／108／124 バイト）、1／4／8bit パレット（RLE4／RLE8
// 込み）、16／32bit（既定マスクと BI_BITFIELDS）、24bit、上から並ぶもの（高さが負）。
// パレットの画像は `indexed`（PDF の /Indexed）、それ以外は `rgb`。alpha マスクは白で合成する。

const BI_RGB = 0;
const BI_RLE8 = 1;
const BI_RLE4 = 2;
const BI_BITFIELDS = 3;
const BI_ALPHABITFIELDS = 6;

const DEFAULT_MASKS = {
  16: { r: 0x7c00, g: 0x03e0, b: 0x001f, a: 0 },
  32: { r: 0x00ff0000, g: 0x0000ff00, b: 0x000000ff, a: 0 },
};

const UNSUPPORTED = 'この BMP には対応していません（圧縮か色深度）。';
const OLD_HEADER = 'この BMP には対応していません（古い形式）。';
const SIZE_UNREADABLE = '画像の大きさを読み取れませんでした。';
const BROKEN = '画像を読み込めませんでした。ファイルが壊れている可能性があります。';

function readHeader(bytes) {
  if (bytes.length < 54)
    return { error: SIZE_UNREADABLE };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint32(14, true);
  if (headerSize < 40)
    return { error: OLD_HEADER };
  const rawHeight = view.getInt32(22, true);
  const header = {
    offset: view.getUint32(10, true),
    headerSize,
    width: view.getInt32(18, true),
    height: Math.abs(rawHeight),
    topDown: rawHeight < 0,
    bits: view.getUint16(28, true),
    compression: view.getUint32(30, true),
    colors: view.getUint32(46, true),
    masks: DEFAULT_MASKS[view.getUint16(28, true)] ?? null,
  };
  const hasMasks = header.compression === BI_BITFIELDS || header.compression === BI_ALPHABITFIELDS;
  if (hasMasks && bytes.length >= 70) {
    header.masks = { r: view.getUint32(54, true), g: view.getUint32(58, true), b: view.getUint32(62, true), a: 0 };
    if (headerSize >= 56 || header.compression === BI_ALPHABITFIELDS)
      header.masks.a = view.getUint32(66, true);
  }
  return header;
}

function unsupported(header) {
  const { bits, compression, masks } = header;
  if (![1, 4, 8, 16, 24, 32].includes(bits))
    return true;
  if (![BI_RGB, BI_RLE8, BI_RLE4, BI_BITFIELDS, BI_ALPHABITFIELDS].includes(compression))
    return true;
  if ((compression === BI_RLE8 && bits !== 8) || (compression === BI_RLE4 && bits !== 4))
    return true;
  return bits > 8 && bits !== 24 && (masks === null || masks.r === 0);
}

// パレットは BGRX の4バイト並び。RGB の3バイト並びに直す。
function readPalette(bytes, header) {
  const count = header.colors > 0 ? Math.min(header.colors, 1 << header.bits) : (1 << header.bits);
  const at = 14 + header.headerSize;
  const palette = new Uint8Array(count * 3);
  for (let index = 0; index < count && at + index * 4 + 2 < bytes.length; index += 1) {
    palette[index * 3] = bytes[at + index * 4 + 2];
    palette[index * 3 + 1] = bytes[at + index * 4 + 1];
    palette[index * 3 + 2] = bytes[at + index * 4];
  }
  return palette;
}

// RLE4／RLE8 を 1 画素 1 バイトのインデックス列へ。行末・画像末・移動に従う。
function decodeRle(bytes, header, indices) {
  const { width, height, bits } = header;
  const rowStart = (y) => (header.topDown ? y : height - 1 - y) * width;
  let at = header.offset;
  let x = 0;
  let y = 0;
  const put = (index) => {
    if (x < width && y < height)
      indices[rowStart(y) + x] = index;
    x += 1;
  };
  const nibble = (value, position) => ((position & 1) ? value & 15 : value >> 4);
  while (at + 1 < bytes.length && y < height) {
    const count = bytes[at];
    const value = bytes[at + 1];
    at += 2;
    if (count > 0) {
      for (let index = 0; index < count; index += 1)
        put(bits === 8 ? value : nibble(value, index));
      continue;
    }
    if (value === 0) { x = 0; y += 1; continue; }                                  // 行末
    if (value === 1) return;                                                       // 画像末
    if (value === 2) { x += bytes[at]; y += bytes[at + 1]; at += 2; continue; }    // 移動
    const packed = bits === 8 ? value : (value + 1) >> 1;                          // 絶対モード
    for (let index = 0; index < value; index += 1) {
      const byte = bytes[at + (bits === 8 ? index : index >> 1)];
      put(bits === 8 ? byte : nibble(byte, index));
    }
    at += packed + (packed & 1);                                                   // 2 バイト境界へ
  }
}

// パレットの画像。無圧縮は行の詰め物（4 バイト境界）を外してそのまま packed に、RLE は 8bit に。
function decodeIndexed(bytes, header) {
  const { width, height, bits, compression, topDown } = header;
  const palette = readPalette(bytes, header);
  if (compression !== BI_RGB) {
    const indices = new Uint8Array(width * height);
    decodeRle(bytes, header, indices);
    return { ok: true, width, height, colorSpace: 'indexed', bitsPerComponent: 8, palette, bytes: indices };
  }
  const stride = ((width * bits + 31) >> 5) << 2;
  const rowBytes = Math.ceil(width * bits / 8);
  if (header.offset + stride * height > bytes.length)
    return { error: BROKEN };
  const packed = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const from = header.offset + (topDown ? y : height - 1 - y) * stride;
    packed.set(bytes.subarray(from, from + rowBytes), y * rowBytes);
  }
  return { ok: true, width, height, colorSpace: 'indexed', bitsPerComponent: bits, palette, bytes: packed };
}

function maskScale(mask) {
  if (!mask)
    return null;
  const shift = 31 - Math.clz32(mask & -mask);
  return { shift, max: mask >>> shift };
}

function channel(value, scale) {
  return scale === null ? 0 : Math.round(((value >>> scale.shift) & scale.max) * 255 / scale.max);
}

// 16／24／32bit の 1 行を RGB へ。alpha があれば白で合成する（確定事項17）。
function unpackTrueColor(row, header, out, outAt) {
  const { width, bits, masks } = header;
  const scales = bits === 24 ? null : { r: maskScale(masks.r), g: maskScale(masks.g), b: maskScale(masks.b), a: maskScale(masks.a) };
  const view = new DataView(row.buffer, row.byteOffset, row.byteLength);
  for (let x = 0; x < width; x += 1) {
    let r, g, b;
    let a = 255;
    if (bits === 24) {
      b = row[x * 3]; g = row[x * 3 + 1]; r = row[x * 3 + 2];
    } else {
      const value = bits === 16 ? view.getUint16(x * 2, true) : view.getUint32(x * 4, true);
      r = channel(value, scales.r); g = channel(value, scales.g); b = channel(value, scales.b);
      if (scales.a !== null) a = channel(value, scales.a);
    }
    const o = outAt + x * 3;
    out[o] = (r * a + 255 * (255 - a) + 127) / 255 | 0;
    out[o + 1] = (g * a + 255 * (255 - a) + 127) / 255 | 0;
    out[o + 2] = (b * a + 255 * (255 - a) + 127) / 255 | 0;
  }
}

function decodeTrueColor(bytes, header) {
  const { width, height, bits, topDown } = header;
  const stride = ((width * bits + 31) >> 5) << 2;
  if (header.offset + stride * height > bytes.length)
    return { error: BROKEN };
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const from = header.offset + (topDown ? y : height - 1 - y) * stride;
    unpackTrueColor(bytes.subarray(from, from + stride), header, rgb, y * width * 3);
  }
  return { ok: true, width, height, colorSpace: 'rgb', bitsPerComponent: 8, bytes: rgb };
}

function decodeBmp(bytes) {
  const header = readHeader(bytes);
  if (header.error !== undefined)
    return header;
  if (!(header.width > 0) || !(header.height > 0))
    return { error: SIZE_UNREADABLE };
  if (unsupported(header))
    return { error: UNSUPPORTED };
  return header.bits <= 8 ? decodeIndexed(bytes, header) : decodeTrueColor(bytes, header);
}

module.exports = { decodeBmp, readHeader };
