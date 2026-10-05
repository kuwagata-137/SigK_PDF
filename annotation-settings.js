'use strict';

// 注釈の設定の既定と検証（spec-4-1 確定事項33・34、spec-4-2 確定事項21・34・35、spec-4-3 確定事項19、
// spec-4-4 確定事項21・39、spec-4b-1b 確定事項14・15・22〜28）。settings.js から移した（spec-4b-1a 確定事項36）。
//
// 色はパレットから選ぶので、#rrggbb ならどれでも受け取って小文字にそろえる。線の太さは 1〜40 の整数、不透明度は 0.1〜1。
// 既定の色・文字の大きさ・図形の種類は renderer/annotation-presets.js と同じであること（プロセスが違うので import は
// できない。test/settings.test.js が一致を見張る）。受け取れない値は、渡された fallback、それも無ければ既定へ落とす。

const { ANNOT_FONT_SIZES, textDefaults, pickTextSettings } = require('./annotation-text-settings.js');

// 候補の色の移し替え（確定事項15）を済ませた設定に書く印。
const ANNOT_PALETTE_VERSION = 1;

// 種類ごとに最後に使った色・図形の塗り（null は塗りなし）・図形の線なし・図形の線種・テキストの文字の大きさ（pt）・
// 図形とペンの線の太さ（pt）・「図形」の道具の種類・道具ごとの不透明度・ノートの作成者。作成者が空ならメインが
// OS のユーザー名で埋めて渡す。既定の色はパレットの色（確定事項14。決定47 ⑧）。
const ANNOT_DEFAULTS = {
  annotColors: { highlight: '#ffd966', underline: '#c00000', strikeout: '#c00000', text: '#222a35', callout: '#222a35', shape: '#c00000', pen: '#c00000', note: '#ffd966' },
  annotFills: { shape: null },
  annotStrokeNone: { shape: false },
  annotLineStyles: { shape: 'solid' },
  ...textDefaults(),
  annotLineWidth: 2,
  annotShapeKind: 'square',
  annotOpacity: { text: 1, callout: 1, shape: 1, pen: 1, note: 1 },
  annotAuthor: '',
  annotPaletteVersion: ANNOT_PALETTE_VERSION,
};

// 今までの候補の色 → いちばん近いパレットの色（確定事項14・15）。桃 #ffa8c8 は近い色が無いので載せない（そのまま残す）。
const LEGACY_COLOR_MAP = Object.freeze({
  '#d92c2c': '#c00000',
  '#1c2430': '#222a35',
  '#ffe45a': '#ffd966',
  '#2c5cd9': '#4472c4',
  '#2f9e5a': '#00b050',
  '#8ce99a': '#a9ce91',
  '#8fbfff': '#8faadc',
});

const ANNOT_LINE_WIDTH_MIN = 1;
const ANNOT_LINE_WIDTH_MAX = 40;
const ANNOT_OPACITY_MIN = 0.1;
const ANNOT_LINE_STYLES = ['solid', 'dashed', 'cloudy'];
const ANNOT_SHAPE_KINDS = ['square', 'circle', 'line', 'arrow', 'cross', 'polygon'];
const ANNOT_AUTHOR_MAX = 100;

const HEX = /^#[0-9a-f]{6}$/i;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectOf(value) {
  return isPlainObject(value) ? value : {};
}

// #rrggbb なら小文字にして返す。色でなければ null。
function normalizeHex(value) {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : null;
}

function isLineWidth(value) {
  return Number.isInteger(value) && value >= ANNOT_LINE_WIDTH_MIN && value <= ANNOT_LINE_WIDTH_MAX;
}

// 範囲にある不透明度を小数 2 桁にそろえて返す。範囲の外は null。
function opacityOf(value) {
  if (!Number.isFinite(value) || value < ANNOT_OPACITY_MIN || value > 1)
    return null;
  return Math.round(value * 100) / 100;
}

// 塗りは #rrggbb か null（塗りなし）。
function isFill(value) {
  return value === null || normalizeHex(value) !== null;
}

// 一覧にある値だけを受け取る。無ければ fallback、それも無ければ既定（線種・図形の種類。文字の大きさは annotation-text-settings.js）。
function pickFromList(list, raw, fallback, fixed) {
  if (list.includes(raw))
    return raw;
  return list.includes(fallback) ? fallback : fixed;
}

function pickAnnotLineWidth(raw, fallback) {
  if (isLineWidth(raw))
    return raw;
  return isLineWidth(fallback) ? fallback : ANNOT_DEFAULTS.annotLineWidth;
}

// 種類ごとの色。#rrggbb なら何でも受け取る。無ければ fallback の値、それも無ければ既定。
function pickAnnotColors(raw, fallback) {
  const source = objectOf(raw);
  const picked = {};
  for (const kind of Object.keys(ANNOT_DEFAULTS.annotColors))
    picked[kind] = normalizeHex(source[kind]) ?? normalizeHex(fallback?.[kind]) ?? ANNOT_DEFAULTS.annotColors[kind];
  return picked;
}

// 移し替えの印が無い（古い）設定の色のうち、今までの候補の色とちょうど同じものをパレットの色へ移す（確定事項15）。
// 自分で選んだほかの色はそのまま。
function migrateColors(raw) {
  if (!isPlainObject(raw))
    return raw;
  return Object.fromEntries(Object.entries(raw).map(([kind, color]) => [kind, LEGACY_COLOR_MAP[normalizeHex(color)] ?? color]));
}

// 図形の塗り。受け取れる値が無ければ既定の null（塗りなし）。
function pickAnnotFills(raw, fallback) {
  const value = [objectOf(raw).shape, fallback?.shape].find(isFill);
  return { shape: value ? normalizeHex(value) : ANNOT_DEFAULTS.annotFills.shape };
}

// 線なし。塗りが無ければ線は消せない（線と塗りを両方なしにはできない。確定事項4・24）。
function pickAnnotStrokeNone(raw, fallback, fills) {
  const value = [objectOf(raw).shape, fallback?.shape].find((item) => typeof item === 'boolean') ?? ANNOT_DEFAULTS.annotStrokeNone.shape;
  return { shape: fills.shape === null ? false : value };
}

function pickAnnotLineStyles(raw, fallback) {
  return { shape: pickFromList(ANNOT_LINE_STYLES, objectOf(raw).shape, fallback?.shape, ANNOT_DEFAULTS.annotLineStyles.shape) };
}

// 道具ごとの不透明度。0.1〜1 なら受け取る。無ければ fallback の値、それも無ければ 1。
function pickAnnotOpacity(raw, fallback) {
  const source = objectOf(raw);
  const picked = {};
  for (const tool of Object.keys(ANNOT_DEFAULTS.annotOpacity))
    picked[tool] = opacityOf(source[tool]) ?? opacityOf(fallback?.[tool]) ?? ANNOT_DEFAULTS.annotOpacity[tool];
  return picked;
}

// 作成者は文字列だけ。前後の空白を落とし、長すぎれば切る。文字列でなければ fallback。
function pickAnnotAuthor(raw, fallback) {
  if (typeof raw !== 'string')
    return typeof fallback === 'string' ? fallback : ANNOT_DEFAULTS.annotAuthor;
  return raw.trim().slice(0, ANNOT_AUTHOR_MAX);
}

// 読み込んだ値（settings.json の中身か、いまの設定）から注釈のキーだけを検証して取り出す。移し替えの印が無ければ
// 候補の色を移し、印を付けて返す（起動時の読み込みで 1 回だけ移る。確定事項15）。
function pickAnnotSettings(source) {
  const raw = objectOf(source);
  const colors = raw.annotPaletteVersion === ANNOT_PALETTE_VERSION ? raw.annotColors : migrateColors(raw.annotColors);
  const annotFills = pickAnnotFills(raw.annotFills, ANNOT_DEFAULTS.annotFills);
  return {
    annotColors: pickAnnotColors(colors, ANNOT_DEFAULTS.annotColors),
    annotFills,
    annotStrokeNone: pickAnnotStrokeNone(raw.annotStrokeNone, ANNOT_DEFAULTS.annotStrokeNone, annotFills),
    annotLineStyles: pickAnnotLineStyles(raw.annotLineStyles, ANNOT_DEFAULTS.annotLineStyles),
    ...pickTextSettings(raw, ANNOT_DEFAULTS),
    annotLineWidth: pickAnnotLineWidth(raw.annotLineWidth, ANNOT_DEFAULTS.annotLineWidth),
    annotShapeKind: pickFromList(ANNOT_SHAPE_KINDS, raw.annotShapeKind, ANNOT_DEFAULTS.annotShapeKind, ANNOT_DEFAULTS.annotShapeKind),
    annotOpacity: pickAnnotOpacity(raw.annotOpacity, ANNOT_DEFAULTS.annotOpacity),
    annotAuthor: pickAnnotAuthor(raw.annotAuthor, ANNOT_DEFAULTS.annotAuthor),
    annotPaletteVersion: ANNOT_PALETTE_VERSION,
  };
}

// 部分更新の注釈のキー。色・塗り・線なし・線種・不透明度は種類（道具）ごとに重ねる。{ annotColors: { highlight } } を
// 送っただけで下線の色が戻らないように。古い settings.json から来た current に無いキーは既定へ落とす。
// 移し替えの印は画面から変えないので返さない（保存するときは今の設定の印がそのまま残る）。
function mergeAnnotUi(current, next) {
  const merged = (key) => ({ ...objectOf(current[key]), ...objectOf(next[key]) });
  const annotFills = pickAnnotFills(merged('annotFills'), current.annotFills);
  return {
    annotColors: pickAnnotColors(merged('annotColors'), current.annotColors),
    annotFills,
    annotStrokeNone: pickAnnotStrokeNone(merged('annotStrokeNone'), current.annotStrokeNone, annotFills),
    annotLineStyles: pickAnnotLineStyles(merged('annotLineStyles'), current.annotLineStyles),
    ...pickTextSettings({ ...next, annotTextStyle: merged('annotTextStyle'), annotCalloutStyle: merged('annotCalloutStyle') }, current),
    annotLineWidth: pickAnnotLineWidth(next.annotLineWidth, current.annotLineWidth),
    annotShapeKind: pickFromList(ANNOT_SHAPE_KINDS, next.annotShapeKind, current.annotShapeKind, ANNOT_DEFAULTS.annotShapeKind),
    annotOpacity: pickAnnotOpacity(merged('annotOpacity'), current.annotOpacity),
    annotAuthor: pickAnnotAuthor(next.annotAuthor, pickAnnotAuthor(current.annotAuthor, ANNOT_DEFAULTS.annotAuthor)),
  };
}

module.exports = {
  ANNOT_PALETTE_VERSION,
  ANNOT_DEFAULTS,
  LEGACY_COLOR_MAP,
  ANNOT_FONT_SIZES,
  ANNOT_LINE_WIDTH_MIN,
  ANNOT_LINE_WIDTH_MAX,
  ANNOT_OPACITY_MIN,
  ANNOT_LINE_STYLES,
  ANNOT_SHAPE_KINDS,
  ANNOT_AUTHOR_MAX,
  pickAnnotAuthor,
  pickAnnotSettings,
  mergeAnnotUi,
};
