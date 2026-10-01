'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-selection.js');

// 選んでいる書き込みの鍵の並び（spec-4b-3a 確定事項A・K・L）。並びの最後が主。

const sel = globalThis.SigK.annotationSelection;

// 鍵 → ページ。a・b・c は 1 ページ目、x・y は 2 ページ目。
const PAGES = { a: 0, b: 0, c: 0, d: 0, x: 1, y: 1 };
const pageOf = (key) => PAGES[key];

test('withKey は鍵を最後（主）へ置き、すでにあれば最後へ動かす。withoutKey は外す', () => {
  assert.deepEqual(sel.withKey(['a', 'b'], 'c'), ['a', 'b', 'c']);
  assert.deepEqual(sel.withKey(['a', 'b', 'c'], 'a'), ['b', 'c', 'a']);
  assert.deepEqual(sel.withoutKey(['a', 'b', 'c'], 'b'), ['a', 'c']);
  assert.deepEqual(sel.withoutKey(['a'], 'z'), ['a']);
});

test('toggled は無ければ足し、あれば外す', () => {
  assert.deepEqual(sel.toggled(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(sel.toggled(['a', 'b'], 'a'), ['b']);
});

test('merged は重なりを除いて後ろへ足し、最後に足したものが主になる', () => {
  assert.deepEqual(sel.merged(['a', 'b'], ['c', 'a']), ['b', 'c', 'a']);
  assert.deepEqual(sel.merged([], ['a', 'a']), ['a']);
});

test('onOnePage は同じページなら足し、主と別のページの鍵なら、その 1 件だけに替える（決定52 ②）', () => {
  assert.deepEqual(sel.onOnePage(['a', 'b'], 'c', pageOf), ['a', 'b', 'c']);
  assert.deepEqual(sel.onOnePage(['a', 'b'], 'x', pageOf), ['x']);
  assert.deepEqual(sel.onOnePage([], 'x', pageOf), ['x']);
});

test('rangeOf は起点から押した行までの、起点と同じページの行を起点の側から並べる（確定事項K2）', () => {
  const rows = ['a', 'b', 'c', 'd', 'x', 'y'];
  assert.deepEqual(sel.rangeOf(rows, 'b', 'd', pageOf), ['b', 'c', 'd']);
  assert.deepEqual(sel.rangeOf(rows, 'd', 'a', pageOf), ['d', 'c', 'b', 'a']);
  // 押した行が起点と別のページなら、その 1 件だけ。
  assert.deepEqual(sel.rangeOf(rows, 'b', 'y', pageOf), ['y']);
  // 起点が一覧に無ければ、その 1 件だけ。
  assert.deepEqual(sel.rangeOf(rows, 'gone', 'c', pageOf), ['c']);
});

test('sameKeys は順を見ずに同じ鍵の集まりかを見る', () => {
  assert.equal(sel.sameKeys(['a', 'b'], ['b', 'a']), true);
  assert.equal(sel.sameKeys(['a', 'b'], ['a']), false);
  assert.equal(sel.sameKeys(['a', 'b'], ['a', 'c']), false);
  assert.equal(sel.sameKeys([], []), true);
});

test('annotKeys は履歴に残す形（0 件 null・1 件は文字列・2 件以上は写した配列）にし、keysOf で戻せる（確定事項L1）', () => {
  assert.equal(sel.annotKeys([]), null);
  assert.equal(sel.annotKeys(['a']), 'a');
  const keys = ['a', 'b'];
  const kept = sel.annotKeys(keys);
  assert.deepEqual(kept, ['a', 'b']);
  assert.notEqual(kept, keys, '配列は写して返す');
  assert.deepEqual(sel.keysOf(null), []);
  assert.deepEqual(sel.keysOf('a'), ['a']);
  assert.deepEqual(sel.keysOf(['a', 'b', 'a']), ['a', 'b']);
});

test('unique は空や文字列でない鍵を落とす', () => {
  assert.deepEqual(sel.unique(['a', '', null, 'a', 3, 'b']), ['a', 'b']);
});
