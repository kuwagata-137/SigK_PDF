'use strict';

// モザイクのページを画像 1 枚に差し替える（spec-4b-6b 確定事項20・21。決定64 ⑤⑥。事前調査 I）。
//
// レンダラーが描いた画像（紙全体〔MediaBox〕・回転 0・書き込みを描かない絵にモザイクを当てたもの。mosaic-save.js）を受け取り、そのページの
// /Contents を「box に画像 1 枚を置く」流れ 1 本に、/Resources をその画像だけに差し替える。ページの実体は残すので、/Annots（書き込み・
// リンク・フォーム）・/Rotate・/MediaBox・/CropBox・/UserUnit・しおりの飛び先はそのまま効く。元の文字が残り得るページの欄（/Thumb・
// /PieceInfo・/Metadata・/AF・/AA）を外し、構造ツリーからそのページの要素を外す（struct-tree-page.js）。ほかのページ・書き込みの外観が
// 元の /Resources を共有していても古い中身を辿れないよう、全ページの /Resources を使う名前だけに絞る（resource-narrow.js）。辿れなく
// なった古い中身は、保存の直前に orphan-objects.js が消す。
//
// 保存（save-apply.js の applyForSave）は applyPlan の前に呼ぶ。src は読んだ文書のページ番号で、並べ替えたあとでは指す先が変わるためである。
// pdf-lib は require しない（tools で受け取る）。

const { toBytes } = require('../file-io.js');
const { embedImage } = require('./image-page.js');
const { dropPageFromStructTree } = require('./struct-tree-page.js');
const { narrowResources } = require('./resource-narrow.js');

// 外すページの欄（事前調査 I。/AF〔関連ファイル〕・/AA〔ページを開いたときの動作〕はコードの点検で足した）。/StructParents は構造ツリーの
// 項を消したあとで外す。
const PAGE_KEYS = ['Thumb', 'PieceInfo', 'Metadata', 'AF', 'AA', 'StructParents'];
const IMAGE_NAME = 'SigKMosaic';
const KINDS = new Set(['png', 'jpeg']);

function isBox(box) {
  return Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1];
}

// 渡されたものが、この文書に当てられる形か。src の重なりも断る（同じページを 2 度描き替えない）。
function validateMosaics(mosaics, pageCount) {
  if (!Array.isArray(mosaics))
    return { error: 'モザイクのページの指定が正しくありません。' };
  const seen = new Set();
  for (const item of mosaics) {
    const valid = Number.isInteger(item?.src) && item.src >= 0 && item.src < pageCount && !seen.has(item.src)
      && KINDS.has(item.kind) && item.bytes instanceof Uint8Array && item.bytes.length > 0 && isBox(item.box);
    if (!valid)
      return { error: 'モザイクのページの指定が正しくありません。' };
    seen.add(item.src);
  }
  return { ok: true };
}

// plan（pages）でモザイクのあるページのうち、画像（mosaics）が来ていないものの src。画面側で画像にしている間に plan が変わったときの
// 保険で、1 つでもあれば保存を断る（元の中身のまま書かない。コードの点検で足した）。
function unpaintedSources(pages, mosaics) {
  const painted = new Set((Array.isArray(mosaics) ? mosaics : []).map((item) => item?.src));
  const list = Array.isArray(pages) ? pages : [];
  return list.filter((entry) => Number.isInteger(entry?.src) && Array.isArray(entry.mosaic) && entry.mosaic.length > 0 && !painted.has(entry.src))
    .map((entry) => entry.src);
}

// 小数 4 桁まで（流れに書く数）。
function num(value) {
  return String(Math.round(value * 10000) / 10000);
}

// 1 ページを差し替える。
async function replacePage(doc, page, item, tools) {
  const { PDFName, PDFNumber } = tools;
  const embedded = await embedImage(doc, { kind: item.kind, bytes: toBytes(item.bytes) }, tools);
  if (embedded.ok !== true)
    return { error: 'モザイクのページを画像にできませんでした。' };
  // すぐ埋め込み、展開した画素を手放す（pdf-lib は save() まで抱えるので、300dpi の A4 で 1 ページ 26MB ずつ溜まる）。
  if (typeof embedded.image.embed === 'function')
    await embedded.image.embed();
  const ctx = doc.context;
  const [x1, y1, x2, y2] = item.box;
  const content = ctx.flateStream(`q ${num(x2 - x1)} 0 0 ${num(y2 - y1)} ${num(x1)} ${num(y1)} cm /${IMAGE_NAME} Do Q`);
  page.node.set(PDFName.of('Contents'), ctx.register(content));
  page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { [IMAGE_NAME]: embedded.image.ref } }));
  const structParents = page.node.lookup(PDFName.of('StructParents'));
  dropPageFromStructTree(doc, page.ref, structParents instanceof PDFNumber ? structParents.asNumber() : undefined, tools);
  for (const key of PAGE_KEYS)
    page.node.delete(PDFName.of(key));
  return { ok: true };
}

// mosaics（[{ src, kind, bytes, box }]）を当てる。無ければ何もしない。{ ok, count } か { error } を返す。
// tools は pdf-io.js の TOOLS。
async function applyMosaics(doc, mosaics, tools) {
  if (mosaics === undefined || mosaics === null || (Array.isArray(mosaics) && mosaics.length === 0))
    return { ok: true, count: 0 };
  const pages = doc.getPages();
  const check = validateMosaics(mosaics, pages.length);
  if (check.ok !== true)
    return check;
  for (const item of mosaics) {
    const replaced = await replacePage(doc, pages[item.src], item, tools);
    if (replaced.ok !== true)
      return replaced;
  }
  narrowResources(doc, new Set(mosaics.map((item) => pages[item.src].ref.toString())), tools);
  return { ok: true, count: mosaics.length };
}

module.exports = { IMAGE_NAME, validateMosaics, unpaintedSources, applyMosaics };
