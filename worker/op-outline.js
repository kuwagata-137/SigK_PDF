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
// 【この層の鉄則】**消すのは「消えたページを指していると確かめられたもの」だけ。**
// 判定できなかったものには触らない。しおりは必ずしもページを指しておらず、
// URL を開くもの（`/A /S /URI`）・別のファイルへ飛ぶもの（`/GoToR`）・
// 解決できない名前を指すもの・ページ番号で指すものがある。「分からなければ消す」に
// すると、削除とは無関係なしおりまで壊す。
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

// PDFRef かどうかを、クラスを持ち込まずに見分ける。
function isRef(value) {
  return value !== undefined && value !== null
    && typeof value.objectNumber === 'number'
    && typeof value.generationNumber === 'number';
}

// 宛先の配列 `[pageRef, /Fit ...]` から、ページの参照を取り出す。
// 先頭が参照でないもの（ページ番号で指す形など）は **undefined**＝判定できない、とする。
function pageRefOfArray(context, value) {
  const array = context.lookup(value);
  if (array === undefined || array === null || typeof array.get !== 'function')
    return undefined;
  const first = array.get(0);
  return isRef(first) ? refKey(first) : undefined;
}

// 宛先の値からページの参照を取る。配列そのもの、または `/D` を持つ辞書のどちらもある。
function pageRefOfDestination(context, value) {
  const resolved = context.lookup(value);
  if (resolved === undefined || resolved === null)
    return undefined;
  if (typeof resolved.get === 'function' && typeof resolved.size === 'function')
    return pageRefOfArray(context, resolved);
  const inner = pick(resolved, '/D');
  return inner === undefined ? undefined : pageRefOfArray(context, inner);
}

// 名前付き宛先の索引（名前 → ページの参照）。解決できたものだけを載せる。
// 載っていない名前は「判定できない」ことになり、しおりを触らない側へ倒れる。
function destinationIndex(doc) {
  const context = doc.context;
  const index = new Map();

  const namesDict = context.lookup(pick(doc.catalog, '/Names'));
  for (const [key, value] of collectNamed(context, pick(namesDict, '/Dests'))) {
    const label = textOf(context.lookup(key));
    const target = pageRefOfDestination(context, value);
    if (label !== '' && target !== undefined)
      index.set(label, target);
  }

  // 古い形式の `/Dests`（catalog 直下の辞書）にも対応する。
  const legacy = context.lookup(pick(doc.catalog, '/Dests'));
  if (legacy !== undefined && legacy !== null && typeof legacy.entries === 'function') {
    for (const [key, value] of legacy.entries()) {
      const target = pageRefOfDestination(context, value);
      if (target !== undefined)
        index.set(key.asString().replace(/^\//, ''), target);
    }
  }
  return index;
}

// 宛先（配列そのもの、または名前）を解決する。できなければ undefined。
function resolveDestination(context, value, index) {
  const direct = pageRefOfArray(context, value);
  if (direct !== undefined)
    return direct;
  const label = textOf(context.lookup(value));
  return label === '' ? undefined : index.get(label.replace(/^\//, ''));
}

function destTargetOf(context, item, index) {
  const dest = pick(item, '/Dest');
  return dest === undefined ? undefined : resolveDestination(context, dest, index);
}

// `/A` のうち、**ページへ飛ぶ `/GoTo` だけ**が対象である。
// `/URI`・`/GoToR`・`/Launch`・`/Named` などは、ページの削除とは何の関係もない。
function actionTargetOf(context, item, index) {
  const action = context.lookup(pick(item, '/A'));
  if (action === undefined || action === null)
    return undefined;
  const kind = pick(action, '/S');
  if (kind === undefined || kind.asString() !== '/GoTo')
    return undefined;
  const target = pick(action, '/D');
  return target === undefined ? undefined : resolveDestination(context, target, index);
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

function pruneOutlines(context, root, { live, index, PDFName }) {
  let count = 0;
  walkOutline(context, root, (item) => {
    // 消えたページを指していると確かめられたものだけを落とす。
    const dead = (target) => target !== undefined && !live.has(target);
    let changed = false;
    if (dead(destTargetOf(context, item, index))) {
      item.delete(PDFName.of('Dest'));
      changed = true;
    }
    if (dead(actionTargetOf(context, item, index))) {
      item.delete(PDFName.of('A'));
      changed = true;
    }
    if (changed)
      count += 1;
  });
  return count;
}

// 飛び先を失ったしおりから `/Dest`（または `/A`）を落とす。見出しは残す。
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

  const root = context.lookup(outlinesRef);
  const outlines = (root !== undefined && root !== null && typeof root.entries === 'function')
    ? pruneOutlines(context, root, { live, index, PDFName })
    : 0;

  // 名前付き宛先は、生きているものと**判定できなかったもの**を並べ直す
  // （`/Kids` の枝は畳んで平らにする）。
  let names = 0;
  if (destsRef !== undefined) {
    const kept = [];
    for (const [key, value] of collectNamed(context, destsRef)) {
      const target = pageRefOfDestination(context, value);
      if (target === undefined || live.has(target))
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
