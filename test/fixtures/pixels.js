'use strict';

// デコーダーの戻り（spec-3-2 確定事項8 の pixels）を RGB の3バイト並びへ展開する。
// テストが期待値と突き合わせるための道具で、製品コードは使わない。

function samplesPerPixel(colorSpace) {
  return { gray: 1, indexed: 1, rgb: 3, cmyk: 4 }[colorSpace];
}

// packed の行から x 番目のサンプル値を取り出す（bpc 1／2／4／8）。
function sampleAt(row, index, bits) {
  if (bits === 8)
    return row[index];
  const perByte = 8 / bits;
  const byte = row[Math.floor(index / perByte)];
  const shift = 8 - bits * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << bits) - 1);
}

function toRgb(pixels) {
  const { width, height, colorSpace, bitsPerComponent: bits, bytes } = pixels;
  const samples = samplesPerPixel(colorSpace);
  const rowBytes = Math.ceil(width * samples * bits / 8);
  const out = new Uint8Array(width * height * 3);
  const max = (1 << bits) - 1;
  for (let y = 0; y < height; y += 1) {
    const row = bytes.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 3;
      if (colorSpace === 'rgb') {
        out[o] = row[x * 3]; out[o + 1] = row[x * 3 + 1]; out[o + 2] = row[x * 3 + 2];
      } else if (colorSpace === 'cmyk') {
        const [c, m, yy, k] = [row[x * 4], row[x * 4 + 1], row[x * 4 + 2], row[x * 4 + 3]];
        out[o] = 255 - Math.min(255, c + k); out[o + 1] = 255 - Math.min(255, m + k); out[o + 2] = 255 - Math.min(255, yy + k);
      } else if (colorSpace === 'indexed') {
        const index = sampleAt(row, x, bits) * 3;
        out[o] = pixels.palette[index]; out[o + 1] = pixels.palette[index + 1]; out[o + 2] = pixels.palette[index + 2];
      } else {
        let value = Math.round(sampleAt(row, x, bits) * 255 / max);
        if (pixels.inverted === true)
          value = 255 - value;
        out[o] = value; out[o + 1] = value; out[o + 2] = value;
      }
    }
  }
  return out;
}

function rgbOf(rgba) {
  const out = new Uint8Array(rgba.length / 4 * 3);
  for (let i = 0; i < rgba.length / 4; i += 1) {
    out[i * 3] = rgba[i * 4]; out[i * 3 + 1] = rgba[i * 4 + 1]; out[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return out;
}

// 2つの RGB 列の最大差。0 なら一致。
function maxDifference(a, b) {
  if (a.length !== b.length)
    return Infinity;
  let max = 0;
  for (let i = 0; i < a.length; i += 1)
    max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

function pixelAt(rgb, width, x, y) {
  const i = (y * width + x) * 3;
  return [rgb[i], rgb[i + 1], rgb[i + 2]];
}

module.exports = { toRgb, rgbOf, maxDifference, pixelAt, sampleAt };
