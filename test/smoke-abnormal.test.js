'use strict';

// 起動確認 SIGK_SMOKE_ABNORMAL の倍率の指定（smoke-abnormal.js。spec-6-1 タスク D の D2・D9）。本物は起動確認で通す。

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseZoom } = require('../smoke-abnormal.js');

test('SIGK_SMOKE_ABNORMAL_ZOOM は「倍率@画面の画素の倍率」で読み、画面の倍率を省けば 1、読めなければ null', () => {
  assert.deepEqual(parseZoom('4@1.5'), { zoom: 4, dpr: 1.5 });
  assert.deepEqual(parseZoom('4'), { zoom: 4, dpr: 1 });
  assert.equal(parseZoom(undefined), null);
  assert.equal(parseZoom('大きく'), null);
  assert.equal(parseZoom('0@2'), null);
});
