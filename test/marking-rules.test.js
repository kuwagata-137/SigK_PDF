'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/shape-style.js');
require('../renderer/fill-style.js');
require('../renderer/free-text-entry.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/marking-rules.js');
require('../renderer/marking-glyphs.js');
require('../renderer/shape-geometry.js');
require('../renderer/marking-geometry.js');

// マーキングの値の決まりと、1 件の形（spec-7-9 確定事項F）。描く形は marking-graphics.test.js、配置は annotate-marking.test.js が見る。

const { markingRules: rules, markingGeometry: geometry, annotationEntry: entries } = globalThis.SigK;

const TARGET = { shape: 'target', outer: 32, dot: 9, ring: 16, cross: 44.8, fontSize: 16 };

function markingEntry(marking = TARGET, center = [100, 700]) {
  return { id: 'm1', src: 0, kind: 'marking', color: '#ff0000', opacity: 1, lineWidth: 3, text: '', marking, ...geometry.frameOf(marking, center) };
}

test('既定の値は外の円 100pt・中の円 15pt（点付き丸）と 50pt（二重丸）・十字線は外の円の 1.5 倍・文字サイズ 50pt・線の太さ 3pt・赤（決定102 ⑥・質問 MK2 案A）', () => {
  assert.deepEqual({ ...rules.DEFAULTS }, { ...TARGET, outer: 100, dot: 15, ring: 50, cross: 150, fontSize: 50 });
  assert.equal(rules.DEFAULTS.cross, rules.DEFAULTS.outer * 1.5);
  assert.equal(rules.DEFAULT_LINE_WIDTH, 3);
  assert.equal(rules.DEFAULT_COLOR, '#ff0000');
  assert.deepEqual([...rules.SHAPES], ['target', 'double', 'crosshair', 'number', 'caution']);
  assert.deepEqual(rules.SHAPES.map((shape) => rules.SHAPE_LABELS[shape]), ['点付き丸', '二重丸', '照準', '番号付き丸', '注意マーク']);
});

test('形と大きさの検証。番号は番号付き丸だけが持ち、中の円は外の円以下', () => {
  assert.equal(rules.validMarking(TARGET), true);
  assert.equal(rules.validMarking({ ...TARGET, shape: 'number', number: 3 }), true);
  assert.equal(rules.validMarking({ ...TARGET, shape: 'number' }), false, '番号付き丸は番号が要る');
  assert.equal(rules.validMarking({ ...TARGET, number: 3 }), false, 'ほかの形は番号を持たない');
  assert.equal(rules.validMarking({ ...TARGET, shape: 'number', number: 0 }), false);
  assert.equal(rules.validMarking({ ...TARGET, shape: 'number', number: 1.5 }), false);
  assert.equal(rules.validMarking({ ...TARGET, dot: 40 }), false);
  assert.equal(rules.validMarking({ ...TARGET, outer: 3 }), false);
  assert.equal(rules.validMarking({ ...TARGET, shape: 'star' }), false);
  assert.equal(rules.validMarking({ ...TARGET, cross: undefined }), false);
  assert.equal(rules.validMarking(null), false);
});

// 質問 MK3 案A「外の円と同じ比で、十字線・中の円・文字サイズをすべて変える（外の円 100 → 160 で、十字線 80 → 128、点付き丸の中の円 15 → 24）。」
test('大きさの変更: 範囲の外は null、外の円を変えるとほかの大きさも同じ比で変える、中の円を外の円より大きくする値は null', () => {
  assert.equal(rules.withSize(TARGET, 'outer', 40).outer, 40);
  assert.equal(rules.withSize(TARGET, 'outer', 3), null);
  assert.equal(rules.withSize(TARGET, 'outer', 800), null);
  assert.equal(rules.withSize(TARGET, 'outer', Number.NaN), null);
  const scaled = rules.withSize({ ...TARGET, outer: 100, dot: 15, cross: 80, ring: 50, fontSize: 50 }, 'outer', 160);
  assert.deepEqual([scaled.outer, scaled.cross, scaled.dot, scaled.ring, scaled.fontSize], [160, 128, 24, 80, 80], '質問 MK3 の図の例');
  const small = rules.withSize(TARGET, 'outer', 16);
  assert.deepEqual([small.dot, small.ring, small.cross, small.fontSize], [4.5, 8, 22.4, 8]);
  assert.equal(rules.withSize(TARGET, 'dot', 33), null);
  assert.equal(rules.withSize(TARGET, 'dot', 20.004).dot, 20);
  // ハンドルは範囲の端と外の円で止める。比で変えた値も範囲の端で止める。
  assert.equal(rules.clampedSize(TARGET, 'dot', 50).dot, 32);
  assert.equal(rules.clampedSize(TARGET, 'dot', -5).dot, 1);
  const tiny = rules.clampedSize(TARGET, 'outer', 2);
  assert.deepEqual([tiny.outer, tiny.dot, tiny.ring, tiny.cross, tiny.fontSize], [4, 1.13, 2, 5.6, 4]);
  assert.equal(rules.clampedSize(TARGET, 'outer', 720).fontSize, 200, '文字サイズは 200 で止める');
});

test('形の変更: 番号付き丸にすると渡された番号を付け、ほかの形にすると番号を外す。大きさは形ごとに残る', () => {
  const number = rules.withShape(TARGET, 'number', 4);
  assert.equal(number.number, 4);
  assert.equal(number.dot, 9);
  const back = rules.withShape(number, 'double', 9);
  assert.equal(back.number, undefined);
  assert.equal(back.ring, 16);
  assert.equal(rules.withShape(number, 'number', 9).number, 4, '番号付き丸のままなら今の番号');
  assert.equal(rules.withNumber(number, 12).number, 12);
  assert.equal(rules.withNumber(TARGET, 12), null);
  assert.equal(rules.withNumber(number, 10000), null);
});

test('数値欄の行の名前は形ごと。注意マークは三角形の幅だけ', () => {
  const labels = (shape) => rules.sizeRowsOf(shape).map((row) => `${row.field}:${row.label}`);
  assert.deepEqual(labels('target'), ['outer:外の円の直径', 'dot:中の円の直径']);
  assert.deepEqual(labels('double'), ['outer:外の円の直径', 'ring:中の円の直径']);
  assert.deepEqual(labels('crosshair'), ['outer:外の円の直径', 'cross:十字線の長さ']);
  assert.deepEqual(labels('number'), ['outer:外の円の直径', 'fontSize:文字サイズ']);
  assert.deepEqual(labels('caution'), ['outer:三角形の幅']);
});

test('rect は描く範囲の外接で、中心が位置。照準は十字線、注意マークは正三角形の幅と高さ', () => {
  assert.deepEqual(markingEntry().rect, [84, 684, 116, 716]);
  assert.deepEqual(markingEntry({ ...TARGET, shape: 'crosshair' }).rect, [77.6, 677.6, 122.4, 722.4]);
  const caution = markingEntry({ ...TARGET, shape: 'caution' }).rect;
  assert.deepEqual(caution, [84, 686.14, 116, 713.86]);
  assert.deepEqual(geometry.centerOf(caution), [100, 700]);
  // 番号が外の円より大きければ、番号の範囲まで広げる。
  const wide = markingEntry({ ...TARGET, shape: 'number', number: 1234, fontSize: 40 });
  assert.ok(wide.rect[2] - wide.rect[0] > 32);
  assert.deepEqual(geometry.centerOf(wide.rect), [100, 700]);
});

test('1 件の形: マーキングは線の色と marking を持ち、ほかの種類は marking を持てない', () => {
  const entry = markingEntry();
  assert.equal(entries.validEntry(entry), true);
  assert.equal(entries.isDrawnKind('marking'), true);
  assert.equal(entries.validEntry({ ...entry, color: null }), false, '線なしにはできない');
  assert.equal(entries.validEntry({ ...entry, marking: { ...TARGET, dot: 99 } }), false);
  assert.equal(entries.validEntry({ ...entry, marking: undefined }), false);
  assert.equal(entries.validEntry({ ...entry, angle: 30 }), false, '回転しない');
  assert.equal(entries.validEntry({ ...entry, kind: 'circle' }), false, '丸は marking を持てない');
});

test('写し・比較・変更・保存の形に marking が入る', () => {
  const entry = markingEntry();
  const copy = entries.copyEntry(entry);
  assert.deepEqual(copy.marking, TARGET);
  assert.notEqual(copy.marking, entry.marking);
  assert.equal(entries.sameEntry(copy, entry), true);
  assert.equal(entries.sameEntry({ ...copy, marking: { ...TARGET, dot: 10 } }, entry), false);
  const picked = entries.pickPatch({ marking: { ...TARGET, outer: 40 } }, 'marking');
  assert.equal(picked.marking.outer, 40);
  assert.equal(entries.pickPatch({ marking: { ...TARGET, outer: 1 } }, 'marking'), null);
  assert.equal(entries.pickPatch({ marking: TARGET }, 'circle'), null);
  assert.deepEqual(entries.toSaveEntry(entry), { src: 0, kind: 'marking', color: '#ff0000', opacity: 1, rect: [84, 684, 116, 716], lineWidth: 3, marking: TARGET });
});
