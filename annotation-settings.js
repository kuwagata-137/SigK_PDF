'use strict';

// 注釈の設定の既定と検証（spec-4-1 確定事項33・34、spec-4-2 確定事項21・34・35、spec-4-3 確定事項19・29、
// spec-4-4 確定事項21・38・39）。settings.js から移した（spec-4b-1a 確定事項36。中身は変えていない）。
//
// 候補の並びは renderer/annotation-presets.js と同じであること（プロセスが違うので import はできない。
// test/settings.test.js が一致を見張る）。候補に無い値は、渡された fallback、それも無ければ既定へ落とす。

// 種類ごとに最後に使った色（値は #rrggbb）・テキストの文字の大きさ（pt）・図形とペンの線の太さ（pt）・
// 「図形」の道具の種類・道具ごとの不透明度・ノートの作成者。作成者が空ならメインが OS のユーザー名で埋めて渡す。
const ANNOT_DEFAULTS = {
  annotColors: { highlight: '#ffe45a', underline: '#d92c2c', strikeout: '#d92c2c', text: '#1c2430', shape: '#d92c2c', pen: '#d92c2c', note: '#ffe45a' },
  annotFontSize: 12,
  annotLineWidth: 2,
  annotShapeKind: 'square',
  annotOpacity: { text: 1, shape: 1, pen: 1, note: 1 },
  annotAuthor: '',
};

const ANNOT_COLORS = {
  highlight: ['#ffe45a', '#8ce99a', '#8fbfff', '#ffa8c8'],
  underline: ['#d92c2c', '#2c5cd9', '#1c2430'],
  strikeout: ['#d92c2c', '#2c5cd9', '#1c2430'],
  text: ['#1c2430', '#d92c2c', '#2c5cd9'],
  shape: ['#d92c2c', '#2c5cd9', '#2f9e5a', '#1c2430'],
  pen: ['#d92c2c', '#2c5cd9', '#2f9e5a', '#1c2430'],
  note: ['#ffe45a', '#8ce99a', '#8fbfff', '#ffa8c8'],
};
const ANNOT_FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48];
const ANNOT_LINE_WIDTHS = [1, 2, 3, 5, 8];
const ANNOT_SHAPE_KINDS = ['square', 'circle', 'line', 'arrow'];
const ANNOT_OPACITIES = [1, 0.75, 0.5, 0.25];
const ANNOT_AUTHOR_MAX = 100;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 一覧にある値だけを受け取る。無ければ fallback、それも無ければ既定（線の太さ・図形の種類）。
function pickFromList(list, raw, fallback, fixed) {
  if (list.includes(raw))
    return raw;
  return list.includes(fallback) ? fallback : fixed;
}

// プリセットにある大きさだけを受け取る。無ければ fallback、それも無ければ既定。
function pickAnnotFontSize(raw, fallback) {
  return pickFromList(ANNOT_FONT_SIZES, raw, fallback, ANNOT_DEFAULTS.annotFontSize);
}

// 種類ごとに、プリセットにある色だけを受け取る。無ければ fallback の値。
function pickAnnotColors(raw, fallback) {
  const source = isPlainObject(raw) ? raw : {};
  const picked = {};
  for (const kind of Object.keys(ANNOT_COLORS)) {
    picked[kind] = ANNOT_COLORS[kind].includes(source[kind])
      ? source[kind]
      : (ANNOT_COLORS[kind].includes(fallback?.[kind]) ? fallback[kind] : ANNOT_DEFAULTS.annotColors[kind]);
  }
  return picked;
}

// 道具ごとに、プリセットにある不透明度だけを受け取る。無ければ fallback の値、それも無ければ 1。
function pickAnnotOpacity(raw, fallback) {
  const source = isPlainObject(raw) ? raw : {};
  const picked = {};
  for (const tool of Object.keys(ANNOT_DEFAULTS.annotOpacity)) {
    picked[tool] = ANNOT_OPACITIES.includes(source[tool])
      ? source[tool]
      : (ANNOT_OPACITIES.includes(fallback?.[tool]) ? fallback[tool] : ANNOT_DEFAULTS.annotOpacity[tool]);
  }
  return picked;
}

// 作成者は文字列だけ。前後の空白を落とし、長すぎれば切る。文字列でなければ fallback。
function pickAnnotAuthor(raw, fallback) {
  if (typeof raw !== 'string')
    return typeof fallback === 'string' ? fallback : ANNOT_DEFAULTS.annotAuthor;
  return raw.trim().slice(0, ANNOT_AUTHOR_MAX);
}

// 読み込んだ値（settings.json の中身か、いまの設定）から注釈のキーだけを検証して取り出す。
function pickAnnotSettings(source) {
  const raw = isPlainObject(source) ? source : {};
  return {
    annotColors: pickAnnotColors(raw.annotColors, ANNOT_DEFAULTS.annotColors),
    annotFontSize: pickAnnotFontSize(raw.annotFontSize, ANNOT_DEFAULTS.annotFontSize),
    annotLineWidth: pickFromList(ANNOT_LINE_WIDTHS, raw.annotLineWidth, ANNOT_DEFAULTS.annotLineWidth, ANNOT_DEFAULTS.annotLineWidth),
    annotShapeKind: pickFromList(ANNOT_SHAPE_KINDS, raw.annotShapeKind, ANNOT_DEFAULTS.annotShapeKind, ANNOT_DEFAULTS.annotShapeKind),
    annotOpacity: pickAnnotOpacity(raw.annotOpacity, ANNOT_DEFAULTS.annotOpacity),
    annotAuthor: pickAnnotAuthor(raw.annotAuthor, ANNOT_DEFAULTS.annotAuthor),
  };
}

// 部分更新の注釈のキー。色と不透明度は種類（道具）ごとに重ねる。{ annotColors: { highlight } } を送っただけで
// 下線の色が戻らないように。古い settings.json から来た current に無いキーは既定へ落とす。
function mergeAnnotUi(current, next) {
  return {
    annotColors: pickAnnotColors({ ...(isPlainObject(current.annotColors) ? current.annotColors : {}), ...(isPlainObject(next.annotColors) ? next.annotColors : {}) }, current.annotColors),
    annotFontSize: pickAnnotFontSize(next.annotFontSize, current.annotFontSize),
    annotLineWidth: pickFromList(ANNOT_LINE_WIDTHS, next.annotLineWidth, current.annotLineWidth, ANNOT_DEFAULTS.annotLineWidth),
    annotShapeKind: pickFromList(ANNOT_SHAPE_KINDS, next.annotShapeKind, current.annotShapeKind, ANNOT_DEFAULTS.annotShapeKind),
    annotOpacity: pickAnnotOpacity({ ...(isPlainObject(current.annotOpacity) ? current.annotOpacity : {}), ...(isPlainObject(next.annotOpacity) ? next.annotOpacity : {}) }, current.annotOpacity),
    annotAuthor: pickAnnotAuthor(next.annotAuthor, pickAnnotAuthor(current.annotAuthor, ANNOT_DEFAULTS.annotAuthor)),
  };
}

module.exports = {
  ANNOT_DEFAULTS,
  ANNOT_COLORS,
  ANNOT_FONT_SIZES,
  ANNOT_LINE_WIDTHS,
  ANNOT_SHAPE_KINDS,
  ANNOT_OPACITIES,
  ANNOT_AUTHOR_MAX,
  pickAnnotAuthor,
  pickAnnotSettings,
  mergeAnnotUi,
};
