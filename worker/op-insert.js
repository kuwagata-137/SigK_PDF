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

// 差し込んだページに付いてくるものを落とす（確定事項63）。
//
// `/Widget` は挿入元の AcroForm と切り離されて運ばれ、機能しない入力欄の抜け殻に
// なる。内部リンク（`/Dest` を持つもの・`/GoTo` するもの）は飛び先がページ木の外を
// 指したままで、**飛び先ページも一緒に差し込んでも直らない**（実測 H）。
// 外部リンク（`/URI`・`/GoToR`）は壊れていないので残す。
function cleanInsertedPage(page, { PDFName }) {
  const context = page.doc.context;
  const annots = context.lookup(page.node.get(PDFName.of('Annots')));
  if (annots === undefined || annots === null || typeof annots.asArray !== 'function')
    return 0;

  const kept = [];
  let dropped = 0;
  for (const ref of annots.asArray()) {
    const annot = context.lookup(ref);
    const subtype = annot?.get?.(PDFName.of('Subtype'))?.asString?.();
    const action = context.lookup(annot?.get?.(PDFName.of('A')));
    const isInternalLink = subtype === '/Link'
      && (annot?.get?.(PDFName.of('Dest')) !== undefined
        || action?.get?.(PDFName.of('S'))?.asString?.() === '/GoTo');
    if (subtype === '/Widget' || isInternalLink) {
      dropped += 1;
      continue;
    }
    kept.push(ref);
  }

  if (dropped > 0)
    page.node.set(PDFName.of('Annots'), context.obj(kept));
  return dropped;
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

  let loaded = { ok: true, kind, bytes };
  if (kind === 'pdf') {
    try {
      loaded = { ok: true, kind, doc: await PDFDocument.load(bytes, { updateMetadata: false }) };
    } catch (error) {
      loaded = { error: '差し込む PDF を読めませんでした。内容が壊れているか、パスワードで保護されています。' };
    }
  }
  cache.set(path, loaded);
  return loaded;
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
      : await placeImage(doc, loaded, spec.size ?? baseSizeFor(original, plan, at), tools);
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
// 画像は1ページ、PDF は持っているページぶんになる。
async function buildPreview(path, base, tools, { readFile }) {
  const loaded = await loadSource(path, new Map(), { readFile, PDFDocument: tools.PDFDocument });
  if (loaded.ok !== true)
    return loaded;

  const doc = await tools.PDFDocument.create();
  const box = base ?? { ...A4 };
  const count = loaded.kind === 'pdf' ? loaded.doc.getPageCount() : 1;
  if (count === 0)
    return { error: '差し込む PDF にページがありません。' };

  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const made = loaded.kind === 'pdf'
      ? await copyPdfPage(doc, loaded.doc, index, tools)
      : await placeImage(doc, loaded, box, tools);
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
