'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// テキストの設定の既定と検証（annotation-settings.js から移した）。

const { ANNOT_FONT_SIZES, DEFAULT_ANNOT_FONT_SIZE, pickAnnotFontSize } = require('../annotation-text-settings.js');
const settings = require('../annotation-settings.js');

test('pickAnnotFontSize は一覧の大きさを受け取り、無ければ fallback、それも無ければ 12', () => {
  assert.equal(pickAnnotFontSize(10.5, 14), 10.5);
  assert.equal(pickAnnotFontSize(13, 14), 14);
  assert.equal(pickAnnotFontSize('12', 99), DEFAULT_ANNOT_FONT_SIZE);
});

test('annotation-settings.js は同じ一覧と既定を使う', () => {
  assert.deepEqual(settings.ANNOT_FONT_SIZES, ANNOT_FONT_SIZES);
  assert.equal(settings.ANNOT_DEFAULTS.annotFontSize, DEFAULT_ANNOT_FONT_SIZE);
});
