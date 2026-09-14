'use strict';

// ディスクに置く BMP／GIF／TIFF の検体（spec-3-2「fixture」）。build.js から呼ばれる。
//
// PNG と同じく、バイナリはリポジトリに置かず毎回作る（.gitignore の *.bmp／*.gif／*.tif）。
// 起動確認（SIGK_SMOKE_CONVERT）と pdf-task の通しテストが使う。中身は「見て分かる」絵にする。

const fs = require('node:fs');
const path = require('node:path');

const { makeBmp, rgbaGradient } = require('./bmp.js');
const { makeGif } = require('./gif.js');
const { makeTiff } = require('./tiff.js');
const { G4_TIFF, triangleBits } = require('./ccitt.js');

const OUTPUT_DIR = __dirname;

// 640×480・24bit・下から（Windows の「ペイント」が書く形）
function rgbBmp() {
  return makeBmp({ width: 640, height: 480, bits: 24, pixels: rgbaGradient(640, 480) });
}

// 320×200・16色・index 0 を透過にした市松（透過に白い紙が敷かれることを見る）
function paletteGif() {
  const width = 320;
  const height = 200;
  const palette = Array.from({ length: 16 }, (_, i) => (i * 17 << 16) | ((255 - i * 17) << 8) | 0x80);
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      indices[y * width + x] = ((x >> 5) + (y >> 5)) % 2 === 0 ? 0 : 1 + ((x >> 4) % 15);
  return makeGif({ width, height, palette, indices, transparent: 0 });
}

// 3ページ。大きさも色の形式も圧縮もページごとに違う。
function pagesTiff() {
  const rgba = rgbaGradient(640, 480);
  const rgb = new Uint8Array(640 * 480 * 3);
  for (let i = 0; i < 640 * 480; i += 1) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
  const gray = new Uint8Array(320 * 240);
  for (let y = 0; y < 240; y += 1)
    for (let x = 0; x < 320; x += 1)
      gray[y * 320 + x] = ((x >> 4) + (y >> 4)) % 2 === 0 ? 40 : 220;
  return makeTiff([
    { width: 640, height: 480, bitsPerSample: [8, 8, 8], photometric: 2, compression: 5, rowsPerStrip: 64, pixels: rgb },
    { width: 320, height: 240, bitsPerSample: [8], photometric: 1, compression: 32773, rowsPerStrip: 40, pixels: gray },
    { width: 64, height: 48, bitsPerSample: [1], photometric: 0, compression: 1, pixels: triangleBits(64, 48) },
  ]);
}

const FORMAT_IMAGES = [
  { file: 'image-rgb.bmp', make: rgbBmp },            // 変換・差し込み・起動確認
  { file: 'image-palette.gif', make: paletteGif },    // 透過に白地
  { file: 'image-pages.tif', make: pagesTiff },       // 複数ページ・ページごとの紙・画像ごと
  { file: 'image-fax.tif', make: () => G4_TIFF },     // CCITT G4・1bit のまま埋め込み
];

function buildFormatImages() {
  return FORMAT_IMAGES.map(({ file, make }) => {
    const bytes = make();
    fs.writeFileSync(path.join(OUTPUT_DIR, file), bytes);
    return { file, bytes: bytes.length };
  });
}

module.exports = { FORMAT_IMAGES, buildFormatImages };
