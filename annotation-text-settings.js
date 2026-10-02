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

function isFontSize(value) {
  return Number.isFinite(value) && value >= ANNOT_FONT_SIZE_MIN && value <= ANNOT_FONT_SIZE_MAX && Number.isInteger(value / ANNOT_FONT_SIZE_STEP);
}

// 範囲と刻みに合う大きさだけを受け取る。無ければ fallback、それも無ければ既定。
function pickAnnotFontSize(raw, fallback) {
  if (isFontSize(raw))
    return raw;
  return isFontSize(fallback) ? fallback : DEFAULT_ANNOT_FONT_SIZE;
}

module.exports = {
  ANNOT_FONT_SIZES, ANNOT_FONT_SIZE_MIN, ANNOT_FONT_SIZE_MAX, ANNOT_FONT_SIZE_STEP, DEFAULT_ANNOT_FONT_SIZE, pickAnnotFontSize,
};
