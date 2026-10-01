'use strict';

// 図形の見た目の欄（線の色・塗り・線種・破線の間隔・雲形の強さ）の決まりの純粋層（spec-4b-1b 確定事項16〜21・32・33）。
// pdf-lib を知らない。renderer/shape-style.js と同じ決まりで、一致はテストで見張る（プロセスが違うので読み込み合わない）。
// 図形・ペンの entry の形（isShapeEntry・validPaths）は shape-appearance.js から移した（spec-4b-2。200 行の目安）。
//
//   四角・丸   … color は '#rrggbb' か null（線なし。そのときは fill が要る）、fill は '#rrggbb' か null、
//                lineStyle は 'solid'・'dashed'・'cloudy'
//   直線・矢印 … color は '#rrggbb'、lineStyle は 'solid'・'dashed'
//   ペン       … 線種を持たない（実線）
//   dash は破線のときだけの、線の太さに対する倍数（無ければ 3:2）。cloudIntensity は雲形のときだけの強さ（無ければ 1）。

const { parseColor } = require('./annotation-appearance.js');

// 図形・ペンの種類（shape-appearance.js が同じ名前で公開する）。
const KINDS = Object.freeze(['square', 'circle', 'line', 'arrow', 'ink']);
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

function isPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
}

// 点列は 1 本以上で各 path が 2 点以上。直線・矢印は 1 本ちょうどで 2 点（renderer/annotation-entry-rules.js と同じ約束）。
function validPaths(kind, paths) {
  if (!Array.isArray(paths) || paths.length === 0)
    return false;
  if (!paths.every((path) => Array.isArray(path) && path.length >= 2 && path.every(isPoint)))
    return false;
  return kind === 'ink' || (paths.length === 1 && paths[0].length === 2);
}

// 図形・ペンの entry の形。線幅が正、/Rect が 4 つの数、見た目の欄が決まりどおり、点列は種類ごとの形。
function isShapeEntry(entry) {
  if (!KINDS.includes(entry?.kind) || !Number.isFinite(entry.lineWidth) || entry.lineWidth <= 0)
    return false;
  if (!Array.isArray(entry.rect) || entry.rect.length !== 4 || !entry.rect.every(Number.isFinite))
    return false;
  if (styleOf(entry) === null)
    return false;
  // 角度は四角・丸だけが、0 以上 360 未満の数で持てる（spec-4b-2 確定事項1）。
  if (entry.angle !== undefined && !(BOXED_KINDS.includes(entry.kind) && Number.isFinite(entry.angle) && entry.angle >= 0 && entry.angle < 360))
    return false;
  return BOXED_KINDS.includes(entry.kind) ? true : validPaths(entry.kind, entry.paths);
}

module.exports = { KINDS, BOXED_KINDS, validPaths, isShapeEntry, LINE_STYLES, DEFAULT_DASH, DEFAULT_CLOUD_INTENSITY, lineStylesOf, validDash, validCloudIntensity, styleOf };
