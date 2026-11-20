'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { HATCH_PATTERNS, DEFAULT_HATCH_MEMO, fillDefaults, pickFillSettings, mergeFillSettings } = require('../annotation-fill-settings.js');
const { pickAnnotSettings, mergeAnnotUi, ANNOT_DEFAULTS } = require('../annotation-settings.js');

require('../renderer/fill-style.js');

// 図形の塗りの透明度とハッチングの、次に追加する書き込みの値（spec-7-9 確定事項B2・C3）。

const fill = globalThis.SigK.fillStyle;

test('種類と範囲と既定は renderer/fill-style.js と同じ（なしを除く）', () => {
  assert.deepEqual(HATCH_PATTERNS.filter((pattern) => pattern !== 'none'), fill.HATCH_PATTERNS);
  const { pattern, ...rest } = DEFAULT_HATCH_MEMO;
  assert.equal(pattern, 'none');
  const { pattern: unused, ...defaults } = fill.DEFAULT_HATCH;
  assert.deepEqual(rest, defaults);
  assert.equal(fill.validHatch({ ...DEFAULT_HATCH_MEMO, pattern: 'grid', gap: 1, width: 0.25 }), true);
  assert.deepEqual(pickFillSettings({ annotHatch: { shape: { gap: 1, width: 0.25 } } }).annotHatch.shape, { ...DEFAULT_HATCH_MEMO, gap: 1, width: 0.25 });
  assert.deepEqual(pickFillSettings({ annotHatch: { shape: { gap: 0.9, width: 10.5 } } }).annotHatch.shape, DEFAULT_HATCH_MEMO);
});

test('既定は塗りの透明度 0%（不透明度 1）とハッチングなし', () => {
  assert.deepEqual(fillDefaults(), { annotFillOpacity: { shape: 1 }, annotHatch: { shape: { pattern: 'none', color: '#ff0000', gap: 6, width: 1 } } });
  assert.deepEqual(ANNOT_DEFAULTS.annotFillOpacity, { shape: 1 });
});

test('読み込んだ値は、受け取れる欄だけを受け取り、色を小文字にそろえる', () => {
  const picked = pickAnnotSettings({ annotFillOpacity: { shape: 0.305 }, annotHatch: { shape: { pattern: 'cross', color: '#00B050', gap: 12, width: 'x' } } });
  assert.deepEqual(picked.annotFillOpacity, { shape: 0.31 });
  assert.deepEqual(picked.annotHatch, { shape: { pattern: 'cross', color: '#00b050', gap: 12, width: 1 } });
  assert.deepEqual(pickAnnotSettings({ annotFillOpacity: { shape: 0.05 }, annotHatch: 'grid' }).annotFillOpacity, { shape: 1 });
  assert.deepEqual(pickAnnotSettings({ annotHatch: { shape: { pattern: 'dots' } } }).annotHatch.shape.pattern, 'none');
});

test('部分更新は欄ごとに今の値へ重ねる', () => {
  const current = { annotFillOpacity: { shape: 0.4 }, annotHatch: { shape: { pattern: 'grid', color: '#0070c0', gap: 8, width: 2 } } };
  assert.deepEqual(mergeFillSettings(current, { annotHatch: { shape: { gap: 10 } } }), {
    annotFillOpacity: { shape: 0.4 },
    annotHatch: { shape: { pattern: 'grid', color: '#0070c0', gap: 10, width: 2 } },
  });
  assert.deepEqual(mergeFillSettings(current, { annotFillOpacity: { shape: 0.7 } }).annotFillOpacity, { shape: 0.7 });
  // 古い settings.json から来た current（キーが無い）でも既定へ落ちる。
  const merged = mergeAnnotUi({}, { annotHatch: { shape: { pattern: 'vertical' } } });
  assert.deepEqual(merged.annotHatch, { shape: { ...DEFAULT_HATCH_MEMO, pattern: 'vertical' } });
  assert.deepEqual(merged.annotFillOpacity, { shape: 1 });
});
