'use strict';

// 画像を紙に載せる層。差し込み（spec-1-6 確定事項57〜62）と変換（spec-3-1 確定事項12・16）が
// 同じ関数を通る。「見えているもの」と「保存されるもの」、差し込んだ絵と変換した絵が
// 食い違わないためである。op-insert.js から切り出した（あちらは 250 行を超えていた）。
//
// 【画素の寸法をそのまま紙にしない】（確定事項59）
// 1pt = 1/72 インチなので、スマホ写真 4032×3024 は 1422×1067mm（A4 の6.8倍幅）に
// なる。64×64 のアイコンは 23×23mm。必ず桁の違う紙が混ざるので、**箱へ内接**させる。
//
// 【拡大の可否】
// 差し込みは拡大を 100% で止める（確定事項61。64×64 を A4 いっぱいへ引き伸ばすと
// 実効 8dpi のボケた絵になる）。変換は「用紙に合わせる」意図に従い、余白の内側へ
// 縦横比を保って最大化する（spec-3-1 ユーザー確定④）。既定は従来どおり拡大しない。
//
// 【白い紙を敷く】（確定事項62）
// PDF の新規ページには下地が無い。透過 PNG の `/SMask` は正しく保たれるが、
// 敷かないとビューアの背景色や印刷の下地がそのまま透ける。ページ全体を白で塗ってから載せる。
//
// 【pdf-lib が埋め込めない形式】（spec-3-2 確定事項19）
// BMP・GIF・TIFF は image-decode.js で画素へ展開し、pixel-image.js で /XObject にする。
// 複数ページの TIFF は `frame` でページを選ぶ。PNG・JPEG は従来どおり pdf-lib に渡す。

const { imageSize, MAX_PIXELS } = require('./image-format.js');
const { decodeImage } = require('./image-decode.js');
const { embedPixels } = require('./pixel-image.js');

const PDF_LIB_KINDS = new Set(['png', 'jpeg']);

// 箱に内接させる。allowUpscale が偽なら拡大はしない。
function fitInside(image, box, { allowUpscale = false } = {}) {
  if (!(image?.width > 0) || !(image?.height > 0))
    return null;
  const ratio = Math.min(box.width / image.width, box.height / image.height);
  const scale = allowUpscale ? ratio : Math.min(ratio, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  return { width, height, x: (box.width - width) / 2, y: (box.height - height) / 2 };
}

// pdf-lib に任せる形式（PNG・JPEG）。
async function embedWithPdfLib(doc, kind, bytes) {
  try {
    return { ok: true, image: kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes) };
  } catch (error) {
    // embedPng は素の文字列を、embedJpg は Error を投げる（実測 H）。
    // message で分岐してはいけないので、型を選ばずに握って文言を差し替える。
    return { error: '画像を読み込めませんでした。ファイルが壊れている可能性があります。' };
  }
}

// 自分で画素へ展開する形式（BMP・GIF・TIFF）。tools に PDFImage・PngEmbedder・PDFName・PDFHexString が要る。
async function embedDecoded(doc, kind, bytes, frame, tools) {
  if (typeof tools?.PDFImage?.of !== 'function' || typeof tools?.PngEmbedder !== 'function')
    return { error: '画像を埋め込む道具が揃っていません。' };
  const decoded = decodeImage(kind, bytes, { frame });
  if (decoded.ok !== true)
    return { error: decoded.error };
  return embedPixels(doc, decoded.pixels, tools);
}

// 埋め込む。寸法と画素上限は**埋め込む前**に読む（確定事項58。pdf-lib は PNG を
// RGBA へ完全展開するので、断る前に払わされてはいけない）。
async function embedImage(doc, { kind, bytes }, tools = {}, { frame = 0 } = {}) {
  const pixels = imageSize(kind, bytes, { frame });
  if (pixels === null || !(pixels.width > 0) || !(pixels.height > 0))
    return { error: '画像の大きさを読み取れませんでした。' };      // 0画素も含む（確定事項57）
  if (pixels.width * pixels.height > MAX_PIXELS)
    return { error: '画像が大きすぎます。' };

  const embedded = PDF_LIB_KINDS.has(kind)
    ? await embedWithPdfLib(doc, kind, bytes)
    : await embedDecoded(doc, kind, bytes, frame, tools);
  if (embedded.ok !== true)
    return embedded;
  if (!(embedded.image.width > 0) || !(embedded.image.height > 0))
    return { error: '画像の大きさを読み取れませんでした。' };
  return embedded;
}

// 埋め込んだ絵を、紙（page）の中の箱（box。紙の左下が原点）へ載せた新しいページを作る。
function drawImagePage(doc, image, { page: size, box, allowUpscale = false }, { PDFPage, rgb }) {
  const placed = fitInside(image, box, { allowUpscale });
  if (placed === null)
    return { error: '画像の大きさを読み取れませんでした。' };
  const page = PDFPage.create(doc);
  page.setSize(size.width, size.height);
  page.drawRectangle({ x: 0, y: 0, width: size.width, height: size.height, color: rgb(1, 1, 1) });
  page.drawImage(image, { ...placed, x: box.x + placed.x, y: box.y + placed.y });
  return { ok: true, page };
}

// 1枚の画像を、箱と同じ大きさの紙の真ん中へ載せる（差し込み。拡大しない）。
async function placeImage(doc, loaded, box, tools, { frame = 0 } = {}) {
  const embedded = await embedImage(doc, loaded, tools, { frame });
  if (embedded.ok !== true)
    return embedded;
  return drawImagePage(doc, embedded.image, { page: box, box: { x: 0, y: 0, ...box } }, tools);
}

module.exports = { fitInside, embedImage, drawImagePage, placeImage };
