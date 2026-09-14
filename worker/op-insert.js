'use strict';

// 差し込むページを組み立てる層（spec-1-6 確定事項53〜65）。
//
// plan には2種類の要素が入る。`{ src, rotate }`（元ファイルのページ）と
// `{ insert, rotate }`（差し込むページ）である。ここは後者を **pdf-lib の
// ページ実体へ**変え、`op-pages.js` がそれを並びへ置く。組み立てと配置を
// 分けてあるので、op-pages.js は pdf-lib に依存しないままでいられる。
//
// 画像を紙に載せる中身（内接・拡大の可否・白い紙。確定事項59〜62）は image-page.js に
// ある。変換（spec-3-1）も同じ関数を通るので、ここは「基準ページの大きさを決めて渡す」
// だけを受け持つ。

const { normalizeRotation, isInsert } = require('./op-pages.js');
const { MAX_PIXELS, detectFormat, isSupported, describeFormat, isProgressiveJpeg } = require('./image-format.js');
const { fitInside, placeImage } = require('./image-page.js');
const { frameCount } = require('./image-decode.js');
const { cleanInsertedPage } = require('./inserted-annotations.js');

const NO_SUCH_IMAGE_PAGE = '差し込む画像にそのページがありません。';

// 基準になるページが1枚も無いときの逃げ場。塊④ が最後の1枚を守るので
// 普通は起きないが、元ページを全部消して差し込みだけを残す道が塞がれていない。
const A4 = { width: 595.28, height: 841.89 };

// 見えている大きさ。90／270 度回っているページは幅と高さが入れ替わる（確定事項60）。
function effectiveSize(page, extraRotation = 0) {
  const { width, height } = page.getSize();
  const angle = normalizeRotation(page.getRotation().angle + normalizeRotation(extraRotation));
  return (angle === 90 || angle === 270) ? { width: height, height: width } : { width, height };
}

// 基準ページは**挿入位置の直前**、先頭へ挿すときは直後（確定事項60）。
// 差し込みが続いているときは、その先の元ページまで遡る。
function baseSizeFor(original, plan, at) {
  const sizeAt = (index) => {
    const entry = plan[index];
    if (entry === undefined || isInsert(entry) || !Number.isInteger(entry.src))
      return null;
    const page = original[entry.src];
    return page === undefined ? null : effectiveSize(page, entry.rotate);
  };

  for (let index = at - 1; index >= 0; index -= 1) {
    const size = sizeAt(index);
    if (size !== null)
      return size;
  }
  for (let index = at + 1; index < plan.length; index += 1) {
    const size = sizeAt(index);
    if (size !== null)
      return size;
  }
  return { ...A4 };
}

// PDF の1ページを複製して差し込む。大きさは元のまま（紙の大きさは中身である）。
async function copyPdfPage(doc, source, pageIndex, tools) {
  const index = Number.isInteger(pageIndex) ? pageIndex : 0;
  if (index < 0 || index >= source.getPageCount())
    return { error: '差し込む PDF にそのページがありません。' };

  const [page] = await doc.copyPages(source, [index]);
  cleanInsertedPage(page, tools);
  return { ok: true, page };
}

// 画像のページ数。複数ページを持つのは TIFF だけ（spec-3-2 確定事項24）。
function imageFrames(kind, bytes) {
  if (kind === 'png' || kind === 'jpeg')
    return 1;
  return frameCount(kind, bytes);
}

// 差し込む元を1回だけ読む。同じファイルの複数ページを差し込むことがある。
async function loadSource(path, cache, { readFile, PDFDocument }) {
  if (cache.has(path))
    return cache.get(path);

  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    cache.set(path, { error: '差し込むファイルを読めませんでした。' });
    return cache.get(path);
  }

  const kind = detectFormat(bytes);
  if (!isSupported(kind)) {
    cache.set(path, { error: describeFormat(kind) });
    return cache.get(path);
  }
  if (kind === 'jpeg' && isProgressiveJpeg(bytes)) {
    cache.set(path, { error: 'この JPEG は挿入できません（プログレッシブ形式）。' });
    return cache.get(path);
  }

  let loaded;
  if (kind === 'pdf') {
    try {
      loaded = { ok: true, kind, doc: await PDFDocument.load(bytes, { updateMetadata: false }) };
    } catch (error) {
      loaded = { error: '差し込む PDF を読めませんでした。内容が壊れているか、パスワードで保護されています。' };
    }
  } else {
    const frames = imageFrames(kind, bytes);
    loaded = frames === 0
      ? { error: '画像を読み込めませんでした。ファイルが壊れている可能性があります。' }
      : { ok: true, kind, bytes, frames };
  }
  cache.set(path, loaded);
  return loaded;
}

// 画像の frame 番目のページを紙に載せる。複数ページの TIFF は spec.page で選ぶ（spec-3-2 確定事項26）。
async function placeImagePage(doc, loaded, box, frame, tools) {
  const index = Number.isInteger(frame) ? frame : 0;
  if (index < 0 || index >= loaded.frames)
    return { error: NO_SUCH_IMAGE_PAGE };
  return placeImage(doc, loaded, box, tools, { frame: index });
}

// plan の `{ insert }` を、insert 番号で引ける pdf-lib のページの配列に変える。
// 差し込みが1つも無ければ何もしない（読み込みも起こさない）。
async function prepareInserts(doc, original, plan, inserts, tools, { readFile }) {
  const pages = [];
  if (!Array.isArray(plan))
    return { ok: true, pages };

  const cache = new Map();
  for (let at = 0; at < plan.length; at += 1) {
    const entry = plan[at];
    if (!isInsert(entry))
      continue;

    const spec = inserts?.[entry.insert];
    if (spec === undefined || typeof spec.path !== 'string')
      return { error: '差し込むページが見つかりません。もう一度やり直してください。' };

    const loaded = await loadSource(spec.path, cache, { readFile, PDFDocument: tools.PDFDocument });
    if (loaded.ok !== true)
      return loaded;

    // 紙の大きさは**挿入した時点**で決まっている（確定事項95）。控えが無いのは
    // 画面を通さずに組み立てたときだけなので、そのときだけここで決める。
    const made = loaded.kind === 'pdf'
      ? await copyPdfPage(doc, loaded.doc, spec.page, tools)
      : await placeImagePage(doc, loaded, spec.size ?? baseSizeFor(original, plan, at), spec.page, tools);
    if (made.ok !== true)
      return made;
    pages[entry.insert] = made.page;
  }
  return { ok: true, pages };
}

// 差し込む1ファイルを、そのまま1つの文書として組み立てる（確定事項93）。
//
// 画面へ出すためのものだが、**保存で使うのと同じ placeImage / copyPdfPage を
// 通る**。だから「見えているもの」と「保存されるもの」が食い違わない。
// PDF と複数ページの TIFF は持っているページぶん、ほかの画像は1ページになる（spec-3-2 確定事項25）。
async function buildPreview(path, base, tools, { readFile }) {
  const loaded = await loadSource(path, new Map(), { readFile, PDFDocument: tools.PDFDocument });
  if (loaded.ok !== true)
    return loaded;

  const doc = await tools.PDFDocument.create();
  const box = base ?? { ...A4 };
  const count = loaded.kind === 'pdf' ? loaded.doc.getPageCount() : loaded.frames;
  if (count === 0)
    return { error: '差し込む PDF にページがありません。' };

  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const made = loaded.kind === 'pdf'
      ? await copyPdfPage(doc, loaded.doc, index, tools)
      : await placeImagePage(doc, loaded, box, index, tools);
    if (made.ok !== true)
      return made;
    doc.addPage(made.page);
    sizes.push(made.page.getSize());
  }
  return { ok: true, doc, sizes, kind: loaded.kind };
}

module.exports = {
  MAX_PIXELS,
  A4,
  effectiveSize,
  baseSizeFor,
  fitInside,
  cleanInsertedPage,
  placeImage,
  copyPdfPage,
  buildPreview,
  prepareInserts,
};
