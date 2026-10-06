'use strict';

// 構造ツリー（タグ付き PDF の読み上げの情報）から、1 ページの要素を外す（spec-4b-6b 確定事項21。事前調査 I）。
//
// モザイクでページを画像 1 枚に差し替えると、そのページの中身を指す要素は行き先を失う。それだけでなく、要素の /ActualText・/Alt・/E には
// 元の文字が入っていることがあり、根から辿れるので保存のあとも残る（試作で確かめた）。そこで:
//   - そのページの内容の印（MCID の数と、/Pg がそのページの MCR）を外す
//   - そのページの要素（/Pg がそのページ。持たなければ親から受け継ぐ）は、子が残らなければ外す
//   - そのページの要素で、ほかのページの子が残るものは、/ActualText・/Alt・/E だけを外して残す
//   - /ParentTree（数の木）からそのページの /StructParents の項を消す
// 書き込みを指す OBJR は残す（書き込みは書き込みのまま残る。決定64 ⑥）。pdf-lib は require しない（tools で受け取る）。

const TEXT_KEYS = ['ActualText', 'Alt', 'E'];

function createWalker(doc, pageRef, tools) {
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFNumber } = tools;
  const ctx = doc.context;
  const resolve = (value) => (value instanceof PDFRef ? ctx.lookup(value) : value);
  const isTarget = (value) => value instanceof PDFRef && value.toString() === pageRef.toString();
  const name = (key) => PDFName.of(key);

  function kidsOf(holder) {
    const kids = holder.get(name('K'));
    if (kids === undefined)
      return [];
    const list = resolve(kids);
    if (list instanceof PDFArray)
      return Array.from({ length: list.size() }, (_unused, index) => list.get(index));
    return [kids];
  }

  // 1 つの子を残すか。page はその子が受け継ぐページ（親の /Pg）。
  function keepKid(kid, page) {
    const value = resolve(kid);
    if (value instanceof PDFNumber)
      return !isTarget(page);
    if (!(value instanceof PDFDict))
      return true;
    const own = value.get(name('Pg')) ?? page;
    if (value.get(name('S')) !== undefined)
      return visit(value, own);
    // 内容の印（MCR）はそのページなら外す。書き込みの参照（OBJR）は残す。
    if (value.get(name('MCID')) !== undefined)
      return !isTarget(own);
    return true;
  }

  // 要素 holder の子を整理する。holder を残すなら true。
  function visit(holder, page) {
    const before = kidsOf(holder);
    const kept = before.filter((kid) => keepKid(kid, page));
    if (kept.length !== before.length)
      holder.set(name('K'), ctx.obj(kept));
    if (!isTarget(page))
      return true;
    if (kept.length === 0)
      return false;
    for (const key of TEXT_KEYS)
      holder.delete(name(key));
    return true;
  }

  // 数の木（/Nums か /Kids）から、鍵が key の項を消す。
  function pruneNumberTree(node, key) {
    const tree = resolve(node);
    if (!(tree instanceof PDFDict))
      return;
    const nums = resolve(tree.get(name('Nums')));
    if (nums instanceof PDFArray) {
      const next = [];
      for (let index = 0; index + 1 < nums.size(); index += 2) {
        const at = resolve(nums.get(index));
        if (at instanceof PDFNumber && at.asNumber() === key)
          continue;
        next.push(nums.get(index), nums.get(index + 1));
      }
      tree.set(name('Nums'), ctx.obj(next));
    }
    const kids = resolve(tree.get(name('Kids')));
    if (kids instanceof PDFArray) {
      for (let index = 0; index < kids.size(); index += 1)
        pruneNumberTree(kids.get(index), key);
    }
  }

  return { resolve, visit, pruneNumberTree };
}

// doc の構造ツリーから、pageRef のページの要素を外す。structParents はそのページの /StructParents（無ければ undefined）。
// 構造ツリーが無ければ何もしない。tools は { PDFName, PDFDict, PDFArray, PDFRef, PDFNumber }。
function dropPageFromStructTree(doc, pageRef, structParents, tools) {
  const { PDFName, PDFDict } = tools;
  const walker = createWalker(doc, pageRef, tools);
  const root = walker.resolve(doc.catalog.get(PDFName.of('StructTreeRoot')));
  if (!(root instanceof PDFDict))
    return false;
  walker.visit(root, undefined);
  if (Number.isInteger(structParents))
    walker.pruneNumberTree(root.get(PDFName.of('ParentTree')), structParents);
  return true;
}

module.exports = { dropPageFromStructTree };
