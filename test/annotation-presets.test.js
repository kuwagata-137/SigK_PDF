'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-presets.js');

// 注釈のプリセット（spec-4-1 確定事項33、spec-4-2 確定事項34・35）。
// settings.js との一致は test/settings.test.js が見張る。

const presets = globalThis.SigK.annotationPresets;

test('道具は 4 つで、マークアップは先頭の 3 つ', () => {
  assert.deepEqual(presets.TOOLS, ['highlight', 'underline', 'strikeout', 'text']);
  assert.deepEqual(presets.MARKUP_TOOLS, ['highlight', 'underline', 'strikeout']);
  assert.deepEqual(presets.TOOL_LABELS, { highlight: 'ハイライト', underline: '下線', strikeout: '取り消し線', text: 'テキスト' });
});

test('色は種類ごとのプリセットで、既定はその先頭', () => {
  assert.deepEqual(Object.keys(presets.COLORS), presets.TOOLS);
  assert.deepEqual(presets.COLORS.text, ['#1c2430', '#d92c2c', '#2c5cd9']);
  for (const kind of presets.TOOLS)
    assert.equal(presets.DEFAULT_COLORS[kind], presets.COLORS[kind][0], kind);
  for (const color of Object.values(presets.COLORS).flat())
    assert.equal(typeof presets.COLOR_NAMES[color], 'string', color);
  assert.equal(presets.isPresetColor('text', '#d92c2c'), true);
  assert.equal(presets.isPresetColor('text', '#ffe45a'), false);
  assert.equal(presets.isPresetColor('note', '#d92c2c'), false);
});

test('文字の大きさは 14 段で既定は 12', () => {
  assert.deepEqual(presets.FONT_SIZES, [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]);
  assert.equal(presets.DEFAULT_FONT_SIZE, 12);
  assert.ok(presets.FONT_SIZES.includes(presets.DEFAULT_FONT_SIZE));
  assert.equal(presets.isFontSize(10.5), true);
  assert.equal(presets.isFontSize(13), false);
  assert.equal(presets.isFontSize('12'), false);
});

test('プリセットは凍結されている', () => {
  assert.ok(Object.isFrozen(presets.TOOLS));
  assert.ok(Object.isFrozen(presets.COLORS));
  assert.ok(Object.isFrozen(presets.COLORS.text));
  assert.ok(Object.isFrozen(presets.FONT_SIZES));
});
