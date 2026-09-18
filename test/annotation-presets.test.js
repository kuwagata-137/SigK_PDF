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
    square: '矩形', circle: '楕円', line: '直線', arrow: '矢印', ink: 'ペン',
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
  assert.equal(presets.readonlyLabelOf(undefined), '注釈');
  assert.ok(Object.isFrozen(presets.READONLY_LABELS));
});

test('図形の種類は 4 つで、既定は矩形', () => {
  assert.deepEqual(presets.SHAPE_KINDS, ['square', 'circle', 'line', 'arrow']);
  assert.equal(presets.DEFAULT_SHAPE_KIND, 'square');
  assert.equal(presets.isShapeKind('arrow'), true);
  assert.equal(presets.isShapeKind('ink'), false);
  assert.equal(presets.isShapeKind('shape'), false);
});

test('色は種類ごとのプリセットで、既定はその先頭', () => {
  assert.deepEqual(Object.keys(presets.COLORS), presets.TOOLS);
  assert.deepEqual(presets.COLORS.text, ['#1c2430', '#d92c2c', '#2c5cd9']);
  assert.deepEqual(presets.COLORS.shape, ['#d92c2c', '#2c5cd9', '#2f9e5a', '#1c2430']);
  assert.deepEqual(presets.COLORS.pen, presets.COLORS.shape);
  for (const kind of presets.TOOLS)
    assert.equal(presets.DEFAULT_COLORS[kind], presets.COLORS[kind][0], kind);
  for (const color of Object.values(presets.COLORS).flat())
    assert.equal(typeof presets.COLOR_NAMES[color], 'string', color);
  assert.equal(presets.isPresetColor('text', '#d92c2c'), true);
  assert.equal(presets.isPresetColor('text', '#ffe45a'), false);
  assert.equal(presets.isPresetColor('stamp', '#d92c2c'), false);
});

// ノートの色はハイライトと同じ淡い 4 色で、既定は黄（spec-4-4 確定事項37）。
test('ノートの色は黄・緑・青・桃で既定は黄', () => {
  assert.deepEqual(presets.COLORS.note, ['#ffe45a', '#8ce99a', '#8fbfff', '#ffa8c8']);
  assert.equal(presets.DEFAULT_COLORS.note, '#ffe45a');
  assert.equal(presets.paletteOf('note'), 'note');
  assert.equal(presets.isPresetColor('note', '#ffa8c8'), true);
  assert.equal(presets.isPresetColor('note', '#d92c2c'), false);
});

// 不透明度は 4 段で既定は 1。対象はテキスト・図形・ペン・ノート（spec-4-4 確定事項38）。
test('不透明度は 4 段で既定は 1、対象は 4 つの道具', () => {
  assert.deepEqual(presets.OPACITIES, [1, 0.75, 0.5, 0.25]);
  assert.equal(presets.DEFAULT_OPACITY, 1);
  assert.deepEqual(presets.OPACITY_TOOLS, ['text', 'shape', 'pen', 'note']);
  assert.deepEqual(presets.DEFAULT_OPACITIES, { text: 1, shape: 1, pen: 1, note: 1 });
  assert.equal(presets.isOpacity(0.5), true);
  assert.equal(presets.isOpacity(0.6), false);
  assert.equal(presets.isOpacity('1'), false);
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
  assert.equal(presets.isPresetColor('square', '#2f9e5a'), true);
  assert.equal(presets.isPresetColor('ink', '#2f9e5a'), true);
  assert.equal(presets.isPresetColor('ink', '#ffe45a'), false);
});

test('線の太さは 5 段で既定は 2', () => {
  assert.deepEqual(presets.LINE_WIDTHS, [1, 2, 3, 5, 8]);
  assert.equal(presets.DEFAULT_LINE_WIDTH, 2);
  assert.ok(presets.LINE_WIDTHS.includes(presets.DEFAULT_LINE_WIDTH));
  assert.equal(presets.isLineWidth(5), true);
  assert.equal(presets.isLineWidth(4), false);
  assert.equal(presets.isLineWidth('2'), false);
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
