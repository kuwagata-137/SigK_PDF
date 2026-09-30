'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-palette.js');

// 書き込みの色のパレット（spec-4b-1b 確定事項10〜13）。値は CheckListMaker の画像エディタと同じ（決定47 ②）。

const palette = globalThis.SigK.annotationPalette;

const luminance = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).reduce((sum, value) => sum + value, 0);

test('テーマの色と標準の色は CheckListMaker の画像エディタと同じ値', () => {
  assert.deepEqual(palette.THEME_COLORS, ['#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47']);
  assert.deepEqual(palette.STANDARD_COLORS, ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0']);
});

test('パレットは 7 段 × 10 列で、上がテーマの色・下が標準の色、どれも凍結されている', () => {
  assert.equal(palette.PALETTE_ROWS.length, 7);
  for (const row of palette.PALETTE_ROWS) {
    assert.equal(row.length, 10);
    assert.ok(Object.isFrozen(row));
    for (const color of row)
      assert.match(color, /^#[0-9a-f]{6}$/);
  }
  assert.ok(Object.isFrozen(palette.PALETTE_ROWS));
  assert.equal(palette.PALETTE_ROWS[0], palette.THEME_COLORS);
  assert.equal(palette.PALETTE_ROWS[6], palette.STANDARD_COLORS);
});

// 既定の色の置き換え先（確定事項14・15）がこの式で作られる濃淡であること。
test('濃淡は列ごとの割合で白か黒へ寄せ、四捨五入する', () => {
  const cell = (row, column) => palette.PALETTE_ROWS[row][column];
  assert.equal(cell(5, 3), '#222a35');
  assert.equal(cell(3, 7), '#ffd966');
  assert.equal(cell(3, 9), '#a9ce91');
  assert.equal(cell(3, 4), '#8faadc');
  assert.equal(cell(1, 0), '#f2f2f2');
  assert.equal(cell(5, 0), '#808080');
  assert.equal(cell(1, 1), '#808080');
  assert.equal(cell(5, 2), '#171717');
  assert.equal(palette.tint('#000000', 1), '#ffffff');
  assert.equal(palette.tint('#ffffff', -1), '#000000');
  assert.deepEqual(palette.tintsOf(7), ['#fff2cc', '#ffe699', '#ffd966', '#bf9000', '#806000']);
});

test('濃淡の向き: 白の列と薄い灰の列は下へ行くほど暗く、黒の列は明るい色から暗い色へ、ほかの列は明るい 3 段と暗い 2 段', () => {
  for (const column of [0, 2]) {
    const tints = palette.tintsOf(column);
    for (let row = 1; row < tints.length; row += 1)
      assert.ok(luminance(tints[row]) < luminance(tints[row - 1]), `${column}:${row}`);
  }
  const black = palette.tintsOf(1);
  for (let row = 1; row < black.length; row += 1)
    assert.ok(luminance(black[row]) < luminance(black[row - 1]), `1:${row}`);
  for (let column = 3; column < 10; column += 1) {
    const base = luminance(palette.THEME_COLORS[column]);
    const tints = palette.tintsOf(column).map(luminance);
    assert.ok(tints.slice(0, 3).every((value) => value > base), `明るい段 ${column}`);
    assert.ok(tints.slice(3).every((value) => value < base), `暗い段 ${column}`);
  }
});

test('色の形の確かめと、画面に見せる名前', () => {
  assert.equal(palette.isHexColor('#C00000'), true);
  assert.equal(palette.isHexColor('#c0000'), false);
  assert.equal(palette.isHexColor('red'), false);
  assert.equal(palette.isHexColor(null), false);
  assert.equal(palette.normalizeHex('#C00000'), '#c00000');
  assert.equal(palette.normalizeHex('#c0000g'), null);
  assert.equal(palette.labelOf('#c00000'), '#C00000');
  assert.equal(palette.labelOf('none'), '');
});

test('パレットの色かどうかは大文字でも見分ける。パレットに無い色は false', () => {
  assert.equal(palette.isPaletteColor('#FFD966'), true);
  assert.equal(palette.isPaletteColor('#ffc000'), true);
  assert.equal(palette.isPaletteColor('#ffa8c8'), false);
  assert.equal(palette.isPaletteColor('#d92c2c'), false);
  assert.equal(palette.isPaletteColor(undefined), false);
});
