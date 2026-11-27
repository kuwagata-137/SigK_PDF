'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 図形の書き込みツールごとの、次に追加する書き込みの値の既定と検証（shape-style-settings.js。決定102 ⑨・質問 SH7 案B）。
// 質問 SH7 案B「見た目の値をすべて、四角・丸・直線・矢印・×印・多角形の書き込みツールごとに記憶する。丸に切り替えると、丸で前に
// 使った値（線の太さも）に戻る。ペンの線の太さは図形と別に記憶する。」

const {
  SHAPE_STYLE_KINDS, DEFAULT_SHAPE_STYLE, pickShapeStyle, shapeStyleDefaults, pickShapeStyleSettings, mergeShapeStyleSettings,
} = require('../shape-style-settings.js');
const { ANNOT_DEFAULTS, ANNOT_SHAPE_KINDS, pickAnnotSettings, mergeAnnotUi } = require('../annotation-settings.js');

require('../renderer/annotation-presets.js');
require('../renderer/annotation-palette.js');
require('../renderer/fill-style.js');
require('../renderer/shape-style.js');
require('../renderer/shape-tool-memory.js');

test('種類は図形の書き込みツールの 6 つで、既定はレンダラーの既定と同じ', () => {
  assert.deepEqual(SHAPE_STYLE_KINDS, ANNOT_SHAPE_KINDS);
  assert.deepEqual(SHAPE_STYLE_KINDS, [...globalThis.SigK.annotationPresets.SHAPE_KINDS]);
  globalThis.SigK.shapeToolMemory.reset();
  assert.deepEqual(shapeStyleDefaults().annotShapeStyles, globalThis.SigK.shapeToolMemory.styles());
  assert.equal(DEFAULT_SHAPE_STYLE.color, ANNOT_DEFAULTS.annotColors.shape);
  assert.equal(DEFAULT_SHAPE_STYLE.lineWidth, ANNOT_DEFAULTS.annotLineWidth);
  assert.deepEqual(ANNOT_DEFAULTS.annotShapeStyles, shapeStyleDefaults().annotShapeStyles);
});

test('欄ごとに受け取り、受け取れない値は既定にする。塗りつぶしがなしなら枠線は消せない', () => {
  const picked = pickShapeStyle({ color: '#0070C0', fill: 'yellow', strokeNone: true, lineStyle: 'wavy', lineWidth: 41, opacity: 0.333, fillOpacity: 0.05, hatch: { pattern: 'cross', gap: 90 } });
  assert.deepEqual(picked, {
    color: '#0070c0', fill: null, strokeNone: false, lineStyle: 'solid', lineWidth: 2, opacity: 0.33, fillOpacity: 1,
    hatch: { pattern: 'cross', color: '#ff0000', gap: 6, width: 1 },
  });
});

test('種類の値が無い欄は、版 1.4.0 までの共有の値を転記する（版 1.5.0 で初めて起動した時の移し替え）', () => {
  const ui = pickAnnotSettings({
    annotColors: { shape: '#00B050' }, annotFills: { shape: '#ffff00' }, annotStrokeNone: { shape: true }, annotLineStyles: { shape: 'dashed' },
    annotLineWidth: 8, annotOpacity: { shape: 0.5 }, annotFillOpacity: { shape: 0.4 }, annotHatch: { shape: { pattern: 'grid', gap: 9 } },
    annotShapeStyles: { circle: { color: '#0070c0', lineWidth: 3 } },
  });
  assert.deepEqual(ui.annotShapeStyles.square, {
    color: '#00b050', fill: '#ffff00', strokeNone: true, lineStyle: 'dashed', lineWidth: 8, opacity: 0.5, fillOpacity: 0.4,
    hatch: { pattern: 'grid', color: '#ff0000', gap: 9, width: 1 },
  });
  assert.deepEqual([ui.annotShapeStyles.circle.color, ui.annotShapeStyles.circle.lineWidth, ui.annotShapeStyles.circle.fill], ['#0070c0', 3, '#ffff00'], '種類の値がある欄はそちら');
  assert.equal(ui.annotColors.shape, '#00b050', '共有の値は削除しない');
  assert.deepEqual(Object.keys(pickShapeStyleSettings({}, {}).annotShapeStyles), SHAPE_STYLE_KINDS);
});

test('部分更新は種類ごと・欄ごとに重ね、ハッチングは欄の中まで重ねる', () => {
  const current = pickAnnotSettings({ annotShapeStyles: { square: { color: '#0070c0', hatch: { pattern: 'grid', color: '#00b050' } } } });
  const merged = mergeAnnotUi(current, { annotShapeStyles: { square: { lineWidth: 8, hatch: { gap: 9 } } } }).annotShapeStyles;
  assert.deepEqual(merged.square, { ...DEFAULT_SHAPE_STYLE, color: '#0070c0', lineWidth: 8, hatch: { pattern: 'grid', color: '#00b050', gap: 9, width: 1 } });
  assert.deepEqual(merged.circle, current.annotShapeStyles.circle, '送られなかった種類は今の値のまま');
  const invalid = mergeShapeStyleSettings(current, { annotShapeStyles: { square: { lineWidth: 0.5, color: 'red' } } }).annotShapeStyles.square;
  assert.deepEqual([invalid.lineWidth, invalid.color], [2, '#0070c0'], '受け取れない値は今の値のまま');
});
