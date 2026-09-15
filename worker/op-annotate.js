'use strict';

// テキストマークアップ注釈を /Annots へ書く・から外す層（spec-4-1 確定事項22〜27）。
//
// レンダラーから届く { add, remove } は「ファイルとの差分」である。add[] は
// { src, kind, color, opacity, quads, rect }（src はこの文書のページ番号）、remove[] は
// pdf.js の id（"86R"。オブジェクト番号）である。applyPlan の**前**に当てる。
// 並べ替えのあとでは src が指すページが変わるためで、当てた注釈はページ実体に
// 付いて一緒に動く。
//
// pdf-lib のクラスは TOOLS で受ける（vendor へのパスをここに持たせない）。
// 辞書の読みは pdf-tree-reader.js の pick に寄せ、/Annots の直接操作は
// inserted-annotations.js と同じ作法にする（page.node.addAnnot() は normalize() が
// content stream を包み直すので使わない）。

const { pick } = require('./pdf-tree-reader.js');
const { appearanceOf } = require('./annotation-appearance.js');

// pdf.js の id を { num, gen } に読む。"86R" は世代 0、"86R2" は世代 2。
function parseRef(id) {
  const match = /^(\d+)R(\d*)$/.exec(String(id ?? ''));
  if (match === null)
    return null;
  return { num: Number(match[1]), gen: match[2] === '' ? 0 : Number(match[2]) };
}

function sameRef(ref, target) {
  return ref?.objectNumber === target.num && ref?.generationNumber === target.gen;
}

function annotsOf(page, context, PDFName) {
  const annots = context.lookup(page.node.get(PDFName.of('Annots')));
  return typeof annots?.asArray === 'function' ? annots : null;
}

// 1 つの参照とその外観・ポップアップをコンテキストから消す。消し忘れると孤児が
// 残り、保存のたびに膨らむ（事前調査 C）。
function deleteAnnot(context, ref, { PDFName }) {
  const annot = context.lookup(ref);
  const ap = context.lookup(pick(annot, '/AP'));
  const normal = pick(ap, '/N');
  if (typeof normal?.objectNumber === 'number')
    context.delete(normal);
  const popup = pick(annot, '/Popup');
  if (typeof popup?.objectNumber === 'number')
    context.delete(popup);
  context.delete(ref);
  return popup;
}

// remove[] の注釈を全ページの /Annots から外す。無いものは黙って飛ばす。
function removeAnnotations(doc, remove, tools) {
  const { PDFName } = tools;
  const targets = remove.map(parseRef).filter((ref) => ref !== null);
  if (targets.length === 0)
    return 0;
  const context = doc.context;
  let removed = 0;
  for (const page of doc.getPages()) {
    const annots = annotsOf(page, context, PDFName);
    if (annots === null)
      continue;
    const kept = [];
    const popups = [];
    for (const ref of annots.asArray()) {
      const hit = typeof ref?.objectNumber === 'number' && targets.some((target) => sameRef(ref, target));
      if (!hit) {
        kept.push(ref);
        continue;
      }
      removed += 1;
      const popup = deleteAnnot(context, ref, tools);
      if (popup !== undefined)
        popups.push(popup);
    }
    // 消した注釈のポップアップも同じ /Annots に並んでいるので外す。
    const remaining = kept.filter((ref) => !popups.some((popup) => sameRef(ref, { num: popup.objectNumber, gen: popup.generationNumber })));
    if (remaining.length !== annots.asArray().length)
      page.node.set(PDFName.of('Annots'), context.obj(remaining));
  }
  return removed;
}

function timestamp(now) {
  const pad = (value) => String(value).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return `D:${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${sign}${hours}'${minutes}'`;
}

// 1 つ足す。外観（Form XObject）を作り、注釈の辞書を登録して /Annots へ並べる。
function addAnnotation(doc, page, entry, appearance, { PDFName, PDFString }, now, serial) {
  const context = doc.context;
  const gs = { Type: 'ExtGState', CA: appearance.opacity, ca: appearance.opacity };
  if (appearance.blend !== null)
    gs.BM = appearance.blend;
  const stream = context.stream(appearance.content, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: appearance.bbox,
    Resources: { ExtGState: { GS: gs } },
  });
  const streamRef = context.register(stream);
  const dict = context.obj({
    Type: 'Annot',
    Subtype: appearance.subtype,
    Rect: appearance.bbox,
    QuadPoints: entry.quads.flat(),
    C: appearance.rgb,
    CA: appearance.opacity,
    F: 4,
    NM: PDFString.of(`sigk-${now.getTime().toString(36)}-${serial}`),
    P: page.ref,
    M: PDFString.of(timestamp(now)),
    Contents: PDFString.of(''),
    AP: { N: streamRef },
  });
  const annotRef = context.register(dict);
  const annots = annotsOf(page, context, PDFName);
  if (annots !== null)
    annots.push(annotRef);
  else
    page.node.set(PDFName.of('Annots'), context.obj([annotRef]));
  return annotRef;
}

// { add, remove } を当てる。戻り値は { ok, added, removed } か { error }。
// add[] の形が 1 つでも違えば何も書かずに断る（validatePlan と同じ流儀）。
function applyAnnotations(doc, { add = [], remove = [] } = {}, tools, { now = new Date() } = {}) {
  const pages = doc.getPages();
  const prepared = [];
  for (const [index, entry] of add.entries()) {
    if (!Number.isInteger(entry?.src) || entry.src < 0 || entry.src >= pages.length)
      return { error: `注釈 ${index + 1} のページ番号が文書に合いません。` };
    const appearance = appearanceOf(entry);
    if (appearance === null)
      return { error: `注釈 ${index + 1} の形が読めません。` };
    prepared.push({ entry, appearance });
  }
  if (!Array.isArray(remove) || remove.some((id) => parseRef(id) === null))
    return { error: '消す注釈の指定が読めません。' };

  const removed = removeAnnotations(doc, remove, tools);
  prepared.forEach(({ entry, appearance }, serial) => {
    addAnnotation(doc, pages[entry.src], entry, appearance, tools, now, serial + 1);
  });
  return { ok: true, added: prepared.length, removed };
}

module.exports = { parseRef, applyAnnotations };
