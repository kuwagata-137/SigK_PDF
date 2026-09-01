'use strict';

// しおり（`/Outlines`）と名前付き宛先（`/Names /Dests`）の整合を取る層
// （spec-1-6 確定事項81〜84）。
//
// 並べ替えだけなら、しおりの飛び先はページオブジェクトを追いかけるので何もしなくてよい
// （実測で確認した）。問題は**削除**である。消えたページを指していたしおりは
// **ページ木の外を指したまま残り**、他のビューアではクリックしても何も起きない。
//
// ユーザーの決定は「飛び先だけ落とし、見出しは残す」（2026-09-01）。PDF 仕様では
// 飛び先のない見出しは正当なので、壊れた参照を書き出さずに済む。しおりツリーの
// `First`／`Last`／`Prev`／`Next`／`Count` を触らないため、子項目を持つしおりを
// 消すときの扱いを決める必要もない。
//
// PDFName は引数で受け取る。ワーカーは vendor から、テストは node_modules から
// pdf-lib を読むため、パスをこの層に持たせない（op-page-labels.js と同じ作法）。

const { pick, textOf, refKey, collectNamed } = require('./pdf-tree-reader.js');

// しおりツリーが壊れて輪になっていることがある。辿る数に上限を置いて止める。
const MAX_ITEMS = 100000;

// いまページ木にあるページの参照。ここに無い参照を指すものが「壊れた飛び先」である。
function livePageKeys(doc) {
  return new Set(doc.getPages().map((page) => refKey(page.ref)));
}

// 宛先の配列 `[pageRef, /Fit ...]` から、ページの参照を取り出す。
function pageRefOfArray(context, value) {
  const array = context.lookup(value);
  if (array === undefined || array === null || typeof array.get !== 'function')
    return null;
  return refKey(array.get(0));
}

// 名前付き宛先の索引（名前 → ページの参照）。
function destinationIndex(doc) {
  const context = doc.context;
  const index = new Map();

  const namesDict = context.lookup(pick(doc.catalog, '/Names'));
  for (const [key, value] of collectNamed(context, pick(namesDict, '/Dests'))) {
    const label = textOf(context.lookup(key));
    if (label !== '')
      index.set(label, pageRefOfDestination(context, value));
  }

  // 古い形式の `/Dests`（catalog 直下の辞書）にも対応する。
  const legacy = context.lookup(pick(doc.catalog, '/Dests'));
  if (legacy !== undefined && legacy !== null && typeof legacy.entries === 'function') {
    for (const [key, value] of legacy.entries())
      index.set(key.asString().replace(/^\//, ''), pageRefOfDestination(context, value));
  }
  return index;
}

// 宛先の値からページの参照を取る。配列そのもの、または `/D` を持つ辞書のどちらもある。
function pageRefOfDestination(context, value) {
  const resolved = context.lookup(value);
  if (resolved === undefined || resolved === null)
    return null;
  if (typeof resolved.get === 'function' && typeof resolved.size === 'function')
    return pageRefOfArray(context, resolved);
  const inner = pick(resolved, '/D');
  return inner === undefined ? null : pageRefOfArray(context, inner);
}

// しおり1件の飛び先が指すページ。名前で指している場合は索引を引く。
function targetOf(context, item, index) {
  const dest = pick(item, '/Dest');
  if (dest !== undefined) {
    const direct = pageRefOfArray(context, dest);
    if (direct !== null)
      return direct;
    const label = textOf(context.lookup(dest));
    return label === '' ? null : (index.get(label.replace(/^\//, '')) ?? null);
  }

  const action = context.lookup(pick(item, '/A'));
  if (action === undefined || action === null)
    return null;
  const kind = pick(action, '/S');
  if (kind === undefined || kind.asString() !== '/GoTo')
    return null;
  const target = pick(action, '/D');
  if (target === undefined)
    return null;
  const direct = pageRefOfArray(context, target);
  if (direct !== null)
    return direct;
  const label = textOf(context.lookup(target));
  return label === '' ? null : (index.get(label.replace(/^\//, '')) ?? null);
}

// しおりを深さ優先で辿る。First → Next と、各項目の First（子）を見る。
function walkOutline(context, root, visit) {
  const stack = [];
  const first = pick(root, '/First');
  if (first !== undefined)
    stack.push(first);

  let seen = 0;
  const visited = new Set();
  while (stack.length > 0 && seen < MAX_ITEMS) {
    const ref = stack.pop();
    const key = refKey(ref);
    if (key !== null && visited.has(key))
      continue;
    if (key !== null)
      visited.add(key);

    const item = context.lookup(ref);
    if (item === undefined || item === null || typeof item.entries !== 'function')
      continue;
    seen += 1;
    visit(item);

    const next = pick(item, '/Next');
    if (next !== undefined)
      stack.push(next);
    const child = pick(item, '/First');
    if (child !== undefined)
      stack.push(child);
  }
  return seen;
}

// 飛び先を失ったしおりから `/Dest` と `/A` を落とす。見出しは残す。
// あわせて、ページ木の外を指す名前付き宛先を `/Names /Dests` から外す。
function pruneDestinations(doc, { PDFName }) {
  const context = doc.context;
  const outlinesRef = pick(doc.catalog, '/Outlines');
  const namesDict = context.lookup(pick(doc.catalog, '/Names'));
  const destsRef = pick(namesDict, '/Dests');
  if (outlinesRef === undefined && destsRef === undefined)
    return { outlines: 0, names: 0 };

  const live = livePageKeys(doc);
  const index = destinationIndex(doc);

  let outlines = 0;
  const root = context.lookup(outlinesRef);
  if (root !== undefined && root !== null && typeof root.entries === 'function') {
    walkOutline(context, root, (item) => {
      if (pick(item, '/Dest') === undefined && pick(item, '/A') === undefined)
        return;
      const target = targetOf(context, item, index);
      if (target !== null && live.has(target))
        return;
      item.delete(PDFName.of('Dest'));
      item.delete(PDFName.of('A'));
      outlines += 1;
    });
  }

  // 名前付き宛先は、生きているものだけを並べ直す（`/Kids` の枝は畳んで平らにする）。
  let names = 0;
  if (destsRef !== undefined) {
    const kept = [];
    for (const [key, value] of collectNamed(context, destsRef)) {
      const target = pageRefOfDestination(context, value);
      if (target !== null && live.has(target))
        kept.push(key, value);
      else
        names += 1;
    }
    if (names > 0)
      namesDict.set(PDFName.of('Dests'), context.obj({ Names: kept }));
  }

  return { outlines, names };
}

module.exports = { livePageKeys, destinationIndex, walkOutline, pruneDestinations };
