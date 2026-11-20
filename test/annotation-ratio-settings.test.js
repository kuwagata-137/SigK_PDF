'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_KEEP_RATIO, ratioDefaults, pickRatioSettings, mergeRatioSettings } = require('../annotation-ratio-settings.js');
const { pickAnnotSettings, mergeAnnotUi, ANNOT_DEFAULTS } = require('../annotation-settings.js');

// 四角・丸・×印の「縦横比を固定」のチェックの状態（spec-7-9 確定事項D3）。

test('既定はチェックなし', () => {
  assert.equal(DEFAULT_KEEP_RATIO, false);
  assert.deepEqual(ratioDefaults(), { annotKeepRatio: false });
  assert.equal(ANNOT_DEFAULTS.annotKeepRatio, false);
});

test('読み込んだ値は真偽値だけを受け取る', () => {
  assert.deepEqual(pickRatioSettings({ annotKeepRatio: true }), { annotKeepRatio: true });
  assert.deepEqual(pickRatioSettings({ annotKeepRatio: 'yes' }), { annotKeepRatio: false });
  assert.deepEqual(pickRatioSettings({}), { annotKeepRatio: false });
  assert.equal(pickAnnotSettings({ annotKeepRatio: true }).annotKeepRatio, true);
  assert.equal(pickAnnotSettings({ annotKeepRatio: 1 }).annotKeepRatio, false);
});

test('部分更新は、送られていなければ今の値のまま', () => {
  assert.deepEqual(mergeRatioSettings({ annotKeepRatio: true }, {}), { annotKeepRatio: true });
  assert.deepEqual(mergeRatioSettings({ annotKeepRatio: true }, { annotKeepRatio: false }), { annotKeepRatio: false });
  assert.equal(mergeAnnotUi({ annotKeepRatio: true }, { annotLineWidth: 3 }).annotKeepRatio, true);
  // 古い settings.json から来た current（キーが無い）でも既定へ落ちる。
  assert.equal(mergeAnnotUi({}, {}).annotKeepRatio, false);
  assert.equal(mergeAnnotUi({}, { annotKeepRatio: true }).annotKeepRatio, true);
});
