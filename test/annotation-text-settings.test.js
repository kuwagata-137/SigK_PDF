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

// 次に置くテキストの書式（spec-4b-4a 確定事項H）。
const STYLE_DEFAULT = { bold: false, italic: false, fill: null, border: null, borderWidth: 1 };

test('pickAnnotTextStyle は太字・斜体の真偽値、塗り・枠線の #rrggbb か null、枠線の太さ 1〜40 の整数だけを受ける', () => {
  const { DEFAULT_ANNOT_TEXT_STYLE, pickAnnotTextStyle } = text;
  assert.deepEqual(DEFAULT_ANNOT_TEXT_STYLE, STYLE_DEFAULT);
  assert.deepEqual(pickAnnotTextStyle({ bold: true, italic: false, fill: '#FFF2CC', border: '#c00000', borderWidth: 3, size: 9 }),
    { bold: true, italic: false, fill: '#fff2cc', border: '#c00000', borderWidth: 3 });
  assert.deepEqual(pickAnnotTextStyle({ bold: 'yes', fill: 'red', borderWidth: 41 }, { ...STYLE_DEFAULT, bold: true, fill: '#ffff00', borderWidth: 2 }),
    { ...STYLE_DEFAULT, bold: true, fill: '#ffff00', borderWidth: 2 });
  assert.deepEqual(pickAnnotTextStyle({ border: null, borderWidth: 2.5 }, { ...STYLE_DEFAULT, border: '#000000' }), { ...STYLE_DEFAULT, border: null });
  assert.deepEqual(pickAnnotTextStyle(null, null), STYLE_DEFAULT);
  assert.deepEqual(pickAnnotTextStyle([], { bold: 1 }), STYLE_DEFAULT);
  assert.deepEqual(settings.ANNOT_DEFAULTS.annotTextStyle, STYLE_DEFAULT);
  assert.deepEqual(settings.mergeAnnotUi({ annotTextStyle: { ...STYLE_DEFAULT, bold: true } }, { annotTextStyle: { italic: true, border: '#4472c4' } }).annotTextStyle,
    { ...STYLE_DEFAULT, bold: true, italic: true, border: '#4472c4' });
});

// テキストのキーの既定と取り出し（spec-4b-4b で annotation-settings.js からまとめた）。
test('textDefaults と pickTextSettings は文字の大きさと書式のキーを並びのまま組み、受け取れない値は fallback へ落とす', () => {
  const { textDefaults, pickTextSettings } = text;
  const CALLOUT = { fontSize: 12, bold: false, italic: false, fill: '#ffffff', border: '#c00000', borderWidth: 1.5 };
  assert.deepEqual(Object.keys(textDefaults()), ['annotFontSize', 'annotTextStyle', 'annotCalloutStyle']);
  assert.deepEqual(textDefaults(), { annotFontSize: 12, annotTextStyle: STYLE_DEFAULT, annotCalloutStyle: CALLOUT });
  assert.notEqual(textDefaults().annotTextStyle, textDefaults().annotTextStyle);
  assert.deepEqual(pickTextSettings({ annotFontSize: 9.5, annotTextStyle: { bold: true } }, textDefaults()),
    { annotFontSize: 9.5, annotTextStyle: { ...STYLE_DEFAULT, bold: true }, annotCalloutStyle: CALLOUT });
  assert.deepEqual(pickTextSettings({ annotFontSize: 7 }, { annotFontSize: 14, annotTextStyle: { ...STYLE_DEFAULT, italic: true } }),
    { annotFontSize: 14, annotTextStyle: { ...STYLE_DEFAULT, italic: true }, annotCalloutStyle: CALLOUT });
  assert.deepEqual(pickTextSettings({}, undefined), textDefaults());
});

// 次に置く吹き出しの書式（spec-4b-4b 確定事項F3）。テキストの書式の決まりに、文字の大きさと既定の枠線の太さ 1.5 を足したもの。
test('pickAnnotCalloutStyle は大きさ・書式・塗り・枠線を受け、枠線の太さは 1〜40 の整数か既定の 1.5 だけを受ける', () => {
  const { DEFAULT_ANNOT_CALLOUT_STYLE, pickAnnotCalloutStyle } = text;
  const CALLOUT = { fontSize: 12, bold: false, italic: false, fill: '#ffffff', border: '#c00000', borderWidth: 1.5 };
  assert.deepEqual(DEFAULT_ANNOT_CALLOUT_STYLE, CALLOUT);
  assert.deepEqual(pickAnnotCalloutStyle({ fontSize: 14, bold: true, fill: null, border: '#2F5597', borderWidth: 3 }),
    { ...CALLOUT, fontSize: 14, bold: true, fill: null, border: '#2f5597', borderWidth: 3 });
  assert.deepEqual(pickAnnotCalloutStyle({ fontSize: 7, borderWidth: 2.5 }), CALLOUT);
  assert.deepEqual(pickAnnotCalloutStyle({ borderWidth: 1.5 }, { ...CALLOUT, borderWidth: 4 }), CALLOUT);
  assert.deepEqual(settings.mergeAnnotUi({ annotCalloutStyle: { ...CALLOUT, bold: true } }, { annotCalloutStyle: { fill: '#ddebf7' } }).annotCalloutStyle,
    { ...CALLOUT, bold: true, fill: '#ddebf7' });
});
