'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// テキストの設定の既定と検証（annotation-settings.js から移した）。

const text = require('../annotation-text-settings.js');
const { ANNOT_FONT_SIZES, DEFAULT_ANNOT_FONT_SIZE, pickAnnotFontSize } = text;
const settings = require('../annotation-settings.js');

// 文字の大きさは 8〜200 の 0.5 刻み（spec-4b-4a 確定事項A3）。
test('pickAnnotFontSize は 8〜200・0.5 刻みの大きさを受け取り、無ければ fallback、それも無ければ 12', () => {
  assert.equal(pickAnnotFontSize(10.5, 14), 10.5);
  assert.equal(pickAnnotFontSize(13, 14), 13);
  assert.equal(pickAnnotFontSize(200, 14), 200);
  assert.equal(pickAnnotFontSize(13.3, 14), 14);
  assert.equal(pickAnnotFontSize(201, 14), 14);
  assert.equal(pickAnnotFontSize(7.5, 14), 14);
  assert.equal(pickAnnotFontSize('12', 99), 99);
  assert.equal(pickAnnotFontSize('12', 300), DEFAULT_ANNOT_FONT_SIZE);
});

test('範囲と刻みと一覧はレンダラーのプリセットと同じ', () => {
  assert.equal(text.ANNOT_FONT_SIZE_MIN, 8);
  assert.equal(text.ANNOT_FONT_SIZE_MAX, 200);
  assert.equal(text.ANNOT_FONT_SIZE_STEP, 0.5);
  assert.deepEqual(ANNOT_FONT_SIZES, [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72, 96, 144, 200]);
});

test('annotation-settings.js は同じ一覧と既定を使う', () => {
  assert.deepEqual(settings.ANNOT_FONT_SIZES, ANNOT_FONT_SIZES);
  assert.equal(settings.ANNOT_DEFAULTS.annotFontSize, DEFAULT_ANNOT_FONT_SIZE);
});

// 次に置くテキストの太字・斜体（spec-4b-4a 確定事項H）。
test('pickAnnotTextStyle は真偽値の太字・斜体だけを受け、無ければ fallback、それも無ければ既定（どちらも無し）', () => {
  const { DEFAULT_ANNOT_TEXT_STYLE, pickAnnotTextStyle } = text;
  assert.deepEqual(DEFAULT_ANNOT_TEXT_STYLE, { bold: false, italic: false });
  assert.deepEqual(pickAnnotTextStyle({ bold: true, italic: false, fill: '#ff0000' }), { bold: true, italic: false });
  assert.deepEqual(pickAnnotTextStyle({ bold: 'yes' }, { bold: true, italic: true }), { bold: true, italic: true });
  assert.deepEqual(pickAnnotTextStyle(null, null), { bold: false, italic: false });
  assert.deepEqual(pickAnnotTextStyle([], { bold: 1 }), { bold: false, italic: false });
  assert.deepEqual(settings.ANNOT_DEFAULTS.annotTextStyle, { bold: false, italic: false });
  assert.deepEqual(settings.mergeAnnotUi({ annotTextStyle: { bold: true, italic: false } }, { annotTextStyle: { italic: true } }).annotTextStyle, { bold: true, italic: true });
});
