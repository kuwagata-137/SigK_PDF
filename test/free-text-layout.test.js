'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/free-text-layout.js');

// テキストの箱の組み立て（spec-4b-4a 確定事項B。annotate-text.js から移した箱の大きさ・四隅・紙の中への寄せ方）。

const layout = globalThis.SigK.freeTextLayout;

// 全角 1em・半角 0.5em で測る見積もり。
const widthOf = (size) => (line) => [...line].reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? 0.5 : 1), 0) * size;

test('boxOf は最長行の幅と行数の高さに四方 2pt の余白を足す', () => {
  assert.deepEqual(layout.boxOf('あいう\nab', 12, widthOf(12)), { width: 40, height: 34 });
  assert.deepEqual(layout.boxOf('', 10, widthOf(10)), { width: 4, height: 16.5 });
});

test('frameOf は表示の左上と大きさから、回転ごとの /Rect と四角を作る', () => {
  assert.deepEqual(layout.frameOf([100, 700], { width: 40, height: 20 }, 0), { rect: [100, 680, 140, 700], quads: [[100, 700, 140, 700, 100, 680, 140, 680]] });
  assert.deepEqual(layout.frameOf([100, 700], { width: 40, height: 20 }, 90).rect, [100, 700, 120, 740]);
});

test('fitOrigin は右端・下端をはみ出す箱を紙の中へ寄せ、viewport が無ければそのまま', () => {
  // 倍率 1・回転 0 の A4（紙の座標の y は上向き、画面の y は下向き）。
  const viewport = {
    width: 595, height: 842, scale: 1,
    convertToViewportPoint: (x, y) => [x, 842 - y],
    convertToPdfPoint: (x, y) => [x, 842 - y],
  };
  assert.deepEqual(layout.fitOrigin([580, 20], { width: 40, height: 30 }, viewport), [555, 30]);
  assert.deepEqual(layout.fitOrigin([100, 700], { width: 40, height: 30 }, viewport), [100, 700]);
  assert.deepEqual(layout.fitOrigin([580, 20], { width: 40, height: 30 }, null), [580, 20]);
});
