'use strict';

// 差し込んだ PDF のページから、動かなくなる注釈を落とす（spec-1-6 確定事項63）。
// op-insert.js から切り出した（あちらは 3 形式と複数ページを受けて 200 行を超えたため）。

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

module.exports = { cleanInsertedPage };
