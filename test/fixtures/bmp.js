'use strict';

// テストに使う BMP をその場で組み立てる（spec-3-2 事前調査 C・F）。
//
// pixels は RGBA（幅×高さ×4）。bits は 1／4／8／16／24／32。8bit 以下は palette
// （[[r, g, b], …]）へ最も近い色のインデックスを書く。
//   topDown      … 高さを負にして上から並べる
//   headerSize   … 40（BITMAPINFOHEADER）／108（V4）／124（V5）
//   compression  … 0 BI_RGB／1 RLE8／2 RLE4／3 BITFIELDS
//   masks        … BITFIELDS のときの { r, g, b, a }
//   gap          … パレットと画素の間の余白（bfOffBits を尊重するかを見る）

function rowStride(width, bits) {
  return Math.floor((width * bits + 31) / 32) * 4;
}

function nearestIndex(palette, r, g, b) {
  let best = 0;
  let bestDistance = Infinity;
  palette.forEach(([pr, pg, pb], index) => {
    const distance = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  });
  return best;
}

// マスクの位置と幅に合わせて 8bit の値を詰める。
function packMasked(masks, r, g, b, a) {
  const put = (mask, value) => {
    if (!mask)
      return 0;
    const shift = 31 - Math.clz32(mask & -mask);
    const width = 32 - Math.clz32(mask >>> shift);
    return ((value >> (8 - width)) << shift) >>> 0;
  };
  return (put(masks.r, r) | put(masks.g, g) | put(masks.b, b) | put(masks.a, a)) >>> 0;
}

function indexRows(page) {
  const { width, height, pixels, palette } = page;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      row.push(nearestIndex(palette, pixels[i], pixels[i + 1], pixels[i + 2]));
    }
    rows.push(row);
  }
  return rows;
}

// 1 行を packed にする（上から順。上下の並べ替えは呼ぶ側）。
function packRow(page, y, out) {
  const { width, bits, pixels, masks } = page;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    if (bits === 24) { out[x * 3] = b; out[x * 3 + 1] = g; out[x * 3 + 2] = r; }
    else if (bits === 32 && masks) view.setUint32(x * 4, packMasked(masks, r, g, b, a), true);
    else if (bits === 32) { out[x * 4] = b; out[x * 4 + 1] = g; out[x * 4 + 2] = r; out[x * 4 + 3] = 0; }
    else if (bits === 16) view.setUint16(x * 2, packMasked(masks ?? { r: 0x7c00, g: 0x03e0, b: 0x001f, a: 0 }, r, g, b, a), true);
    else {
      const index = nearestIndex(page.palette, r, g, b);
      if (bits === 8) out[x] = index;
      else if (bits === 4) out[x >> 1] |= (x & 1) ? index : index << 4;
      else out[x >> 3] |= index << (7 - (x & 7));
    }
  }
}

// RLE8／RLE4。連続は「連続モード」、それ以外は「絶対モード」で書く。行末 00 00、画像末 00 01。
function rleEncode(rows, bits) {
  const out = [];
  const nibbles = (a, b) => ((a << 4) | (b ?? 0)) & 0xff;
  for (const row of rows) {
    let x = 0;
    while (x < row.length) {
      let run = 1;
      while (x + run < row.length && row[x + run] === row[x] && run < 255)
        run += 1;
      if (run >= 3) {
        out.push(run, bits === 8 ? row[x] : nibbles(row[x], row[x]));
        x += run;
        continue;
      }
      let n = 0;
      while (x + n < row.length && n < 255 && !(x + n + 2 < row.length && row[x + n] === row[x + n + 1] && row[x + n] === row[x + n + 2]))
        n += 1;
      if (n < 3) {
        for (let k = 0; k < n; k += 1)
          out.push(1, bits === 8 ? row[x + k] : nibbles(row[x + k], 0));
        x += n;
        continue;
      }
      out.push(0, n);
      const bytes = [];
      for (let k = 0; k < n; k += bits === 8 ? 1 : 2)
        bytes.push(bits === 8 ? row[x + k] : nibbles(row[x + k], k + 1 < n ? row[x + k + 1] : 0));
      out.push(...bytes);
      if (bytes.length % 2 === 1)
        out.push(0);
      x += n;
    }
    out.push(0, 0);
  }
  out.push(0, 1);
  return Uint8Array.from(out);
}

function pixelBody(page) {
  const { width, height, bits, compression, topDown } = page;
  if (compression === 1 || compression === 2) {
    const rows = indexRows(page);
    return rleEncode(topDown ? rows : rows.reverse(), bits);
  }
  const stride = rowStride(width, bits);
  const body = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const source = topDown ? y : height - 1 - y;
    packRow(page, source, body.subarray(y * stride, (y + 1) * stride));
  }
  return body;
}

function makeBmp({ width, height, bits = 24, pixels, palette = null, topDown = false, headerSize = 40, compression = 0, masks = null, gap = 0 }) {
  const page = { width, height, bits, pixels, palette, topDown, compression, masks };
  const paletteLength = bits <= 8 ? palette.length : 0;
  const maskBytes = compression === 3 && headerSize === 40 ? (masks.a ? 16 : 12) : 0;
  const offset = 14 + headerSize + maskBytes + paletteLength * 4 + gap;
  const body = pixelBody(page);
  const file = new Uint8Array(offset + body.length);
  const view = new DataView(file.buffer);
  file[0] = 0x42; file[1] = 0x4d;                          // "BM"
  view.setUint32(2, file.length, true);
  view.setUint32(10, offset, true);
  view.setUint32(14, headerSize, true);
  view.setInt32(18, width, true);
  view.setInt32(22, topDown ? -height : height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, bits, true);
  view.setUint32(30, compression, true);
  view.setUint32(34, body.length, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  view.setUint32(46, paletteLength, true);
  if (compression === 3) {
    view.setUint32(54, masks.r, true); view.setUint32(58, masks.g, true); view.setUint32(62, masks.b, true);
    if (headerSize >= 56 || masks.a) view.setUint32(66, masks.a ?? 0, true);
  }
  if (headerSize >= 108)
    view.setUint32(70, 0x73524742, true);                  // LCS_sRGB
  const paletteAt = 14 + headerSize + maskBytes;
  for (let i = 0; i < paletteLength; i += 1) {
    const [r, g, b] = palette[i];
    file[paletteAt + i * 4] = b; file[paletteAt + i * 4 + 1] = g; file[paletteAt + i * 4 + 2] = r;
  }
  file.set(body, offset);
  return Buffer.from(file);
}

// 画素の作り方をテストで揃えるための小さな道具。
function rgbaGradient(width, height) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      pixels[i] = (x * 255 / Math.max(1, width - 1)) | 0;
      pixels[i + 1] = (y * 255 / Math.max(1, height - 1)) | 0;
      pixels[i + 2] = 255 - pixels[i];
      pixels[i + 3] = 255;
    }
  return pixels;
}

module.exports = { rowStride, makeBmp, rgbaGradient };
