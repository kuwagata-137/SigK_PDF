'use strict';

// 塗りの透明度とハッチングの欄の決まりの純粋層（spec-7-9 確定事項B2・C1〜C4）。pdf-lib を知らない。renderer/fill-style.js と同じ
// 決まりで、一致はテストで見張る（プロセスが違うので読み込み合わない）。shape-style-rules.js の styleOf が呼ぶ。
//
//   fillOpacity … 塗りつぶしの不透明度（0 より大きく 1 以下）。無ければ opacity と同じ値
//   hatch       … { pattern, color: '#rrggbb', gap: 1〜50pt, width: 0.25〜10pt }。なしは持たない（null も受ける）
// どちらも塗りを持てる書き込み（四角・丸と、閉じた多角形）だけ。

const { parseColor } = require('./annotation-appearance.js');

const HATCH_PATTERNS = Object.freeze(['diagonal', 'reverse', 'cross', 'horizontal', 'vertical', 'grid']);
const HATCH_GAP_MIN = 1;
const HATCH_GAP_MAX = 50;
const HATCH_WIDTH_MIN = 0.25;
const HATCH_WIDTH_MAX = 10;

function validFillOpacity(value) {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

function validHatch(hatch) {
  return typeof hatch === 'object' && hatch !== null && HATCH_PATTERNS.includes(hatch.pattern) && parseColor(hatch.color) !== null
    && Number.isFinite(hatch.gap) && hatch.gap >= HATCH_GAP_MIN && hatch.gap <= HATCH_GAP_MAX
    && Number.isFinite(hatch.width) && hatch.width >= HATCH_WIDTH_MIN && hatch.width <= HATCH_WIDTH_MAX;
}

// 塗りの欄を読んで描く形にする。{ fillOpacity, hatch（{ pattern, rgb, gap, width } か null） }。形が崩れていれば null。
// fillable は塗りを持てる書き込みか、opacity は枠線の不透明度（0〜1 に収めたもの）。
function fillStyleOf(entry, fillable, opacity) {
  const hatch = entry.hatch ?? null;
  if (entry.fillOpacity !== undefined && !(fillable && validFillOpacity(entry.fillOpacity)))
    return null;
  if (hatch !== null && !(fillable && validHatch(hatch)))
    return null;
  return {
    fillOpacity: fillable ? entry.fillOpacity ?? opacity : opacity,
    hatch: hatch === null ? null : { pattern: hatch.pattern, rgb: parseColor(hatch.color), gap: hatch.gap, width: hatch.width },
  };
}

module.exports = { HATCH_PATTERNS, HATCH_GAP_MIN, HATCH_GAP_MAX, HATCH_WIDTH_MIN, HATCH_WIDTH_MAX, validFillOpacity, validHatch, fillStyleOf };
