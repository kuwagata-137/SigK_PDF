'use strict';

// PDF の辞書と「木」を、pdf-lib のクラスを持ち込まずに読む層。
//
// PDF は同じ形の木を2種類使う。ページラベルの **number tree**（`/Nums`）と、
// 名前付き宛先の **name tree**（`/Names`）である。どちらも葉に
// `[キー, 値, キー, 値, ...]` の配列を持ち、大きな文書では `/Kids` で枝分かれする。
// **`/Kids` を辿らない実装は、大きな文書の中身を丸ごと落とす**（実測で確認した）。
//
// 値を引くのに `PDFName.of()` を使わず `entries()` を舐めているのは、この層に
// pdf-lib への依存を持たせないためである。ワーカーは vendor から、テストは
// node_modules から pdf-lib を読むので、パスをここに書けない。

// 辞書から名前で値を引く。name は '/S' のように先頭の / を含める。
function pick(dict, name) {
  if (dict === undefined || dict === null || typeof dict.entries !== 'function')
    return undefined;
  for (const [key, value] of dict.entries()) {
    if (key.asString() === name)
      return value;
  }
  return undefined;
}

// 文字列として読む。PDFString も PDFHexString も decodeText を持つ。
function textOf(value) {
  if (value === undefined || value === null)
    return '';
  if (typeof value.decodeText === 'function')
    return value.decodeText();
  if (typeof value.asString === 'function')
    return value.asString();
  return '';
}

// 参照の同一性を比べるための鍵。PDFRef の toString が "12 0 R" を返す。
function refKey(ref) {
  return ref === undefined || ref === null ? null : String(ref);
}

// 木を [キー, 値] の並びへ均す。leafKey は '/Nums' か '/Names'。
function collectTree(context, node, leafKey, out = [], depth = 0) {
  // 壊れた文書が輪になっていることがある。深さで止める。
  if (depth > 64)
    return out;
  const resolved = context.lookup(node);
  if (resolved === undefined || resolved === null)
    return out;

  const leaves = context.lookup(pick(resolved, leafKey));
  if (leaves !== undefined && leaves !== null && typeof leaves.size === 'function') {
    for (let index = 0; index + 1 < leaves.size(); index += 2)
      out.push([leaves.get(index), leaves.get(index + 1)]);
  }

  const kids = context.lookup(pick(resolved, '/Kids'));
  if (kids !== undefined && kids !== null && typeof kids.size === 'function') {
    for (let index = 0; index < kids.size(); index += 1)
      collectTree(context, kids.get(index), leafKey, out, depth + 1);
  }
  return out;
}

// number tree（ページラベル）。キーを数値へ直し、小さい順に並べて返す。
function collectNumbered(context, node) {
  return collectTree(context, node, '/Nums')
    .map(([key, value]) => [context.lookup(key), value])
    .filter(([key]) => typeof key?.asNumber === 'function')
    .map(([key, value]) => [key.asNumber(), context.lookup(value)])
    .sort((a, b) => a[0] - b[0]);
}

// name tree（名前付き宛先）。キーは文字列オブジェクトのまま返す。
// 書き戻すときに、読んだそのものを並べ直せるようにするためである。
function collectNamed(context, node) {
  return collectTree(context, node, '/Names');
}

module.exports = { pick, textOf, refKey, collectTree, collectNumbered, collectNamed };
