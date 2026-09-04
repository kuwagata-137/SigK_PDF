'use strict';

// 分割の計画とファイル名の規則（spec-2-2 確定事項7〜13・15〜19）。純関数なので
// jsdom を要さない。範囲抽出は page-range.js に委ねるので、先に読み込む。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-range.js');
require('../renderer/split-plan.js');

const { MAX_OUTPUTS, planSplit, outputNames, pageLabel } = globalThis.SigK.splitPlan;

const pages = (from, to) => Array.from({ length: to - from + 1 }, (_value, index) => from + index);

// ---- N ページごと（確定事項8） ----

test('N ページごとに切り、余りは最後の1本になる', () => {
  assert.deepEqual(planSplit({ mode: 'every', every: 3 }, 7), {
    parts: [[0, 1, 2], [3, 4, 5], [6]],
  });
});

test('N がページ数以上なら1本になる（誤りではない）', () => {
  assert.deepEqual(planSplit({ mode: 'every', every: 40 }, 40), { parts: [pages(0, 39)] });
  assert.deepEqual(planSplit({ mode: 'every', every: 100 }, 40), { parts: [pages(0, 39)] });
});

test('N は 1 以上の整数。文字列と全角も受ける', () => {
  assert.deepEqual(planSplit({ mode: 'every', every: '２' }, 3), { parts: [[0, 1], [2]] });
  assert.equal(typeof planSplit({ mode: 'every', every: 0 }, 3).error, 'string');
  assert.equal(typeof planSplit({ mode: 'every', every: '' }, 3).error, 'string');
  assert.equal(typeof planSplit({ mode: 'every', every: '1.5' }, 3).error, 'string');
  assert.equal(typeof planSplit({ mode: 'every', every: 'a' }, 3).error, 'string');
});

// ---- 指定したページの前で切る（確定事項9） ----

test('指定したページの前で切る。順不同は昇順に並べ直す', () => {
  assert.deepEqual(planSplit({ mode: 'at', at: '3,7' }, 10), {
    parts: [[0, 1], [2, 3, 4, 5], [6, 7, 8, 9]],
  });
  assert.deepEqual(planSplit({ mode: 'at', at: '７、 3' }, 10), {
    parts: [[0, 1], [2, 3, 4, 5], [6, 7, 8, 9]],
  });
});

test('位置は 2〜ページ数。1・超過・重複・空は誤り', () => {
  assert.match(planSplit({ mode: 'at', at: '1' }, 10).error, /2/);
  assert.match(planSplit({ mode: 'at', at: '11' }, 10).error, /10ページまで/);
  assert.match(planSplit({ mode: 'at', at: '3,3' }, 10).error, /2回/);
  assert.equal(typeof planSplit({ mode: 'at', at: '' }, 10).error, 'string');
  assert.equal(typeof planSplit({ mode: 'at', at: '3,' }, 10).error, 'string');
  assert.equal(typeof planSplit({ mode: 'at', at: '3-5' }, 10).error, 'string');
});

test('最後のページの前で切ると、最後の1本は1ページになる', () => {
  assert.deepEqual(planSplit({ mode: 'at', at: '10' }, 10), { parts: [pages(0, 8), [9]] });
});

// ---- 範囲を取り出す（確定事項10） ----

test('範囲は書いた順に1本へまとめる。空欄は全ページ', () => {
  assert.deepEqual(planSplit({ mode: 'range', range: '3,1-2' }, 5), { parts: [[2, 0, 1]] });
  assert.deepEqual(planSplit({ mode: 'range', range: '' }, 3), { parts: [[0, 1, 2]] });
  assert.equal(typeof planSplit({ mode: 'range', range: '9' }, 5).error, 'string');
});

// ---- 共通（確定事項11・13） ----

test('出力数の上限を超えると断り、文言に本数を添える', () => {
  const result = planSplit({ mode: 'every', every: 1 }, MAX_OUTPUTS + 1);
  assert.match(result.error, new RegExp(`${MAX_OUTPUTS} ファイルまで`));
  assert.match(result.error, new RegExp(`${MAX_OUTPUTS + 1} ファイル`));
  assert.equal(planSplit({ mode: 'every', every: 1 }, MAX_OUTPUTS).parts.length, MAX_OUTPUTS);
});

test('ページ数が分からない・方式が不明なら誤り', () => {
  assert.equal(typeof planSplit({ mode: 'every', every: 1 }, 0).error, 'string');
  assert.equal(typeof planSplit({ mode: 'every', every: 1 }, null).error, 'string');
  assert.equal(typeof planSplit({ mode: 'zip' }, 3).error, 'string');
  assert.equal(typeof planSplit(null, 3).error, 'string');
});

// ---- ファイル名の規則（確定事項15〜17） ----

test('連番は出力数の桁と 3 の大きいほうでゼロ埋めする', () => {
  assert.deepEqual(outputNames('報告書.pdf', [[0], [1], [2]], 'seq'), ['報告書_001.pdf', '報告書_002.pdf', '報告書_003.pdf']);
  assert.deepEqual(outputNames('a.PDF', [[0]], 'seq'), ['a_001.pdf']);
  const many = outputNames('a.pdf', Array.from({ length: 1000 }, (_value, index) => [index]), 'seq');
  assert.equal(many[0], 'a_0001.pdf');
  assert.equal(many[999], 'a_1000.pdf');
});

test('ページ番号は先頭-末尾。1ページは単独、飛びは + でつなぐ', () => {
  assert.deepEqual(outputNames('a.pdf', [[0, 1, 2], [3], [4, 5]], 'pages'), ['a_p1-3.pdf', 'a_p4.pdf', 'a_p5-6.pdf']);
  assert.equal(pageLabel([0, 1, 2, 4]), 'p1-3+5');
  assert.equal(pageLabel([2, 0, 1]), 'p3+1-2');
  assert.equal(pageLabel([0, 0]), 'p1+1');
});

test('拡張子が無い元名でも同じ形になる', () => {
  assert.deepEqual(outputNames('memo', [[0]], 'pages'), ['memo_p1.pdf']);
});

test('規則が不明なら連番にする', () => {
  assert.deepEqual(outputNames('a.pdf', [[0]], 'nope'), ['a_001.pdf']);
});
