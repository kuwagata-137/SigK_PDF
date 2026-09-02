'use strict';

// 差し込むページを組み立てる層（spec-1-6 確定事項53〜65）。
//
// plan には2種類の要素が入る。`{ src, rotate }`（元ファイルのページ）と
// `{ insert, rotate }`（差し込むページ）である。ここは後者を **pdf-lib の
// ページ実体へ**変え、`op-pages.js` がそれを並びへ置く。組み立てと配置を
// 分けてあるので、op-pages.js は pdf-lib に依存しないままでいられる。
//
// 【画素の寸法をそのまま紙にしない】（確定事項59）
// 1pt = 1/72 インチなので、スマホ写真 4032×3024 は 1422×1067mm（A4 の6.8倍幅）に
// なる。64×64 のアイコンは 23×23mm。必ず桁の違う紙が混ざるので、**基準ページへ
// 内接**させる。ただし拡大は 100% で止める（確定事項61。64×64 を A4 いっぱいへ
// 引き伸ばすと実効 8dpi のボケた絵になる）。
//
// 【白い紙を敷く】（確定事項62）
// PDF の新規ページには下地が無い。透過 PNG の `/SMask` は正しく保たれるが、
// 敷かないとビューアの背景色や印刷の下地がそのまま透ける。余白の部分も同じなので、
// ページ全体を白で塗ってから絵を載せる。

const { normalizeRotation, isInsert } = require('./op-pages.js');
const { detectFormat, isSupported, describeFormat, isProgressiveJpeg, imageSize } = require('./image-format.js');

// 確定事項58。約 8000×5000。pdf-lib は PNG を RGBA へ完全展開する。
const MAX_PIXELS = 40 * 1000 * 1000;

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

// 箱に内接させる。拡大はしない（確定事項61）。
function fitInside(image, box) {
  if (!(image?.width > 0) || !(image?.height > 0))
    return null;
  const scale = Math.min(box.width / image.width, box.height / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  return { width, height, x: (box.width - width) / 2, y: (box.height - height) / 2 };
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

// 1枚の画像を、基準ページと同じ大きさの紙の真ん中へ載せる。
async function placeImage(doc, { kind, bytes }, box, { PDFPage, rgb }) {
  const pixels = imageSize(kind, bytes);
  if (pixels === null || !(pixels.width > 0) || !(pixels.height > 0))
    return { error: '画像の大きさを読み取れませんでした。' };      // 0画素も含む（確定事項57）
  if (pixels.width * pixels.height > MAX_PIXELS)
    return { error: '画像が大きすぎます。' };

  let image;
  try {
    image = kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch (error) {
    // embedPng は素の文字列を、embedJpg は Error を投げる（実測 H）。
    // message で分岐してはいけないので、型を選ばずに握って文言を差し替える。
    return { error: '画像を読み込めませんでした。ファイルが壊れている可能性があります。' };
  }
  if (!(image.width > 0) || !(image.height > 0))
    return { error: '画像の大きさを読み取れませんでした。' };

  const placed = fitInside(image, box);
  const page = PDFPage.create(doc);
  page.setSize(box.width, box.height);
  page.drawRectangle({ x: 0, y: 0, width: box.width, height: box.height, color: rgb(1, 1, 1) });
  page.drawImage(image, placed);
  return { ok: true, page };
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
