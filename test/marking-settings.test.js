'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MARKING_SHAPES, MARKING_RANGES, MARKING_DEFAULTS, LEGACY_MARKING_DEFAULTS, markingDefaults, migrateMarking, pickMarkingSettings, mergeMarkingSettings,
} = require('../marking-settings.js');
const { ANNOT_DEFAULTS, pickAnnotSettings, mergeAnnotUi } = require('../annotation-settings.js');

require('../renderer/marking-rules.js');

// マーキングの次に配置する値の記憶（spec-7-9 確定事項F5）。settings.json の annotMarking。

const rules = globalThis.SigK.markingRules;

test('形・大きさの範囲と既定は renderer/marking-rules.js と同じ。線の太さの既定は 3pt', () => {
  assert.deepEqual(MARKING_SHAPES, [...rules.SHAPES]);
  assert.deepEqual(MARKING_RANGES, Object.fromEntries(Object.entries(rules.RANGES).map(([field, range]) => [field, [...range]])));
  assert.deepEqual(MARKING_DEFAULTS, { ...rules.DEFAULTS, lineWidth: rules.DEFAULT_LINE_WIDTH });
  assert.deepEqual(markingDefaults(), { annotMarking: MARKING_DEFAULTS });
  assert.deepEqual(ANNOT_DEFAULTS.annotMarking, MARKING_DEFAULTS);
  assert.equal(ANNOT_DEFAULTS.annotColors.marking, '#ff0000');
  assert.equal(ANNOT_DEFAULTS.annotOpacity.marking, 1);
});

test('既定は外の円 100・中の円 15・十字線 150（外の円の 1.5 倍）・二重丸の中の円 50・文字サイズ 50。決定102 ⑥・質問 MK2 案A', () => {
  assert.deepEqual([MARKING_DEFAULTS.outer, MARKING_DEFAULTS.dot, MARKING_DEFAULTS.cross, MARKING_DEFAULTS.ring, MARKING_DEFAULTS.fontSize], [100, 15, 150, 50, 50]);
  assert.equal(MARKING_DEFAULTS.cross, MARKING_DEFAULTS.outer * 1.5);
  assert.deepEqual(LEGACY_MARKING_DEFAULTS, { outer: 32, dot: 9, ring: 16, cross: 44.8, fontSize: 16 });
});

test('印が 3 より前の設定は、1.4.0 の既定と同じ値の欄だけを新しい既定へ置き換える。自分で変えた値と、印 3 の設定はそのまま', () => {
  const legacy = { shape: 'double', outer: 32, dot: 9, ring: 20, cross: 44.8, fontSize: 16, lineWidth: 3 };
  const migrated = { ...legacy, outer: 100, dot: 15, cross: 150, fontSize: 50 };
  assert.deepEqual(migrateMarking(legacy, 2), migrated, '自分で変えた二重丸の中の円 20 はそのまま');
  assert.deepEqual(migrateMarking({ ...legacy, outer: 48, cross: 60 }, 2), { ...migrated, outer: 48, cross: 60 }, '自分で変えた外の円・十字線はそのまま');
  assert.deepEqual(migrateMarking({ ...legacy, ring: 16 }, 2).ring, 50, '1.4.0 の既定の 16 は 50 へ置き換える');
  assert.deepEqual(migrateMarking(legacy, 3), legacy, '移し替えを済ませた設定は置き換えない（後で 32 を選び直した値）');
  assert.deepEqual(migrateMarking(legacy, '2'), migrated, '印が数でなければ印が無いのと同じ');
  assert.equal(migrateMarking(undefined, 2), undefined);
  // annotation-settings.js の読み込みで、印 2 の設定に当たる。
  const picked = pickAnnotSettings({ annotPaletteVersion: 2, annotMarking: legacy });
  assert.deepEqual(picked.annotMarking, migrated);
  assert.equal(picked.annotPaletteVersion, 3);
  assert.deepEqual(pickAnnotSettings({ annotPaletteVersion: 3, annotMarking: legacy }).annotMarking, legacy);
  // 自分で外の円を 10 にしていて、中の円が 1.4.0 の既定の 9 のままなら、中の円は 15 ではなく外の円の 10 で頭打ちになる。
  assert.equal(pickAnnotSettings({ annotPaletteVersion: 2, annotMarking: { ...legacy, outer: 10 } }).annotMarking.dot, 10);
});

test('読み込みは欄ごとに範囲を見て、受け取れない欄は既定へ落とす。中の円は外の円で頭打ち', () => {
  const picked = pickMarkingSettings({ annotMarking: { shape: 'number', outer: 50, dot: 60, ring: 'x', cross: 2, fontSize: 24, lineWidth: 5 } }, markingDefaults()).annotMarking;
  assert.deepEqual(picked, { shape: 'number', outer: 50, dot: 50, ring: 50, cross: 150, fontSize: 24, lineWidth: 5 });
  assert.deepEqual(pickMarkingSettings({ annotMarking: { shape: 'star', lineWidth: 2.5 } }, markingDefaults()).annotMarking, MARKING_DEFAULTS);
  assert.deepEqual(pickMarkingSettings({}, markingDefaults()).annotMarking, MARKING_DEFAULTS);
  assert.deepEqual(pickAnnotSettings({ annotMarking: { shape: 'caution' } }).annotMarking.shape, 'caution');
});

test('部分更新は送られた欄だけを今の値に重ねる', () => {
  const current = { annotMarking: { ...MARKING_DEFAULTS, shape: 'double', ring: 20 } };
  assert.deepEqual(mergeMarkingSettings(current, { annotMarking: { outer: 40 } }).annotMarking, { ...MARKING_DEFAULTS, shape: 'double', ring: 20, outer: 40 });
  assert.deepEqual(mergeMarkingSettings(current, {}).annotMarking, current.annotMarking);
  assert.deepEqual(mergeAnnotUi({ ...ANNOT_DEFAULTS, ...current }, { annotMarking: { lineWidth: 8 } }).annotMarking.lineWidth, 8);
});
