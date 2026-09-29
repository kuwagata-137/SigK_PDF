'use strict';

// 図形の見た目の欄（線の色・塗り・線種・破線の間隔・雲形の強さ）の決まりの純粋層（spec-4b-1b 確定事項16〜21・32・33）。
// pdf-lib を知らない。renderer/shape-style.js と同じ決まりで、一致はテストで見張る（プロセスが違うので読み込み合わない）。
//
//   四角・丸   … color は '#rrggbb' か null（線なし。そのときは fill が要る）、fill は '#rrggbb' か null、
//                lineStyle は 'solid'・'dashed'・'cloudy'
//   直線・矢印 … color は '#rrggbb'、lineStyle は 'solid'・'dashed'
//   ペン       … 線種を持たない（実線）
//   dash は破線のときだけの、線の太さに対する倍数（無ければ 3:2）。cloudIntensity は雲形のときだけの強さ（無ければ 1）。

const { parseColor } = require('./annotation-appearance.js');

const BOXED_KINDS = Object.freeze(['square', 'circle']);
const LINE_KINDS = Object.freeze(['line', 'arrow']);
const LINE_STYLES = Object.freeze(['solid', 'dashed', 'cloudy']);
const DEFAULT_DASH = Object.freeze([3, 2]);
const DEFAULT_CLOUD_INTENSITY = 1;
const DASH_ITEMS_MAX = 8;
const DASH_RATIO_MAX = 100;
const DASH_SUM_MIN = 0.1;
const CLOUD_INTENSITY_MAX = 2;

function lineStylesOf(kind) {
  if (BOXED_KINDS.includes(kind))
    return LINE_STYLES;
  return LINE_KINDS.includes(kind) ? LINE_STYLES.slice(0, 2) : ['solid'];
}

function validDash(dash) {
  return Array.isArray(dash) && dash.length >= 1 && dash.length <= DASH_ITEMS_MAX
    && dash.every((value) => Number.isFinite(value) && value >= 0 && value <= DASH_RATIO_MAX)
    && dash.reduce((sum, value) => sum + value, 0) >= DASH_SUM_MIN;
}

function validCloudIntensity(value) {
  return Number.isFinite(value) && value > 0 && value <= CLOUD_INTENSITY_MAX;
}

// 線と塗りの色（0〜1 の RGB。無ければ null）。読めない色・組み合わせなら null を返す（線と塗りを両方なしにはできない）。
function colorsOf(entry) {
  const boxed = BOXED_KINDS.includes(entry.kind);
  const hasFill = entry.fill !== undefined && entry.fill !== null;
  const fill = hasFill ? parseColor(entry.fill) : null;
  if (hasFill && (!boxed || fill === null))
    return null;
  if (entry.color === null)
    return boxed && fill !== null ? { stroke: null, fill } : null;
  const stroke = parseColor(entry.color);
  return stroke === null ? null : { stroke, fill };
}

// 見た目の欄を読んで描く形にする。形が崩れていれば null。
//   { stroke, fill, lineStyle, dash（描く間隔 pt。破線でなければ null）, cloudIntensity（雲形でなければ null） }
function styleOf(entry) {
  const colors = colorsOf(entry);
  if (colors === null)
    return null;
  const lineStyle = entry.lineStyle ?? 'solid';
  if (!lineStylesOf(entry.kind).includes(lineStyle))
    return null;
  if (entry.dash !== undefined && (lineStyle !== 'dashed' || !validDash(entry.dash)))
    return null;
  if (entry.cloudIntensity !== undefined && (lineStyle !== 'cloudy' || !validCloudIntensity(entry.cloudIntensity)))
    return null;
  return {
    ...colors,
    lineStyle,
    dash: lineStyle === 'dashed' ? (entry.dash ?? DEFAULT_DASH).map((ratio) => ratio * entry.lineWidth) : null,
    cloudIntensity: lineStyle === 'cloudy' ? (entry.cloudIntensity ?? DEFAULT_CLOUD_INTENSITY) : null,
  };
}

module.exports = { BOXED_KINDS, LINE_STYLES, DEFAULT_DASH, DEFAULT_CLOUD_INTENSITY, lineStylesOf, validDash, validCloudIntensity, styleOf };
