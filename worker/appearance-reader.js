'use strict';

// 注釈の外観（/AP /N。状態の辞書なら /AS で選ぶ）を読む純粋層（spec-4-5 確定事項28）。
//
// op-flatten.js から移した（spec-4b-2。フラット化と読み戻しの口が共用する。中身は変えていない）。pdf-lib のクラスで
// instanceof しない（ワーカーは vendor の、テストは node_modules の pdf-lib を使う）。

const { pick } = require('./pdf-tree-reader.js');
const { IDENTITY } = require('./pdf-matrix.js');

const isRef = (value) => typeof value?.objectNumber === 'number';
// ストリームは getContents を持つ（PDFDict も中身を dict という Map で持つので、dict の有無では見分けられない）。
const isStream = (value) => typeof value?.getContents === 'function';

function numbersOf(context, value, length) {
  const array = context.lookup(value);
  if (typeof array?.asArray !== 'function')
    return null;
  const numbers = array.asArray().map((item) => context.lookup(item)).map((item) => (typeof item?.asNumber === 'function' ? item.asNumber() : Number.NaN));
  return numbers.length === length && numbers.every(Number.isFinite) ? numbers : null;
}

// 外観を選ぶ。戻り値は { ref, bbox, matrix } か null（無い・選べない・/BBox が読めない）。
function appearanceOf(context, dict) {
  const ap = context.lookup(pick(dict, '/AP'));
  let ref = pick(ap, '/N');
  const normal = context.lookup(ref);
  if (!isStream(normal) && typeof normal?.entries === 'function') {
    const state = pick(dict, '/AS');
    ref = typeof state?.asString === 'function' ? pick(normal, state.asString()) : undefined;
  }
  const stream = context.lookup(ref);
  if (!isRef(ref) || !isStream(stream))
    return null;
  const bbox = numbersOf(context, pick(stream.dict, '/BBox'), 4);
  if (bbox === null || bbox[0] === bbox[2] || bbox[1] === bbox[3])
    return null;
  return { ref, bbox, matrix: numbersOf(context, pick(stream.dict, '/Matrix'), 6) ?? IDENTITY };
}

module.exports = { isRef, isStream, numbersOf, appearanceOf };
