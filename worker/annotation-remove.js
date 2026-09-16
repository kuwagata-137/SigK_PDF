'use strict';

// 注釈を /Annots から外す層（spec-4-1 確定事項27）。op-annotate.js から切り出した
// （FreeText が加わって 200 行を超えたため。spec-4-2 確定事項28）。
//
// remove[] は pdf.js の id（"86R"。オブジェクト番号と世代）である。辞書の読みは
// pdf-tree-reader.js の pick に寄せる。

const { pick } = require('./pdf-tree-reader.js');

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
// 残り、保存のたびに膨らむ（spec-4-1 事前調査 C）。フォントは消さない（他の注釈と
// 共有かもしれない。spec-4-2 確定事項24）。
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

module.exports = { parseRef, sameRef, annotsOf, deleteAnnot, removeAnnotations };
