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

// 候補の丸の色は、今までの候補をいちばん近いパレットの色へ置き換えたもの。既定は先頭で、パレットの色（spec-4b-1b 確定事項14）。
test('色は種類ごとのプリセットで、既定はその先頭のパレットの色', () => {
  assert.deepEqual(Object.keys(presets.COLORS), presets.TOOLS);
  assert.deepEqual(presets.COLORS.text, ['#222a35', '#c00000', '#4472c4']);
  assert.deepEqual(presets.COLORS.shape, ['#c00000', '#4472c4', '#00b050', '#222a35']);
  assert.deepEqual(presets.COLORS.pen, presets.COLORS.shape);
  assert.deepEqual(presets.DEFAULT_COLORS, {
    highlight: '#ffd966', underline: '#c00000', strikeout: '#c00000', text: '#222a35', shape: '#c00000', pen: '#c00000', note: '#ffd966',
  });
  for (const kind of presets.TOOLS)
    assert.equal(presets.DEFAULT_COLORS[kind], presets.COLORS[kind][0], kind);
  for (const color of Object.values(presets.COLORS).flat())
    assert.equal(typeof presets.COLOR_NAMES[color], 'string', color);
  assert.equal(presets.isPresetColor('text', '#c00000'), true);
  assert.equal(presets.isPresetColor('text', '#ffd966'), false);
  assert.equal(presets.isPresetColor('stamp', '#c00000'), false);
});

// 既定の色と候補の丸の色は、桃を除いてパレットにある（spec-4b-1b 確定事項14）。
test('既定の色と候補の丸の色は、桃を除いてパレットの色', () => {
  require('../renderer/annotation-palette.js');
  const palette = globalThis.SigK.annotationPalette;
  for (const color of Object.values(presets.DEFAULT_COLORS))
    assert.equal(palette.isPaletteColor(color), true, color);
  for (const color of Object.values(presets.COLORS).flat().filter((value) => value !== '#ffa8c8'))
    assert.equal(palette.isPaletteColor(color), true, color);
});

// ノートの色はハイライトと同じ淡い 4 色で、既定は黄（spec-4-4 確定事項37）。
test('ノートの色は黄・緑・青・桃で既定は黄', () => {
  assert.deepEqual(presets.COLORS.note, ['#ffd966', '#a9ce91', '#8faadc', '#ffa8c8']);
  assert.equal(presets.DEFAULT_COLORS.note, '#ffd966');
  assert.equal(presets.paletteOf('note'), 'note');
  assert.equal(presets.isPresetColor('note', '#ffa8c8'), true);
  assert.equal(presets.isPresetColor('note', '#c00000'), false);
});

// 不透明度は 10〜100% で既定は 1。対象はテキスト・図形・ペン・ノート（spec-4-4 確定事項38、spec-4b-1b 確定事項20）。
test('不透明度は 0.1〜1 で既定は 1、対象は 4 つの道具', () => {
  assert.deepEqual(presets.OPACITIES, [1, 0.75, 0.5, 0.25]);
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
  assert.ok(Object.isFrozen(presets.OPACITIES));
  assert.ok(Object.isFrozen(presets.OPACITY_TOOLS));
});

test('図形 4 種は shape の色、ペンは pen の色を引く', () => {
  for (const kind of presets.SHAPE_KINDS)
    assert.equal(presets.paletteOf(kind), 'shape', kind);
  assert.equal(presets.paletteOf('ink'), 'pen');
  assert.equal(presets.paletteOf('shape'), 'shape');
  assert.equal(presets.paletteOf('pen'), 'pen');
  assert.equal(presets.paletteOf('highlight'), 'highlight');
  assert.equal(presets.paletteOf('text'), 'text');
  assert.equal(presets.isPresetColor('square', '#00b050'), true);
  assert.equal(presets.isPresetColor('ink', '#00b050'), true);
  assert.equal(presets.isPresetColor('ink', '#ffd966'), false);
});

// 画面から選べる線の太さは 1〜40 の整数で、既定は 2（spec-4b-1b 確定事項19。論点4）。
test('線の太さは 1〜40 の整数で既定は 2', () => {
  assert.deepEqual(presets.LINE_WIDTHS, [1, 2, 3, 5, 8]);
  assert.equal(presets.LINE_WIDTH_MIN, 1);
  assert.equal(presets.LINE_WIDTH_MAX, 40);
  assert.equal(presets.DEFAULT_LINE_WIDTH, 2);
  assert.ok(presets.LINE_WIDTHS.includes(presets.DEFAULT_LINE_WIDTH));
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
  assert.ok(Object.isFrozen(presets.COLORS));
  assert.ok(Object.isFrozen(presets.COLORS.text));
  assert.ok(Object.isFrozen(presets.COLORS.shape));
  assert.ok(Object.isFrozen(presets.FONT_SIZES));
  assert.ok(Object.isFrozen(presets.LINE_WIDTHS));
});
