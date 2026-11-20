'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { MARKING_SHAPES, MARKING_RANGES, MARKING_DEFAULTS, markingDefaults, pickMarkingSettings, mergeMarkingSettings } = require('../marking-settings.js');
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

test('読み込みは欄ごとに範囲を見て、受け取れない欄は既定へ落とす。中の円は外の円で頭打ち', () => {
  const picked = pickMarkingSettings({ annotMarking: { shape: 'number', outer: 50, dot: 60, ring: 'x', cross: 2, fontSize: 24, lineWidth: 5 } }, markingDefaults()).annotMarking;
  assert.deepEqual(picked, { shape: 'number', outer: 50, dot: 50, ring: 16, cross: 44.8, fontSize: 24, lineWidth: 5 });
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
