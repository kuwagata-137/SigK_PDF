'use strict';

// マーキングの外観から、形と大きさと番号を読む純粋層（spec-7-9 確定事項F6。読み戻し）。
//
// SigK PDF が書いたマーキングの外観（marking-appearance.js）は、/Resources /Properties /MK に { /Shape /Outer /Dot /Ring /Cross /FontSize
// /Number? } を持つ（中身の /SigKMark /MK BDC … EMC が指すマーク付き内容の属性）。外観の中身（ストリーム）は読まず、辞書の数と名前だけを
// 読むので、暗号化された文書でも読める。属性が無い外観（ほかのアプリの丸・今までのファイル）は null。範囲はレンダラーが確かめる
// （renderer/imported-marking.js）。

const { pick } = require('./pdf-tree-reader.js');
const { appearanceOf } = require('./appearance-reader.js');

// 属性の名前 → 形（marking-appearance.js の SHAPE_NAMES の逆）。
const SHAPES = Object.freeze({ Target: 'target', Double: 'double', Crosshair: 'crosshair', Number: 'number', Caution: 'caution' });
const SIZE_KEYS = Object.freeze({ outer: '/Outer', dot: '/Dot', ring: '/Ring', cross: '/Cross', fontSize: '/FontSize' });

function numberOf(context, value) {
  const item = context.lookup(value);
  return typeof item?.asNumber === 'function' ? item.asNumber() : null;
}

function nameOf(context, value) {
  const item = context.lookup(value);
  return typeof item?.encodedName === 'string' ? item.encodedName.slice(1) : null;
}

// 注釈の外観のマーキングの値。{ shape, outer, dot, ring, cross, fontSize, number? } か null（属性が無い・形が読めない）。
function markingOf(context, dict) {
  const appearance = appearanceOf(context, dict);
  if (appearance === null)
    return null;
  const stream = context.lookup(appearance.ref);
  const resources = context.lookup(pick(stream.dict, '/Resources'));
  const properties = context.lookup(pick(context.lookup(pick(resources, '/Properties')), '/MK'));
  if (typeof properties?.entries !== 'function')
    return null;
  const shape = SHAPES[nameOf(context, pick(properties, '/Shape'))];
  if (shape === undefined)
    return null;
  const marking = { shape };
  for (const [field, key] of Object.entries(SIZE_KEYS))
    marking[field] = numberOf(context, pick(properties, key));
  const number = numberOf(context, pick(properties, '/Number'));
  if (number !== null)
    marking.number = number;
  return marking;
}

module.exports = { SHAPES, markingOf };
