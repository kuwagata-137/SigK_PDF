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
// 決定102 ⑥で、外の円 100・中の円 15・十字線 150（外の円の 1.5 倍）、二重丸の中の円と番号付き丸の文字サイズ 50（質問 MK2 案A）に変更した。
const MARKING_DEFAULTS = { shape: 'target', outer: 100, dot: 15, ring: 50, cross: 150, fontSize: 50, lineWidth: 3 };
// 1.4.0 の既定（決定101）。settings.json には、既定の値もそのまま書かれている（settings.js の save）。
const LEGACY_MARKING_DEFAULTS = Object.freeze({ outer: 32, dot: 9, ring: 16, cross: 44.8, fontSize: 16 });
// この版の移し替えを済ませた印（annotation-settings.js の annotPaletteVersion）。
const MARKING_MIGRATED_VERSION = 3;

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

// 移し替えの印が 3 より前の設定で、1.4.0 の既定と同じ値の欄だけを新しい既定へ置き換える（決定102 ⑥。Claude の判断）。自分で変えた値は
// そのまま。置き換えないと、1.4.0 を起動したことがある人には新しい既定が効かない。印が整数でなければ、印が無いのと同じに扱う。
function migrateMarking(raw, version) {
  const from = Number.isInteger(version) ? version : 0;
  if (!isPlainObject(raw) || from >= MARKING_MIGRATED_VERSION)
    return raw;
  const next = { ...raw };
  for (const [field, legacy] of Object.entries(LEGACY_MARKING_DEFAULTS)) {
    if (next[field] === legacy)
      next[field] = MARKING_DEFAULTS[field];
  }
  return next;
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

module.exports = {
  MARKING_SHAPES, MARKING_RANGES, MARKING_DEFAULTS, LEGACY_MARKING_DEFAULTS, MARKING_MIGRATED_VERSION,
  markingDefaults, migrateMarking, pickMarkingSettings, mergeMarkingSettings,
};
