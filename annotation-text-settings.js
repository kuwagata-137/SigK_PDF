'use strict';

// テキストの設定の既定と検証（spec-4-2 確定事項21・34）。annotation-settings.js から移した（spec-4b-4a。200 行の目安。中身は
// 変えていない）。既定の大きさと一覧は renderer/annotation-presets.js と同じであること（プロセスが違うので import はできない。
// test/settings.test.js が一致を見張る）。

const ANNOT_FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48];
const DEFAULT_ANNOT_FONT_SIZE = 12;

// 一覧にある大きさだけを受け取る。無ければ fallback、それも無ければ既定。
function pickAnnotFontSize(raw, fallback) {
  if (ANNOT_FONT_SIZES.includes(raw))
    return raw;
  return ANNOT_FONT_SIZES.includes(fallback) ? fallback : DEFAULT_ANNOT_FONT_SIZE;
}

module.exports = { ANNOT_FONT_SIZES, DEFAULT_ANNOT_FONT_SIZE, pickAnnotFontSize };
