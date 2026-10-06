'use strict';

// 注釈の外観の重ね方（ExtGState の /BM）を読む純粋層（spec-4b-5b 確定事項13）。ペンとマーカーを見分ける（決定61 ②。マーカーは
// 外観の /BM /Multiply で見分け、独自の欄を使わない）。
//
// 外観（/AP /N。状態の辞書なら /AS で選ぶ）の /Resources /ExtGState と、その 1 段下の Form XObject の /Resources /ExtGState を見る
// （事前調査 F。pdf.js はどちらでも乗算で描く）。名前の配列は先頭の名前を読む（規格は「読める最初の名前」で、標準の名前はどれも
// 読める）。外観の中身（ストリーム）は読まないので、暗号化された文書でも読める（辞書の名前は暗号化されない）。

const { pick } = require('./pdf-tree-reader.js');
const { isStream, appearanceOf } = require('./appearance-reader.js');

// ふつうの重ね方（数えない）。
const NORMAL_BLENDS = Object.freeze(['Normal', 'Compatible']);

function nameOf(context, value) {
  const item = context.lookup(value);
  return typeof item?.encodedName === 'string' ? item.encodedName.slice(1) : null;
}

// /BM の値（名前か、名前の配列の先頭）。読めなければ null。
function blendNameOf(context, value) {
  const item = context.lookup(value);
  if (typeof item?.asArray === 'function')
    return item.asArray().length === 0 ? null : nameOf(context, item.asArray()[0]);
  return nameOf(context, item);
}

// 1 つの Form の /Resources /ExtGState にある /BM を names に足す（ふつうの重ね方は足さない）。
function collectBlends(context, stream, names) {
  const states = context.lookup(pick(context.lookup(pick(stream.dict, '/Resources')), '/ExtGState'));
  if (typeof states?.entries !== 'function')
    return;
  for (const [, value] of states.entries()) {
    const name = blendNameOf(context, pick(context.lookup(value), '/BM'));
    if (name !== null && !NORMAL_BLENDS.includes(name))
      names.add(name);
  }
}

// 1 段下の Form XObject。
function childForms(context, stream) {
  const xobjects = context.lookup(pick(context.lookup(pick(stream.dict, '/Resources')), '/XObject'));
  if (typeof xobjects?.entries !== 'function')
    return [];
  return [...xobjects.entries()].map(([, value]) => context.lookup(value))
    .filter((child) => isStream(child) && nameOf(context, pick(child.dict, '/Subtype')) === 'Form');
}

// 注釈の外観の重ね方。乗算だけなら 'Multiply'、ほかの重ね方があればその名前（2 つ以上なら乗算でない方の 1 つ）、無ければ null
// （外観が無い・ふつうの重ね方だけ）。
function blendOf(context, dict) {
  const appearance = appearanceOf(context, dict);
  if (appearance === null)
    return null;
  const stream = context.lookup(appearance.ref);
  const names = new Set();
  collectBlends(context, stream, names);
  for (const child of childForms(context, stream))
    collectBlends(context, child, names);
  if (names.size === 0)
    return null;
  return [...names].find((name) => name !== 'Multiply') ?? 'Multiply';
}

module.exports = { NORMAL_BLENDS, blendOf };
