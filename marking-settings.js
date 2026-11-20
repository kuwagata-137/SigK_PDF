'use strict';

// マーキングの次に配置する値（形・大きさ・線の太さ）の記憶（spec-7-9 確定事項F5）。annotation-settings.js が ANNOT_DEFAULTS・
// pickAnnotSettings・mergeAnnotUi のキーの並びへ広げる（200 行の目安で分けた）。色と透明度は、ほかの書き込みツールと同じく
// annotColors.marking・annotOpacity.marking に記憶する。
//
//   annotMarking … { shape, outer, dot, ring, cross, fontSize, lineWidth }
//     shape は 'target'・'double'・'crosshair'・'number'・'caution'。大きさは pt で、範囲と既定は renderer/marking-rules.js と同じ
//     （プロセスが違うので import はできない。test/marking-settings.test.js が一致を見張る）。中の円（dot・ring）は外の円以下。
//     線の太さは 1〜40 の整数（ほかの書き込みツールと同じ）

const MARKING_SHAPES = ['target', 'double', 'crosshair', 'number', 'caution'];
const MARKING_RANGES = { outer: [4, 720], dot: [1, 720], ring: [1, 720], cross: [4, 1440], fontSize: [4, 200] };
const MARKING_DEFAULTS = { shape: 'target', outer: 32, dot: 9, ring: 16, cross: 44.8, fontSize: 16, lineWidth: 3 };

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inRange(field, value) {
  const [min, max] = MARKING_RANGES[field];
  return Number.isFinite(value) && value >= min && value <= max;
}

function isLineWidth(value) {
  return Number.isInteger(value) && value >= 1 && value <= 40;
}

// 欄ごとに、受け取れる値なら raw、だめなら fallback、それもだめなら既定。中の円は外の円で頭打ちにする。
function pickMarking(raw, fallback) {
  const source = isPlainObject(raw) ? raw : {};
  const base = isPlainObject(fallback) ? fallback : {};
  const pick = (field, valid) => [source[field], base[field]].find(valid) ?? MARKING_DEFAULTS[field];
  const picked = { shape: pick('shape', (value) => MARKING_SHAPES.includes(value)) };
  for (const field of Object.keys(MARKING_RANGES))
    picked[field] = pick(field, (value) => inRange(field, value));
  picked.dot = Math.min(picked.dot, picked.outer);
  picked.ring = Math.min(picked.ring, picked.outer);
  picked.lineWidth = pick('lineWidth', isLineWidth);
  return picked;
}

function markingDefaults() {
  return { annotMarking: { ...MARKING_DEFAULTS } };
}

// 読み込んだ値から取り出す。fallback は既定。
function pickMarkingSettings(source, fallback) {
  return { annotMarking: pickMarking(source?.annotMarking, fallback?.annotMarking) };
}

// 部分更新。送られた欄だけを今の値に重ねる。
function mergeMarkingSettings(current, next) {
  const merged = { ...(isPlainObject(current?.annotMarking) ? current.annotMarking : {}), ...(isPlainObject(next?.annotMarking) ? next.annotMarking : {}) };
  return { annotMarking: pickMarking(merged, current?.annotMarking) };
}

module.exports = { MARKING_SHAPES, MARKING_RANGES, MARKING_DEFAULTS, markingDefaults, pickMarkingSettings, mergeMarkingSettings };
