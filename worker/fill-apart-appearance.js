'use strict';

// 塗りと枠線を分けて描く図形の外観の中身を組む純粋層（spec-7-9 確定事項B4・B5・C1〜C4）。pdf-lib を知らない。
//
// 塗りの不透明度が枠線と違う時と、ハッチングがある時に、shape-appearance.js から呼ぶ。画面（renderer/fill-apart-graphics.js）と同じ
// 順と抜き方で描く。
//   1. q /GF gs … Q   塗りつぶし（GF の ca が塗りの不透明度）と、その上のハッチング（GF の CA は 1。図形の形で切り抜く W n）。
//      枠線があり半透明の時は、GF に輝度の SMask（白で塗った図形から黒で枠線を引いた Form）を付け、内側から枠線の帯を抜く
//      （塗りを線の内側の縁までに限る。spec-4b-1b 事前調査 D の v3）
//   2. q /GL gs … Q   枠線（GL の CA が枠線の不透明度）
// 全体を PDF 標準のマーク付き内容 /SigKStyle /SK BDC … EMC で囲み、/Resources /Properties /SK に塗りの不透明度・枠線の不透明度・
// ハッチングを書く（読み戻しは appearance-fill-style.js。注釈の辞書には独自の欄を追加しない。決定61 ②）。辞書の /CA は 1 にする
// （外観が不透明度を持つので、ビューアが外観に /CA を掛けて二重に薄くしないように）。

const { num, colorOps } = require('./annotation-appearance.js');
const { point } = require('./shape-path-ops.js');
const { outlineOf } = require('./box-path-ops.js');
const { linesOf, boxOf } = require('./hatch-geometry.js');
const { canFill } = require('./shape-style-rules.js');

// ハッチングの種類 → マーク付き内容の属性の名前。
const HATCH_NAMES = Object.freeze({ diagonal: 'Diagonal', reverse: 'Reverse', cross: 'Cross', horizontal: 'Horizontal', vertical: 'Vertical', grid: 'Grid' });

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

// 分けて描くか（塗りを持てる書き込みで、ハッチングがあるか、塗りと枠線の不透明度が違う時）。alpha は枠線の不透明度。
function isApart(entry, style, alpha) {
  return canFill(entry) && (style.hatch !== null || style.fillOpacity !== alpha);
}

function hatchOps(entry, style, path) {
  const { hatch } = style;
  const lines = linesOf(boxOf(entry), hatch).map(([from, to]) => `${point(from)} m ${point(to)} l`);
  return ['q', `${path} W n`, `${colorOps(hatch.rgb)} RG ${num(hatch.width)} w 0 J 0 j [] 0 d`, ...lines, 'S', 'Q'];
}

// 枠線の帯を抜く輝度の Form の中身（白で塗った図形から、黒で同じ太さの線を引く）。
function maskContentOf(outline) {
  return ['1 g', `${outline.path} f`, `0 G ${outline.head}`, `${outline.path} S`].join('\n');
}

// マーク付き内容の属性（/Resources /Properties /SK）。
function propertiesOf(style, alpha) {
  const properties = { FillOpacity: round4(style.fillOpacity), Opacity: round4(alpha) };
  if (style.hatch !== null) {
    properties.Hatch = HATCH_NAMES[style.hatch.pattern];
    properties.HatchColor = style.hatch.rgb.map(round4);
    properties.HatchGap = style.hatch.gap;
    properties.HatchWidth = style.hatch.width;
  }
  return properties;
}

// 外観の中身と、外観の Form に付ける資源。{ content, mask（輝度の Form の中身か null）, states, properties, cloud }。
function apartAppearanceOf(entry, style, alpha) {
  const outline = outlineOf(entry, style);
  const masked = style.stroke !== null && alpha < 1;
  const lines = ['/SigKStyle /SK BDC', 'q /GF gs'];
  if (style.fill !== null)
    lines.push(`${colorOps(style.fill)} rg`, `${outline.path} f`);
  if (style.hatch !== null)
    lines.push(...hatchOps(entry, style, outline.path));
  lines.push('Q');
  if (style.stroke !== null)
    lines.push('q /GL gs', `${colorOps(style.stroke)} RG ${outline.head}`, `${outline.path} S`, 'Q');
  lines.push('EMC');
  return {
    content: lines.join('\n'),
    mask: masked ? maskContentOf(outline) : null,
    states: { GF: { ca: round4(style.fillOpacity), CA: 1 }, GL: { CA: round4(alpha), ca: round4(alpha) } },
    properties: { SK: propertiesOf(style, alpha) },
    cloud: outline.cloud,
  };
}

module.exports = { HATCH_NAMES, isApart, apartAppearanceOf };
