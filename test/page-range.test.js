'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-range.js');
const { parsePageRange, normalize } = globalThis.SigK.pageRange;

// 結合のページ範囲（spec-2-1 確定事項18〜20）。戻り値は 0 始まり。

test('空欄はすべてのページ', () => {
  assert.deepEqual(parsePageRange('', 3), { pages: [0, 1, 2] });
  assert.deepEqual(parsePageRange('   ', 3), { pages: [0, 1, 2] });
  assert.deepEqual(parsePageRange(null, 2), { pages: [0, 1] });
});

test('カンマ区切り・ハイフンの範囲・片側省略', () => {
  assert.deepEqual(parsePageRange('1-3,5,8-', 10), { pages: [0, 1, 2, 4, 7, 8, 9] });
  assert.deepEqual(parsePageRange('-2', 5), { pages: [0, 1] });
  assert.deepEqual(parsePageRange('4-', 5), { pages: [3, 4] });
  assert.deepEqual(parsePageRange('3', 5), { pages: [2] });
});

test('空白は無視し、全角の数字・カンマ・ハイフン類も受ける', () => {
  assert.deepEqual(parsePageRange(' 1 - 3 , 5 ', 5), { pages: [0, 1, 2, 4] });
  assert.deepEqual(parsePageRange('１－３，５', 5), { pages: [0, 1, 2, 4] });
  assert.deepEqual(parsePageRange('1ー3、5', 5), { pages: [0, 1, 2, 4] });
  assert.deepEqual(parsePageRange('1〜3', 5), { pages: [0, 1, 2] });
  assert.deepEqual(parsePageRange('1～3', 5), { pages: [0, 1, 2] });
  assert.equal(normalize('１ー３、５'), '1-3,5');
});

test('逆順は正順と同じに扱う', () => {
  assert.deepEqual(parsePageRange('5-3', 5), { pages: [2, 3, 4] });
});

test('同じページを2回書けば2回入り、順序も書いたとおり', () => {
  assert.deepEqual(parsePageRange('3,1,3', 5), { pages: [2, 0, 2] });
  assert.deepEqual(parsePageRange('2-3,1-2', 5), { pages: [1, 2, 0, 1] });
});

test('ページ数を超える番号は「nページまでです」', () => {
  assert.deepEqual(parsePageRange('2,12', 8), { error: '8ページまでです' });
  assert.deepEqual(parsePageRange('9-', 8), { error: '8ページまでです' });
  assert.deepEqual(parsePageRange('1-9', 8), { error: '8ページまでです' });
});

test('0 は指定できない', () => {
  assert.deepEqual(parsePageRange('0', 8), { error: 'ページは 1 から数えます' });
  assert.deepEqual(parsePageRange('0-3', 8), { error: 'ページは 1 から数えます' });
});

test('数字でない文字・空の要素・ハイフンだけは記法の誤り', () => {
  const error = { error: '1-3,5 のように書いてください' };
  assert.deepEqual(parsePageRange('a', 8), error);
  assert.deepEqual(parsePageRange('1,,3', 8), error);
  assert.deepEqual(parsePageRange('1,', 8), error);
  assert.deepEqual(parsePageRange('-', 8), error);
  assert.deepEqual(parsePageRange('1-2-3', 8), error);
  assert.deepEqual(parsePageRange('1.5', 8), error);
});

test('ページ数が分からない文書には何も返さない', () => {
  assert.deepEqual(parsePageRange('1', null), { error: 'ページ数が分かりません' });
  assert.deepEqual(parsePageRange('', 0), { pages: [] });
});
