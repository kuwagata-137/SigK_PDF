'use strict';

// 起動確認 SIGK_SMOKE_TAB_REPAINT（smoke-tab-repaint.js。docs/07 決定100 ①〜③・⑤）。実機（offscreen 描画のウインドウ）でしか動かせないので、
// ここでは、文字欠けの数え方と、画面（レンダラー）に流し込む式が文法として正しいことを見る（smoke-page-repaint.test.js と同じ作法）。

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { installWatch, glyphBroken, countGlyphs, MISS_PIXELS, MISS_RATIO } = require('../smoke-tab-repaint.js');

test('描き直した絵で暗いのに表示している絵で明るい画素が、6 画素以上で、かつ暗い画素の 2% 以上あれば文字欠けと数える', () => {
  assert.equal(MISS_PIXELS, 6);
  assert.equal(MISS_RATIO, 0.02);
  // サムネイルの数字（暗い画素 25）の上側が欠けた（12 画素）。
  assert.equal(glyphBroken(12, 25), true);
  // 縁の滲みの違い程度（5 画素）は数えない。
  assert.equal(glyphBroken(5, 25), false);
  // 文字の多いページ（暗い画素 2,000）で 6 画素の違いは、2% に届かないので数えない。
  assert.equal(glyphBroken(6, 2000), false);
});

test('countGlyphs は、ページ枠とサムネイル枠ごとに、調べた枚数と文字欠けの枚数を数える', () => {
  const counted = countGlyphs([['p', 1, 2000, 0], ['t', 1, 25, 12], ['t', 2, 25, 0], ['t', 3, 40, 3]]);
  assert.deepEqual(counted, { pages: 1, brokenPages: 0, thumbs: 3, brokenThumbs: 1, broken: ['t1'] });
});

test('画面に流し込む式は、文法として正しい', () => {
  assert.doesNotThrow(() => new vm.Script(`(${installWatch.toString()})()`));
});
