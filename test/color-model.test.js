'use strict';

// 「色の設定」の画面の色の計算と、一括の組・太さの候補（spec-7-2 確定事項B3・C2・D2）。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-palette.js');
require('../renderer/color-model.js');
const { ANNOT_RECENT_MAX, ANNOT_STYLE_SET_COUNT, ANNOT_DEFAULTS } = require('../annotation-settings.js');

const model = globalThis.SigK.colorModel;
const palette = globalThis.SigK.annotationPalette;

test('RGB と HSL を行き来しても元の色に戻る', () => {
  for (const hex of ['#2e75b6', '#ffffff', '#000000', '#c00000', '#7030a0', '#92d050', '#808080']) {
    const rgb = model.rgbOf(hex);
    assert.equal(model.hexOf(model.hslToRgb(...model.rgbToHsl(...rgb))), hex, hex);
  }
  assert.deepEqual(model.rgbToHsl(255, 0, 0), [0, 1, 0.5]);
  assert.deepEqual(model.hslToRgb(240, 1, 0.5), [0, 0, 255]);
});

test('16 進の欄は「#」を省いた 6 桁も受け、小文字にそろえる。形が違えば null', () => {
  assert.equal(model.parseHex('2E75B6'), '#2e75b6');
  assert.equal(model.parseHex(' #ABCDEF '), '#abcdef');
  for (const bad of ['#12345', '#GGGGGG', '', null, 123, '#1234567'])
    assert.equal(model.parseHex(bad), null, String(bad));
  assert.equal(model.rgbOf('red'), null);
  assert.equal(model.hexOf([300, -5, 12.6]), '#ff000d', '0〜255 に収めて四捨五入する');
});

test('標準のタブは六角形の 127 色と灰色 15 色で、中心は白、灰色は白から黒へ。色は 51 刻み', () => {
  const cells = model.standardCells();
  assert.equal(cells.length, 127 + 15);
  assert.equal(cells.find((cell) => cell.x === 0 && cell.y === 0).color, '#ffffff');
  const grays = cells.slice(127).map((cell) => cell.color);
  assert.equal(grays[0], '#ffffff');
  assert.equal(grays.at(-1), '#000000');
  for (const { color } of cells.slice(0, 127)) {
    for (const value of model.rgbOf(color))
      assert.equal(value % 51, 0, color);
  }
  assert.match(model.hexagonPath(0, 0, 10), /^M0\.00 -10\.00L/);
});

test('一括の組は 7 色 × 3 段（白の塗り／淡い塗り／濃い塗り＋白の文字）で、数は設定の検証と同じ', () => {
  assert.equal(palette.STYLE_SETS.length, 21);
  assert.equal(palette.STYLE_SETS.length, ANNOT_STYLE_SET_COUNT);
  assert.deepEqual({ ...palette.STYLE_SETS[0] }, { fill: '#ffffff', stroke: '#404040', text: null });
  assert.deepEqual({ ...palette.STYLE_SETS[8] }, { fill: '#dae3f3', stroke: '#4472c4', text: null });
  assert.deepEqual({ ...palette.STYLE_SETS[16] }, { fill: '#ed7d31', stroke: '#b25e25', text: '#ffffff' });
  assert.equal(ANNOT_DEFAULTS.annotLastColors.style, 8, '左側の既定は 2 段目の青');
  assert.equal(palette.RECENT_MAX, ANNOT_RECENT_MAX);
});

test('一覧の太さは 1・2・3・4・6・8・12pt で、どれも右パネルで選べる太さ（1〜40 の整数）', () => {
  assert.deepEqual([...palette.LINE_WIDTH_CHOICES], [1, 2, 3, 4, 6, 8, 12]);
  for (const width of palette.LINE_WIDTH_CHOICES)
    assert.ok(Number.isInteger(width) && width >= 1 && width <= 40);
});
