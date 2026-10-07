'use strict';

// モザイクのある保存で、ページ・書き込みの外観・フォームの /Resources を、その内容の流れが名前で使うものだけに絞る
// （spec-4b-6b 確定事項22。コードの点検で直した）。
//
// 差し替えたページの元の /Resources が、ほかのページと共有されている（同じ辞書を指す・/Pages から受け継ぐ・同じ画像を名前だけ並べる）と、
// そのページだけが描いていた画像やフォームが、ほかのページの /Resources から辿れて残る。書き込みの外観（/AP）の /Resources がページの
// /Resources と同じ物でも同じことが起きる。そこで、モザイクのある保存では:
//   - 差し替えたページ以外の全ページの /Resources を、受け継ぐ分を含めて自分の辞書に写し、内容の流れが使う名前だけを残す
//   - 全ページの書き込みの外観と、残したフォーム・模様（タイル）・Type3 フォントの /Resources も同じく絞る
//   - /Pages の /Resources を外す（全ページが自分の辞書を持ったあと）
// 辞書は書き換えずに写しを作る（共有している辞書をほかの持ち主から変えない）。名前は、ほどいた流れに出てくる名前を全部拾う
// （content-names.js）。/Resources を持たない子（フォーム・模様・Type3）は親の /Resources を使うので、その名前も親に足す。流れを
// ほどけない（知らない圧縮）持ち主は絞らず、そのまま自分の辞書として持たせ、その数を返す。pdf-lib は require しない（tools で受け取る）。

const { createContentNames } = require('./content-names.js');

const CATEGORIES = new Set(['ExtGState', 'ColorSpace', 'Pattern', 'Shading', 'XObject', 'Font', 'Properties']);
// 中に内容の流れを持ち得る種類（子を辿る先）。
const OWNERS = ['XObject', 'Pattern', 'Font'];

function createNarrower(doc, tools) {
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFStream } = tools;
  const ctx = doc.context;
  const { namesOf } = createContentNames(ctx, tools);
  const key = (text) => PDFName.of(text);
  const resolve = (value) => (value instanceof PDFRef ? ctx.lookup(value) : value);
  const dictOf = (value) => (value instanceof PDFStream ? value.dict : value instanceof PDFDict ? value : null);
  const done = new Set();
  let skipped = 0;

  // 自分の /Resources を持たず、親の /Resources を使う子か。
  function borrows(value) {
    const dict = dictOf(value);
    if (dict === null || dict.has(key('Resources')))
      return false;
    return dict.get(key('Subtype')) === key('Form') || dict.get(key('Subtype')) === key('Type3')
      || (value instanceof PDFStream && dict.has(key('PatternType')));
  }

  // resources を used の名前だけに絞った写しを返す。親の /Resources を使う子の名前は used に足す。子の流れをほどけなければ null。
  function narrowedCopy(resources, used) {
    const visited = new Set();
    for (let grew = true; grew;) {
      grew = false;
      for (const category of OWNERS) {
        const group = resolve(resources.get(key(category)));
        if (!(group instanceof PDFDict))
          continue;
        for (const [entry, value] of group.entries()) {
          const child = resolve(value);
          if (!used.has(entry.decodeText()) || visited.has(child) || !borrows(child))
            continue;
          visited.add(child);
          const names = namesOf(child);
          if (names === null)
            return null;
          for (const name of names) {
            if (used.has(name))
              continue;
            used.add(name);
            grew = true;
          }
        }
      }
    }
    const copy = ctx.obj({});
    for (const [category, value] of resources.entries()) {
      const group = resolve(value);
      if (!CATEGORIES.has(category.decodeText()) || !(group instanceof PDFDict)) {
        copy.set(category, value);
        continue;
      }
      const kept = ctx.obj({});
      for (const [entry, item] of group.entries()) {
        if (used.has(entry.decodeText()))
          kept.set(entry, item);
      }
      copy.set(category, kept);
    }
    return copy;
  }

  // 残した子のうち、自分の /Resources を持つものも絞る。
  function descend(resources) {
    for (const category of OWNERS) {
      const group = resolve(resources.get(key(category)));
      if (!(group instanceof PDFDict))
        continue;
      for (const value of group.values())
        narrowOwn(resolve(value));
    }
  }

  // owner（ページ・フォーム・模様・Type3・外観）の /Resources を絞る。1 度だけ。resources を渡せばそれを使う（ページが受け継ぐ分）。
  function narrow(owner, resources, extra = new Set()) {
    const dict = dictOf(owner);
    if (dict === null || done.has(dict) || !(resources instanceof PDFDict))
      return;
    done.add(dict);
    const names = namesOf(owner);
    const copy = names === null ? null : narrowedCopy(resources, new Set([...names, ...extra]));
    if (copy === null)
      skipped += 1;
    dict.set(key('Resources'), copy ?? resources);
    descend(copy ?? resources);
  }

  function narrowOwn(owner) {
    const dict = dictOf(owner);
    if (dict !== null)
      narrow(owner, resolve(dict.get(key('Resources'))));
  }

  // ページの書き込みの外観の流れ（/N・/R・/D と、状態ごとの辞書の中）。
  function appearancesOf(page) {
    const found = [];
    const annots = resolve(page.get(key('Annots')));
    const list = annots instanceof PDFArray ? annots.asArray() : [];
    for (const annot of list) {
      const ap = resolve(dictOf(resolve(annot))?.get(key('AP')));
      if (!(ap instanceof PDFDict))
        continue;
      for (const mode of ['N', 'R', 'D']) {
        const value = resolve(ap.get(key(mode)));
        const streams = value instanceof PDFDict ? value.values().map(resolve) : [value];
        found.push(...streams.filter((stream) => stream instanceof PDFStream));
      }
    }
    return found;
  }

  // ページが使う /Resources（自分か、/Pages から受け継ぐもの）。
  function resourcesOf(page) {
    const seen = new Set();
    for (let node = page; node instanceof PDFDict && !seen.has(node); node = resolve(node.get(key('Parent')))) {
      seen.add(node);
      if (node.has(key('Resources')))
        return resolve(node.get(key('Resources')));
    }
    return undefined;
  }

  // 1 ページ。replaced（画像に差し替えたページ）は外観だけ絞る。/Resources を持たない外観は、ページの /Resources の名前に足す。
  function narrowPage(page, replaced) {
    const extra = new Set();
    for (const stream of appearancesOf(page)) {
      if (stream.dict.has(key('Resources'))) {
        narrowOwn(stream);
        continue;
      }
      const names = namesOf(stream);
      for (const name of names ?? [])
        extra.add(name);
    }
    if (!replaced)
      narrow(page, resourcesOf(page), extra);
  }

  // /Pages の /Resources を外す（どのページも自分の /Resources を持ったあと）。
  function dropInherited(node, seen = new Set()) {
    if (!(node instanceof PDFDict) || seen.has(node) || node.get(key('Type')) !== key('Pages'))
      return;
    seen.add(node);
    node.delete(key('Resources'));
    const kids = resolve(node.get(key('Kids')));
    for (const kid of kids instanceof PDFArray ? kids.asArray() : [])
      dropInherited(resolve(kid), seen);
  }

  return { narrowPage, dropInherited, skipped: () => skipped };
}

// doc の全ページを絞る。replaced は画像に差し替えたページの ref の文字列の集合。絞れなかった持ち主の数を返す。
// tools は pdf-io.js の TOOLS（PDFName・PDFDict・PDFArray・PDFRef・PDFStream・PDFRawStream・decodePDFRawStream）。
function narrowResources(doc, replaced, tools) {
  const narrower = createNarrower(doc, tools);
  for (const page of doc.getPages())
    narrower.narrowPage(page.node, replaced.has(page.ref.toString()));
  narrower.dropInherited(doc.catalog.Pages());
  return { skipped: narrower.skipped() };
}

module.exports = { narrowResources };
