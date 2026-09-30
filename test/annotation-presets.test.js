'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-presets.js');

// 注釈のプリセット（spec-4-1 確定事項33、spec-4-2 確定事項34・35、spec-4-3 確定事項27〜30、spec-4-4 確定事項36〜38）。
// settings.js との一致は test/settings.test.js が見張る。

const presets = globalThis.SigK.annotationPresets;

test('道具は 7 つで、マークアップは先頭の 3 つ', () => {
  assert.deepEqual(presets.TOOLS, ['highlight', 'underline', 'strikeout', 'text', 'shape', 'pen', 'note']);
  assert.deepEqual(presets.MARKUP_TOOLS, ['highlight', 'underline', 'strikeout']);
  assert.deepEqual(presets.TOOL_LABELS, {
    highlight: 'ハイライト', underline: '下線', strikeout: '取り消し線', text: 'テキスト', shape: '図形', pen: 'ペン', note: 'ノート',
    square: '四角', circle: '丸', line: '直線', arrow: '矢印', ink: 'ペン',
  });
});

// 表示のみの注釈の種類名（spec-4-4 確定事項36）。一覧と右パネルが subtype から引く。
test('表示のみの注釈の種類名は subtype から引ける', () => {
  assert.equal(presets.READONLY_LABELS.Line, '直線');
  assert.equal(presets.READONLY_LABELS.Polygon, '多角形');
  assert.equal(presets.READONLY_LABELS.PolyLine, '折れ線');
  assert.equal(presets.READONLY_LABELS.FreeText, 'テキスト');
  assert.equal(presets.READONLY_LABELS.Stamp, 'スタンプ');
  assert.equal(presets.READONLY_LABELS.Text, 'ノート');
  assert.equal(presets.readonlyLabelOf('Stamp'), 'スタンプ');
  assert.equal(presets.readonlyLabelOf('Screen'), 'Screen');
  assert.equal(presets.readonlyLabelOf(undefined), '書き込み');
  assert.ok(Object.isFrozen(presets.READONLY_LABELS));
});

test('図形の種類は 4 つで、既定は矩形', () => {
  assert.deepEqual(presets.SHAPE_KINDS, ['square', 'circle', 'line', 'arrow']);
  assert.equal(presets.DEFAULT_SHAPE_KIND, 'square');
  assert.equal(presets.isShapeKind('arrow'), true);
  assert.equal(presets.isShapeKind('ink'), false);
  assert.equal(presets.isShapeKind('shape'), false);
});

// 色は右パネルのチップとパレットで選ぶ（spec-4b-1b 確定事項2・6）。既定の色は今までの既定をいちばん近いパレットの色へ
// 置き換えたもので、どれもパレットにある（確定事項14）。候補の丸の並びはやめた。
test('既定の色は道具ごとのパレットの色', () => {
  require('../renderer/annotation-palette.js');
  const palette = globalThis.SigK.annotationPalette;
  assert.deepEqual(presets.DEFAULT_COLORS, {
    highlight: '#ffd966', underline: '#c00000', strikeout: '#c00000', text: '#222a35', shape: '#c00000', pen: '#c00000', note: '#ffd966',
  });
  assert.deepEqual(Object.keys(presets.DEFAULT_COLORS), presets.TOOLS);
  for (const color of Object.values(presets.DEFAULT_COLORS))
    assert.equal(palette.isPaletteColor(color), true, color);
  assert.equal('COLORS' in presets, false);
  assert.equal('COLOR_NAMES' in presets, false);
  assert.equal('isPresetColor' in presets, false);
});

// 図形の道具の次に付ける塗り・線なし・線種の既定（spec-4b-1b 確定事項23〜25）。settings.js との一致は settings.test.js。
test('図形の塗り・線なし・線種の既定は、塗りなし・線あり・実線', () => {
  assert.deepEqual(presets.DEFAULT_FILLS, { shape: null });
  assert.deepEqual(presets.DEFAULT_STROKE_NONE, { shape: false });
  assert.deepEqual(presets.DEFAULT_LINE_STYLES, { shape: 'solid' });
});

// ノートの既定の色は黄（spec-4-4 確定事項37、spec-4b-1b 確定事項14）。
test('ノートの既定の色は黄', () => {
  assert.equal(presets.DEFAULT_COLORS.note, '#ffd966');
  assert.equal(presets.paletteOf('note'), 'note');
});

// 不透明度は 10〜100% で既定は 1。対象はテキスト・図形・ペン・ノート（spec-4-4 確定事項38、spec-4b-1b 確定事項20）。
test('不透明度は 0.1〜1 で既定は 1、対象は 4 つの道具', () => {
  assert.equal('OPACITIES' in presets, false, '選択肢の並びはやめた（スライダーと数値欄）');
  assert.equal(presets.OPACITY_MIN, 0.1);
  assert.equal(presets.DEFAULT_OPACITY, 1);
  assert.deepEqual(presets.OPACITY_TOOLS, ['text', 'shape', 'pen', 'note']);
  assert.deepEqual(presets.DEFAULT_OPACITIES, { text: 1, shape: 1, pen: 1, note: 1 });
  for (const value of [0.1, 0.35, 0.6, 1])
    assert.equal(presets.isOpacity(value), true, String(value));
  for (const value of [0.09, 0, 1.01, '1', NaN])
    assert.equal(presets.isOpacity(value), false, String(value));
  for (const kind of ['text', 'square', 'circle', 'line', 'arrow', 'ink', 'note'])
    assert.equal(presets.isOpacityKind(kind), true, kind);
  for (const kind of ['highlight', 'underline', 'strikeout', 'other', undefined])
    assert.equal(presets.isOpacityKind(kind), false, String(kind));
  assert.ok(Object.isFrozen(presets.OPACITY_TOOLS));
});

test('図形 4 種は shape の値、ペンは pen の値を引く', () => {
  for (const kind of presets.SHAPE_KINDS)
    assert.equal(presets.paletteOf(kind), 'shape', kind);
  assert.equal(presets.paletteOf('ink'), 'pen');
  assert.equal(presets.paletteOf('shape'), 'shape');
  assert.equal(presets.paletteOf('pen'), 'pen');
  assert.equal(presets.paletteOf('highlight'), 'highlight');
  assert.equal(presets.paletteOf('text'), 'text');
});

// 画面から選べる線の太さは 1〜40 の整数で、既定は 2（spec-4b-1b 確定事項19。論点4）。
test('線の太さは 1〜40 の整数で既定は 2', () => {
  assert.equal('LINE_WIDTHS' in presets, false, '選択肢の並びはやめた（スライダーと数値欄）');
  assert.equal(presets.LINE_WIDTH_MIN, 1);
  assert.equal(presets.LINE_WIDTH_MAX, 40);
  assert.equal(presets.DEFAULT_LINE_WIDTH, 2);
  for (const width of [1, 4, 17, 40])
    assert.equal(presets.isLineWidth(width), true, String(width));
  for (const width of [0, 41, 2.5, '2'])
    assert.equal(presets.isLineWidth(width), false, String(width));
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
  assert.ok(Object.isFrozen(presets.SHAPE_KINDS));
  assert.ok(Object.isFrozen(presets.DEFAULT_COLORS));
  assert.ok(Object.isFrozen(presets.DEFAULT_FILLS));
  assert.ok(Object.isFrozen(presets.DEFAULT_STROKE_NONE));
  assert.ok(Object.isFrozen(presets.DEFAULT_LINE_STYLES));
  assert.ok(Object.isFrozen(presets.FONT_SIZES));
});
