'use strict';

// TIFF を画素列へ展開する（spec-3-2 確定事項12・13）。伸長は vendor/utif.js に任せ、
// IFD 読みと色の解釈は自分で行う。
//
// utif は **伸長器としてだけ**使う。`UTIF.decode`（IFD 読み）は輪のある鎖で落ちるので
// tiff-directory.js の object を `UTIF.decodeImage(buffer, ifd)` へ渡す。`toRGBA8` も
// 4bit パレットなどを誤るので使わず、伸長後の `img.data`（ファイルに格納されたままの packed）
// を Photometric・bps・SamplesPerPixel で解釈して PDF の色空間へそのまま渡す（事前調査 A）。
//
// utif は最初に使うときに1回だけ読む（起動時の負担を増やさない）。

const path = require('node:path');
const zlib = require('node:zlib');

const { loadCommonJs } = require('./vendor-loader.js');
const { readTiffDirectory, checkTiffSupport } = require('./tiff-directory.js');

const BROKEN = '画像を読み込めませんでした。ファイルが壊れている可能性があります。';
const NO_SUCH_PAGE = '差し込む画像にそのページがありません。';

let utif = null;

function loadUtif() {
  if (utif === null) {
    const inflate = (source) => new Uint8Array(zlib.inflateSync(source));
    utif = loadCommonJs(path.join(__dirname, '..', 'vendor', 'utif.js'), { overrides: { pako: { inflate } } });
  }
  return utif;
}

// utif は ArrayBuffer を受け、Uint8Array を渡すと複製する。複製せずに済む形で渡す。
function arrayBufferOf(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
    return bytes.buffer;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

// FillOrder 2（各バイトの下位ビットが左の画素）。CCITT 以外では utif が反転しないので自分で。
const REVERSED_BITS = Uint8Array.from({ length: 256 }, (_, value) => {
  let out = 0;
  for (let bit = 0; bit < 8; bit += 1)
    out |= ((value >> bit) & 1) << (7 - bit);
  return out;
});

function reverseBits(data) {
  const out = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1)
    out[index] = REVERSED_BITS[data[index]];
  return out;
}

// 16bit の各サンプルを上位バイトに落とす。utif は MM でもリトルエンディアンへ揃える。
function highBytes(data) {
  const out = new Uint8Array(data.length >> 1);
  for (let index = 0; index < out.length; index += 1)
    out[index] = data[index * 2 + 1];
  return out;
}

// RGBA を白で合成して RGB に（確定事項12・17）。extra 1 は乗算済み、2 は未乗算、0 は捨てる。
function flattenAlpha(data, count, extra) {
  const rgb = new Uint8Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const from = index * 4;
    const to = index * 3;
    const alpha = extra === 0 ? 255 : data[from + 3];
    for (let channel = 0; channel < 3; channel += 1) {
      const value = data[from + channel];
      rgb[to + channel] = extra === 1
        ? Math.min(255, value + 255 - alpha)
        : (value * alpha + 255 * (255 - alpha) + 127) / 255 | 0;
    }
  }
  return rgb;
}

// ColorMap は [赤×N, 緑×N, 青×N] の 16bit。RGB 並びの 8bit に直す。
function paletteOf(colorMap, bits) {
  const count = 1 << bits;
  const palette = new Uint8Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    palette[index * 3] = (colorMap[index] ?? 0) >> 8;
    palette[index * 3 + 1] = (colorMap[count + index] ?? 0) >> 8;
    palette[index * 3 + 2] = (colorMap[count * 2 + index] ?? 0) >> 8;
  }
  return palette;
}

// 伸長した img.data を pixels（確定事項8）に読み替える。
function interpret(img) {
  const bits = img.t258?.[0] ?? 1;
  const samples = img.t277?.[0] ?? (img.t258?.length ?? 1);
  const photometric = img.t262?.[0] ?? (samples >= 3 ? 2 : 1);
  const { width, height } = img;
  const base = { ok: true, width, height };
  const data = img.data;
  if (data.length < Math.ceil(width * samples * bits / 8) * height)
    return { error: BROKEN };
  const eightBit = bits === 16 ? highBytes(data) : data;

  if (photometric === 0 || photometric === 1)
    return { ...base, colorSpace: 'gray', bitsPerComponent: bits === 16 ? 8 : bits, bytes: eightBit, inverted: photometric === 0 };
  if (photometric === 3)
    return { ...base, colorSpace: 'indexed', bitsPerComponent: bits, palette: paletteOf(img.t320, bits), bytes: data };
  if (photometric === 5)
    return { ...base, colorSpace: 'cmyk', bitsPerComponent: 8, bytes: data };
  if (photometric === 2) {
    const bytes = samples === 4 ? flattenAlpha(eightBit, width * height, img.t338?.[0] ?? 0) : eightBit;
    return { ...base, colorSpace: 'rgb', bitsPerComponent: 8, bytes };
  }
  return { error: BROKEN };
}

function frameCountOf(bytes) {
  const read = readTiffDirectory(bytes);
  return read.ok === true ? read.pages.length : 0;
}

function decodeTiff(bytes, { frame = 0 } = {}) {
  const read = readTiffDirectory(bytes);
  if (read.ok !== true)
    return { error: read.error };
  const ifd = read.pages[frame];
  if (ifd === undefined)
    return { error: NO_SUCH_PAGE };
  const unsupported = checkTiffSupport(ifd);
  if (unsupported !== null)
    return { error: unsupported };

  // utif は渡した object に width・height・data を足し、JPEG では t262 を書き換える。控えを渡す。
  const img = { ...ifd };
  if (img.t259?.[0] === 32946)
    img.t259 = [8];                                // Deflate の旧番号は同じ伸長器で読める
  try {
    loadUtif().decodeImage(arrayBufferOf(bytes), img);
  } catch (error) {
    return { error: BROKEN };
  }
  if (!(img.data instanceof Uint8Array) || !(img.width > 0) || !(img.height > 0))
    return { error: BROKEN };
  const compression = img.t259?.[0] ?? 1;
  if ((img.t266?.[0] ?? 1) === 2 && compression !== 3 && compression !== 4)
    img.data = reverseBits(img.data);
  return interpret(img);
}

module.exports = { decodeTiff, frameCountOf };
