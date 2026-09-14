'use strict';

// 差し込む・変換するファイルの形式を先頭バイトで見分ける層（spec-1-6 確定事項53〜56、
// spec-3-2 確定事項1〜3・6）。
//
// **拡張子は見ない。**中身と食い違っていることがあるうえ、pdf-lib の埋め込みは
// 形式が違うと投げ方が揃わない（`embedPng` は**素の文字列**を、`embedJpg` は
// `Error` を投げる。実測 H）。**そもそも投げさせない**ために、渡す前にここで断る。
//
// 既定拒否にしてあるので、WebP・HEIC・BigTIFF なども自動的に落ちる。
// BMP・GIF・TIFF は塊⑤（spec-3-2）で受けるようになった。pdf-lib が埋め込めるのは
// PNG・JPEG だけなので、3形式はワーカーが画素へ展開する（image-decode.js）。
//
// pdf-lib にも fs にも依存しない。docs/07 第4章の「依存なしで回る層」である。

const { JPEG_PROGRESSIVE, jpegStartOfFrame, isProgressiveJpeg, jpegSize } = require('./jpeg-frame.js');
const { readTiffDirectory, tiffFrameSize, checkTiffSupport } = require('./tiff-directory.js');

const SIGNATURES = [
  { kind: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },                    // %PDF-
  { kind: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { kind: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { kind: 'gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },              // GIF87a
  { kind: 'gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },              // GIF89a
  { kind: 'bmp', bytes: [0x42, 0x4d] },                                      // BM
  { kind: 'tiff', bytes: [0x49, 0x49, 0x2a, 0x00] },                         // II*\0（リトルエンディアン）
  { kind: 'tiff', bytes: [0x4d, 0x4d, 0x00, 0x2a] },                         // MM\0*（ビッグエンディアン）
];

// 差し込みが受けるもの（PDF を含む）。
const SUPPORTED = new Set(['pdf', 'png', 'jpeg', 'gif', 'bmp', 'tiff']);
// 画像として載せられるもの（spec-3-1 確定事項1・spec-3-2 確定事項1）。
const IMAGE_KINDS = new Set(['png', 'jpeg', 'gif', 'bmp', 'tiff']);

// 画素数の上限（spec-1-6 確定事項58）。約 8000×5000。pdf-lib は PNG を RGBA へ完全展開する。
// 2値の TIFF はワーカーでは軽いが、pdf.js が描くときに RGBA へ展開するので共通のまま
// （spec-3-2 確定事項7）。
const MAX_PIXELS = 40 * 1000 * 1000;

const IMAGE_CHOICES = 'PNG・JPEG・BMP・GIF・TIFF';
const SIZE_UNREADABLE = '画像の大きさを読み取れませんでした。';

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

// 差し込みで断る理由（確定事項54・spec-3-2 確定事項2）。何を選び直せばよいかを伝える。
function describeFormat() {
  return `対応していない形式です。${IMAGE_CHOICES}・PDF を選んでください。`;
}

// 変換で断る理由（spec-3-1 確定事項1）。差し込みの describeFormat と違い PDF を受けない。
function describeImageFormat(kind) {
  if (kind === 'pdf')
    return `PDF は画像ではありません。${IMAGE_CHOICES} を選んでください。`;
  return `対応していない形式です。${IMAGE_CHOICES} を選んでください。`;
}

function readUint32BE(bytes, at) {
  return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
}

function readUint16LE(bytes, at) {
  return bytes[at] | (bytes[at + 1] << 8);
}

function readInt32LE(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) | 0;
}

// 画素の寸法を、埋め込む**前**に読む（確定事項58）。
//
// pdf-lib は PNG を一度 RGBA へ完全展開するので、4032×3024 で rss が +50MB 増える
// （実測 H）。埋め込んでから測ったのでは、断る前に払わされてしまう。
//
//   PNG  … 署名8 ＋ 長さ4 ＋ "IHDR"4 のあとに幅・高さ（各4バイト・ビッグエンディアン）
//   JPEG … SOF セグメントの `FF Cx LL LL P HH HH WW WW`
//   GIF  … Logical Screen Descriptor（6〜9 バイト目・リトルエンディアン）
//   BMP  … BITMAPINFOHEADER の幅・高さ（18〜25 バイト目。高さは負なら上から並ぶ）
//   TIFF … frame 番目のページの IFD（256・257）
// 読み取れなければ null を返す（呼び出し側が「壊れている」として扱う）。
function imageSize(kind, bytes, { frame = 0 } = {}) {
  if (kind === 'png')
    return bytes.length < 24 ? null : { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
  if (kind === 'jpeg')
    return jpegSize(bytes);
  if (kind === 'gif')
    return bytes.length < 10 ? null : { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) };
  if (kind === 'bmp')
    return bytes.length < 26 ? null : { width: readInt32LE(bytes, 18), height: Math.abs(readInt32LE(bytes, 22)) };
  if (kind === 'tiff') {
    const read = readTiffDirectory(bytes);
    return read.ok === true && read.pages[frame] !== undefined ? tiffFrameSize(read.pages[frame]) : null;
  }
  return null;
}

// TIFF は全ページを見る（spec-3-2 確定事項6）。1ページでも対応外なら断る。
function inspectTiffFrames(bytes) {
  const read = readTiffDirectory(bytes);
  if (read.ok !== true)
    return { error: read.error, incomplete: read.incomplete === true };
  for (const page of read.pages) {
    const unsupported = checkTiffSupport(page);
    if (unsupported !== null)
      return { error: unsupported };
  }
  return { frames: read.pages.map(tiffFrameSize) };
}

// 画像として載せられるかを1本で判定する（spec-3-1 確定事項4・17、spec-3-2 確定事項6）。
// 形式 → プログレッシブ → 寸法 → 画素上限の順で、埋め込む前に断れるものはすべてここで断る。
// 画面（image-io.js が先頭バイトを渡す）とワーカー（op-convert.js が全体を渡す）が同じ判定を通る。
// 戻りの `frames` はページごとの寸法（TIFF 以外は1つ）、`width`／`height` は先頭ページ。
function inspectImageBytes(bytes) {
  const kind = detectFormat(bytes);
  if (!IMAGE_KINDS.has(kind))
    return { error: describeImageFormat(kind), kind };
  if (kind === 'jpeg' && isProgressiveJpeg(bytes))
    return { error: 'この JPEG は変換できません（プログレッシブ形式）。', kind };

  let frames;
  if (kind === 'tiff') {
    const inspected = inspectTiffFrames(bytes);
    if (inspected.error !== undefined)
      return { error: inspected.error, kind, ...(inspected.incomplete ? { incomplete: true } : {}) };
    frames = inspected.frames;
  } else {
    const pixels = imageSize(kind, bytes);
    if (pixels === null)
      return { error: SIZE_UNREADABLE, kind, incomplete: true };
    frames = [pixels];
  }

  for (const frame of frames) {
    if (!(frame.width > 0) || !(frame.height > 0))
      return { error: SIZE_UNREADABLE, kind, incomplete: true };
    if (frame.width * frame.height > MAX_PIXELS)
      return { error: '画像が大きすぎます。', kind };
  }
  return { ok: true, kind, width: frames[0].width, height: frames[0].height, pages: frames.length, frames };
}

module.exports = {
  SIGNATURES,
  JPEG_PROGRESSIVE,
  IMAGE_KINDS,
  MAX_PIXELS,
  detectFormat,
  isSupported,
  describeFormat,
  describeImageFormat,
  jpegStartOfFrame,
  isProgressiveJpeg,
  imageSize,
  inspectImageBytes,
};
