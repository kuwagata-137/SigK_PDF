'use strict';

// 図形の書き込みツールごとの、次に追加する書き込みの値の既定と検証（docs/spec-7-10-shape-tools.md。決定102 ⑨・質問 SH7 案B）。
// annotation-settings.js が ANNOT_DEFAULTS・pickAnnotSettings・mergeAnnotUi へ広げる。既定と範囲は renderer/shape-tool-memory.js と
// 同じであること（プロセスが違うので import はできない。test/shape-style-settings.test.js が一致を見張る）。
//
//   annotShapeStyles … { square・circle・line・arrow・cross・polygon: { color, fill, strokeNone, lineStyle, lineWidth, opacity,
//                        fillOpacity, hatch } }。塗りつぶし・枠線のあり・なし・塗りの透明度・ハッチングは、四角・丸・多角形だけで使う
//
// 版 1.4.0 までは、6 つの書き込みツールで 1 つの値（annotColors.shape・annotFills.shape・annotStrokeNone.shape・annotLineStyles.shape・
// annotLineWidth・annotOpacity.shape・annotFillOpacity.shape・annotHatch.shape）を共有していた。種類の欄に受け取れる値が無い時は、
// その共有の値を転記する（版 1.5.0 で初めて起動した時の移し替え。切り替えた直後は今までと同じ値で描く）。共有の値は削除しない。

const { DEFAULT_HATCH_MEMO, fillOpacityOf, pickHatchMemo } = require('./annotation-fill-settings.js');

const SHAPE_STYLE_KINDS = ['square', 'circle', 'line', 'arrow', 'cross', 'polygon'];
const HEX = /^#[0-9a-f]{6}$/i;

// 欄ごとの既定（色は ANNOT_DEFAULTS.annotColors.shape、線の太さは ANNOT_DEFAULTS.annotLineWidth と同じ）。
const DEFAULT_SHAPE_STYLE = Object.freeze({
  color: '#ff0000', fill: null, strokeNone: false, lineStyle: 'solid', lineWidth: 2, opacity: 1, fillOpacity: 1, hatch: DEFAULT_HATCH_MEMO,
});

function objectOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function hexOf(value) {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : undefined;
}

// 欄ごとの受け取り方。受け取れない値は undefined。
const RULES = Object.freeze({
  color: hexOf,
  fill: (value) => (value === null ? null : hexOf(value)),
  strokeNone: (value) => (typeof value === 'boolean' ? value : undefined),
  lineStyle: (value) => (['solid', 'dashed', 'cloudy'].includes(value) ? value : undefined),
  lineWidth: (value) => (Number.isInteger(value) && value >= 1 && value <= 40 ? value : undefined),
  opacity: (value) => fillOpacityOf(value) ?? undefined,
  fillOpacity: (value) => fillOpacityOf(value) ?? undefined,
});

// 版 1.4.0 までの共有の値（ui は annotation-settings.js で受け取った後の値）。
function legacyStyleOf(ui) {
  return {
    color: ui?.annotColors?.shape, fill: ui?.annotFills?.shape, strokeNone: ui?.annotStrokeNone?.shape, lineStyle: ui?.annotLineStyles?.shape,
    lineWidth: ui?.annotLineWidth, opacity: ui?.annotOpacity?.shape, fillOpacity: ui?.annotFillOpacity?.shape, hatch: ui?.annotHatch?.shape,
  };
}

// 1 種類分。欄ごとに raw → fallback → legacy の順で受け取れる値を使い、どれも無ければ既定。塗りつぶしがなしなら枠線は消せない
// （線と塗りつぶしを両方なしにはできない。spec-4b-1b 確定事項4）。
function pickShapeStyle(raw, fallback, legacy) {
  const sources = [objectOf(raw), objectOf(fallback), objectOf(legacy)];
  const picked = {};
  for (const [field, rule] of Object.entries(RULES)) {
    const found = sources.map((source) => rule(source[field])).find((value) => value !== undefined);
    picked[field] = found === undefined ? DEFAULT_SHAPE_STYLE[field] : found;
  }
  picked.hatch = pickHatchMemo(sources[0].hatch, pickHatchMemo(sources[1].hatch, sources[2].hatch));
  if (picked.fill === null)
    picked.strokeNone = false;
  return picked;
}

function pickShapeStyles(raw, fallback, legacy) {
  return Object.fromEntries(SHAPE_STYLE_KINDS.map((kind) => [kind, pickShapeStyle(objectOf(raw)[kind], objectOf(fallback)[kind], legacy)]));
}

function shapeStyleDefaults() {
  return { annotShapeStyles: pickShapeStyles({}, {}, {}) };
}

// 読み込んだ値から取り出す。種類の欄が無ければ、ui の共有の値を転記する。
function pickShapeStyleSettings(source, ui) {
  return { annotShapeStyles: pickShapeStyles(objectOf(source).annotShapeStyles, null, legacyStyleOf(ui)) };
}

// 部分更新。種類ごとに欄を重ね、ハッチングは欄の中まで重ねる（{ square: { hatch: { gap: 8 } } } を送っただけで色が戻らないように）。
function mergeShapeStyleSettings(current, next) {
  const now = objectOf(current.annotShapeStyles);
  const patch = objectOf(next.annotShapeStyles);
  const merged = Object.fromEntries(SHAPE_STYLE_KINDS.map((kind) => {
    const base = objectOf(now[kind]);
    const part = objectOf(patch[kind]);
    return [kind, { ...base, ...part, hatch: { ...objectOf(base.hatch), ...objectOf(part.hatch) } }];
  }));
  return { annotShapeStyles: pickShapeStyles(merged, now, legacyStyleOf(current)) };
}

module.exports = {
  SHAPE_STYLE_KINDS, DEFAULT_SHAPE_STYLE, legacyStyleOf, pickShapeStyle, shapeStyleDefaults, pickShapeStyleSettings, mergeShapeStyleSettings,
};
