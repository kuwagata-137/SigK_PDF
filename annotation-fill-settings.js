'use strict';

// 図形の塗りの透明度とハッチングの、次に追加する書き込みの値の既定と検証（spec-7-9 確定事項B2・C3）。annotation-settings.js が
// ANNOT_DEFAULTS・pickAnnotSettings・mergeAnnotUi のキーの並びへ広げる（200 行の目安で分けた）。範囲と既定は
// renderer/fill-style.js と同じであること（プロセスが違うので import はできない。test/annotation-fill-settings.test.js が一致を見張る）。
//
//   annotFillOpacity … { shape: 0.1〜1 }。既定 1
//   annotHatch       … { shape: { pattern: 'none' か種類, color: '#rrggbb', gap: 1〜50, width: 0.25〜10 } }。種類がなしでも、
//                      色・間隔・線幅は記憶する（次にハッチングを選んだ時に使う）

const HATCH_PATTERNS = ['none', 'diagonal', 'reverse', 'cross', 'horizontal', 'vertical', 'grid'];
const DEFAULT_FILL_OPACITY = 1;
const DEFAULT_HATCH_MEMO = Object.freeze({ pattern: 'none', color: '#ff0000', gap: 6, width: 1 });
const HEX = /^#[0-9a-f]{6}$/i;

const HATCH_RULES = Object.freeze({
  pattern: (value) => HATCH_PATTERNS.includes(value),
  color: (value) => typeof value === 'string' && HEX.test(value),
  gap: (value) => Number.isFinite(value) && value >= 1 && value <= 50,
  width: (value) => Number.isFinite(value) && value >= 0.25 && value <= 10,
});

function objectOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

// 範囲にある不透明度を小数 2 桁にそろえて返す。範囲の外は null。
function fillOpacityOf(value) {
  if (!Number.isFinite(value) || value < 0.1 || value > 1)
    return null;
  return Math.round(value * 100) / 100;
}

function pickFillOpacity(raw, fallback) {
  return { shape: fillOpacityOf(objectOf(raw).shape) ?? fillOpacityOf(fallback?.shape) ?? DEFAULT_FILL_OPACITY };
}

// ハッチングの記憶 1 つ（{ pattern, color, gap, width }）を欄ごとに受け取る。受け取れない欄は base、それも無ければ既定。
// 色は小文字にそろえる。図形の書き込みツールごとの記憶（shape-style-settings.js。決定102 ⑨）も使う。
function pickHatchMemo(raw, base) {
  const source = objectOf(raw);
  const fallback = objectOf(base);
  const picked = {};
  for (const [field, valid] of Object.entries(HATCH_RULES)) {
    const value = [source[field], fallback[field]].find(valid) ?? DEFAULT_HATCH_MEMO[field];
    picked[field] = typeof value === 'string' ? value.toLowerCase() : value;
  }
  return picked;
}

// 欄ごとに受け取る。受け取れない欄は fallback、それも無ければ既定。色は小文字にそろえる。
function pickHatch(raw, fallback) {
  return { shape: pickHatchMemo(objectOf(raw).shape, objectOf(fallback).shape) };
}

function fillDefaults() {
  return { annotFillOpacity: { shape: DEFAULT_FILL_OPACITY }, annotHatch: { shape: { ...DEFAULT_HATCH_MEMO } } };
}

// 読み込んだ値から取り出す。fallback は今の値（部分更新）か既定。
function pickFillSettings(source, fallback) {
  return {
    annotFillOpacity: pickFillOpacity(source.annotFillOpacity, fallback?.annotFillOpacity),
    annotHatch: pickHatch(source.annotHatch, fallback?.annotHatch),
  };
}

// 部分更新。ハッチングは欄ごとに今の値へ重ねる（{ annotHatch: { shape: { gap: 8 } } } を送っただけで色が戻らないように）。
function mergeFillSettings(current, next) {
  const hatch = { shape: { ...objectOf(objectOf(current.annotHatch).shape), ...objectOf(objectOf(next.annotHatch).shape) } };
  const opacity = { ...objectOf(current.annotFillOpacity), ...objectOf(next.annotFillOpacity) };
  return pickFillSettings({ annotFillOpacity: opacity, annotHatch: hatch }, { annotFillOpacity: current.annotFillOpacity, annotHatch: current.annotHatch });
}

module.exports = { HATCH_PATTERNS, DEFAULT_FILL_OPACITY, DEFAULT_HATCH_MEMO, fillDefaults, pickFillSettings, mergeFillSettings, fillOpacityOf, pickHatchMemo };
