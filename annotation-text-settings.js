'use strict';

// テキストの設定の既定と検証（spec-4-2 確定事項21・34、spec-4b-4a 確定事項A3・H）。annotation-settings.js から移した（spec-4b-4a。
// 200 行の目安）。既定の大きさ・範囲・一覧は renderer/annotation-presets.js と同じであること（プロセスが違うので import はできない。
// test/settings.test.js が一致を見張る）。

// 文字の大きさは 8〜200 の 0.5 刻み（spec-4b-4a 確定事項A3）。一覧は右パネルの「よく使う大きさ」。
const ANNOT_FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72, 96, 144, 200];
const ANNOT_FONT_SIZE_MIN = 8;
const ANNOT_FONT_SIZE_MAX = 200;
const ANNOT_FONT_SIZE_STEP = 0.5;
const DEFAULT_ANNOT_FONT_SIZE = 12;

// 次に置くテキストの書式（spec-4b-4a 確定事項H1・H2）。既定は太字なし・斜体なし・塗りなし・枠線なし・枠線の太さ 1。
// border は枠線の色、borderWidth は枠線を付けるときの太さ（図形の線の太さと同じ 1〜40 の整数）。
const DEFAULT_ANNOT_TEXT_STYLE = Object.freeze({ bold: false, italic: false, fill: null, border: null, borderWidth: 1 });
// 次に置く吹き出しの書式（spec-4b-4b 確定事項F2・F3。決定57 ⑪）。文字の大きさも持つ（テキストと別に覚える）。枠線の太さは既定の 1.5 も受ける。
const DEFAULT_ANNOT_CALLOUT_STYLE = Object.freeze({ fontSize: 12, bold: false, italic: false, fill: '#ffffff', border: '#c00000', borderWidth: 1.5 });
const CALLOUT_BORDER_WIDTH = 1.5;
const HEX = /^#[0-9a-f]{6}$/i;

function isFontSize(value) {
  return Number.isFinite(value) && value >= ANNOT_FONT_SIZE_MIN && value <= ANNOT_FONT_SIZE_MAX && Number.isInteger(value / ANNOT_FONT_SIZE_STEP);
}

// 範囲と刻みに合う大きさだけを受け取る。無ければ fallback、それも無ければ既定。
function pickAnnotFontSize(raw, fallback) {
  if (isFontSize(raw))
    return raw;
  return isFontSize(fallback) ? fallback : DEFAULT_ANNOT_FONT_SIZE;
}

// 欄ごとの受け取れる値。色は #rrggbb（小文字にそろえる）か null。
const TEXT_STYLE_RULES = Object.freeze({
  bold: (value) => typeof value === 'boolean',
  italic: (value) => typeof value === 'boolean',
  fill: (value) => value === null || (typeof value === 'string' && HEX.test(value)),
  border: (value) => value === null || (typeof value === 'string' && HEX.test(value)),
  borderWidth: (value) => Number.isInteger(value) && value >= 1 && value <= 40,
});

const CALLOUT_STYLE_RULES = Object.freeze({
  fontSize: isFontSize,
  ...TEXT_STYLE_RULES,
  borderWidth: (value) => TEXT_STYLE_RULES.borderWidth(value) || value === CALLOUT_BORDER_WIDTH,
});

// 欄ごとの決まり rules で書式を受け取る。受け取れない欄は fallback（それも無ければ既定 defaults）。知らない欄は持ち込まない。
function pickStyle(raw, fallback, rules, defaults) {
  const source = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  const base = typeof fallback === 'object' && fallback !== null ? fallback : defaults;
  const picked = {};
  for (const [field, valid] of Object.entries(rules)) {
    // null（塗りなし・枠線なし）も受け取れる値なので、?? ではなく見つかったかどうかで既定へ落とす。
    const found = [source[field], base[field]].find((candidate) => candidate !== undefined && valid(candidate));
    const value = found === undefined ? defaults[field] : found;
    picked[field] = typeof value === 'string' ? value.toLowerCase() : value;
  }
  return picked;
}

function pickAnnotTextStyle(raw, fallback) {
  return pickStyle(raw, fallback, TEXT_STYLE_RULES, DEFAULT_ANNOT_TEXT_STYLE);
}

function pickAnnotCalloutStyle(raw, fallback) {
  return pickStyle(raw, fallback, CALLOUT_STYLE_RULES, DEFAULT_ANNOT_CALLOUT_STYLE);
}

// テキストのキー（文字の大きさ・次に置くテキストの書式・次に置く吹き出しの書式）の既定と取り出し。annotation-settings.js の ANNOT_DEFAULTS・
// pickAnnotSettings・mergeAnnotUi が、キーの並びの位置へ広げる（spec-4b-4b。テキストのキーをここにまとめる）。source の annotTextStyle・
// annotCalloutStyle は、部分更新なら今の値に重ねたもの。受け取れない値は fallback（それも無ければ既定）。
function textDefaults() {
  return { annotFontSize: DEFAULT_ANNOT_FONT_SIZE, annotTextStyle: { ...DEFAULT_ANNOT_TEXT_STYLE }, annotCalloutStyle: { ...DEFAULT_ANNOT_CALLOUT_STYLE } };
}

function pickTextSettings(source, fallback) {
  return {
    annotFontSize: pickAnnotFontSize(source.annotFontSize, fallback?.annotFontSize),
    annotTextStyle: pickAnnotTextStyle(source.annotTextStyle, fallback?.annotTextStyle),
    annotCalloutStyle: pickAnnotCalloutStyle(source.annotCalloutStyle, fallback?.annotCalloutStyle),
  };
}

module.exports = {
  ANNOT_FONT_SIZES, ANNOT_FONT_SIZE_MIN, ANNOT_FONT_SIZE_MAX, ANNOT_FONT_SIZE_STEP, DEFAULT_ANNOT_FONT_SIZE, DEFAULT_ANNOT_TEXT_STYLE,
  DEFAULT_ANNOT_CALLOUT_STYLE, pickAnnotFontSize, pickAnnotTextStyle, pickAnnotCalloutStyle, textDefaults, pickTextSettings,
};
