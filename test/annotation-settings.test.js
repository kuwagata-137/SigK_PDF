'use strict';

// 注釈の設定の既定と検証（annotation-settings.js）。settings.js から移した（spec-4b-1a 確定事項36）。
// settings.js を通した振る舞い（mergeDefaults・pickUi・mergeUi）は test/settings.test.js が見ており、
// ここは移した関数そのものと、settings.js が同じ既定を使っていることを見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ANNOT_DEFAULTS, ANNOT_COLORS, ANNOT_OPACITIES, ANNOT_AUTHOR_MAX, pickAnnotAuthor, pickAnnotSettings, mergeAnnotUi,
} = require('../annotation-settings.js');
const settings = require('../settings.js');

const KEYS = ['annotColors', 'annotFontSize', 'annotLineWidth', 'annotShapeKind', 'annotOpacity', 'annotAuthor'];

test('settings.js の既定は、注釈のキーを annotation-settings.js の既定のまま同じ位置に持つ', () => {
  for (const key of KEYS)
    assert.deepEqual(settings.DEFAULTS[key], ANNOT_DEFAULTS[key]);
  // settings.json に書くキーの並びは移す前と同じ（画面の見た目の後ろ、recent の前）。
  assert.deepEqual(Object.keys(settings.DEFAULTS), ['version', 'window', 'sidePanel', 'mode', 'pageLayout', 'editSide', ...KEYS, 'recent']);
  // 既定を複製して持つので、settings.js 側を書き換えても annotation-settings.js の既定は変わらない。
  assert.notEqual(settings.DEFAULTS.annotColors, ANNOT_DEFAULTS.annotColors);
  // 候補の一覧は settings.js からも同じものが引ける（プリセットとの一致の見張りが使う）。
  assert.equal(settings.ANNOT_COLORS, ANNOT_COLORS);
  assert.equal(settings.ANNOT_OPACITIES, ANNOT_OPACITIES);
});

test('pickAnnotSettings は注釈のキーだけを検証して取り出し、ほかのキーは持ち込まない', () => {
  assert.deepEqual(pickAnnotSettings({}), ANNOT_DEFAULTS);
  assert.deepEqual(pickAnnotSettings(null), ANNOT_DEFAULTS);
  const picked = pickAnnotSettings({
    mode: 'annot',
    annotColors: { highlight: '#8ce99a', underline: 'red' },
    annotFontSize: 13,
    annotLineWidth: 5,
    annotShapeKind: 'arrow',
    annotOpacity: { shape: 0.5, note: 0.6 },
    annotAuthor: '  総務 ',
  });
  assert.deepEqual(Object.keys(picked), KEYS);
  assert.equal(picked.annotColors.highlight, '#8ce99a');
  assert.equal(picked.annotColors.underline, ANNOT_DEFAULTS.annotColors.underline, '候補に無い色は既定へ落ちる');
  assert.equal(picked.annotFontSize, 12, '候補に無い大きさは既定へ落ちる');
  assert.equal(picked.annotLineWidth, 5);
  assert.equal(picked.annotShapeKind, 'arrow');
  assert.deepEqual(picked.annotOpacity, { text: 1, shape: 0.5, pen: 1, note: 1 });
  assert.equal(picked.annotAuthor, '総務');
});

test('mergeAnnotUi は色と不透明度を種類ごとに重ね、送られなかったキーは今の値のままにする', () => {
  const current = { ...ANNOT_DEFAULTS, annotColors: { ...ANNOT_DEFAULTS.annotColors, pen: '#2c5cd9' }, annotLineWidth: 3, annotAuthor: '総務' };
  const merged = mergeAnnotUi(current, { annotColors: { shape: '#2f9e5a' }, annotOpacity: { note: 0.25 } });
  assert.equal(merged.annotColors.shape, '#2f9e5a');
  assert.equal(merged.annotColors.pen, '#2c5cd9');
  assert.deepEqual(merged.annotOpacity, { text: 1, shape: 1, pen: 1, note: 0.25 });
  assert.equal(merged.annotLineWidth, 3);
  assert.equal(merged.annotAuthor, '総務');
  // 古い settings.json から来た current（注釈のキーが無い）でも既定へ落ちる。
  assert.deepEqual(mergeAnnotUi({}, {}), ANNOT_DEFAULTS);
});

test('pickAnnotAuthor は文字列の前後の空白を落として上限で切り、文字列でなければ fallback', () => {
  assert.equal(pickAnnotAuthor('  山田 ', ''), '山田');
  assert.equal(pickAnnotAuthor('a'.repeat(ANNOT_AUTHOR_MAX + 5), ''), 'a'.repeat(ANNOT_AUTHOR_MAX));
  assert.equal(pickAnnotAuthor(7, '経理'), '経理');
  assert.equal(pickAnnotAuthor(undefined, 3), '');
});
