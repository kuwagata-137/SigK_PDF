'use strict';

// 塗りと枠線を分けて描いた外観から、塗りの不透明度・枠線の不透明度・ハッチングを読む純粋層（spec-7-9 確定事項B2・C1。読み戻し）。
//
// SigK PDF が書いた外観（fill-apart-appearance.js）は、/Resources /Properties /SK に { /FillOpacity /Opacity /Hatch /HatchColor
// /HatchGap /HatchWidth } を持つ（中身の /SigKStyle /SK BDC … EMC が指すマーク付き内容の属性）。外観の中身（ストリーム）は読まず、
// 辞書の数と名前だけを読むので、暗号化された文書でも読める。属性が無い外観（ほかのアプリの PDF・今までのファイル）は null。

const { pick } = require('./pdf-tree-reader.js');
const { appearanceOf } = require('./appearance-reader.js');

// 属性の名前 → ハッチングの種類（fill-apart-appearance.js の HATCH_NAMES の逆）。
const PATTERNS = Object.freeze({ Diagonal: 'diagonal', Reverse: 'reverse', Cross: 'cross', Horizontal: 'horizontal', Vertical: 'vertical', Grid: 'grid' });

function numberOf(context, value) {
  const item = context.lookup(value);
  return typeof item?.asNumber === 'function' ? item.asNumber() : null;
}

function nameOf(context, value) {
  const item = context.lookup(value);
  return typeof item?.encodedName === 'string' ? item.encodedName.slice(1) : null;
}

function numbersOf(context, value) {
  const array = context.lookup(value);
  if (typeof array?.asArray !== 'function')
    return null;
  const items = array.asArray().map((item) => numberOf(context, item));
  return items.every((item) => item !== null) ? items : null;
}

// ハッチング。属性に無ければ null、種類が分からないものも null（読める欄だけを返し、範囲はレンダラーが確かめる）。
function hatchOf(context, properties) {
  const pattern = PATTERNS[nameOf(context, pick(properties, '/Hatch'))];
  if (pattern === undefined)
    return null;
  return {
    pattern,
    color: numbersOf(context, pick(properties, '/HatchColor')),
    gap: numberOf(context, pick(properties, '/HatchGap')),
    width: numberOf(context, pick(properties, '/HatchWidth')),
  };
}

// 注釈の外観の塗りの欄。{ opacity, fillOpacity, hatch } か null（属性が無い・読めない）。
function fillStyleOf(context, dict) {
  const appearance = appearanceOf(context, dict);
  if (appearance === null)
    return null;
  const stream = context.lookup(appearance.ref);
  const resources = context.lookup(pick(stream.dict, '/Resources'));
  const properties = context.lookup(pick(context.lookup(pick(resources, '/Properties')), '/SK'));
  if (typeof properties?.entries !== 'function')
    return null;
  const opacity = numberOf(context, pick(properties, '/Opacity'));
  const fillOpacity = numberOf(context, pick(properties, '/FillOpacity'));
  if (opacity === null || fillOpacity === null)
    return null;
  return { opacity, fillOpacity, hatch: hatchOf(context, properties) };
}

module.exports = { PATTERNS, fillStyleOf };
