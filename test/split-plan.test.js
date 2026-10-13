'use strict';

// 分割の欄の読み取りとファイル名の規則（spec-2-2 確定事項13・15〜19、spec-2-2b 確定事項C7）。純関数なので
// jsdom を要さない。全角をそろえるのは page-range.js の normalize なので、先に読み込む。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-range.js');
require('../renderer/split-plan.js');

const { MAX_OUTPUTS, outputNames, pageLabel } = globalThis.SigK.splitPlan;

test('出力数の上限は 500 本（spec-2-2 確定事項13。盤の status が使う）', () => {
  assert.equal(MAX_OUTPUTS, 500);
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

// ---- まとめて分けるの欄（spec-2-2b 確定事項C7。文は第 I 章） ----

const { parseEvery, parseCuts } = globalThis.SigK.splitPlan;

test('parseEvery は 1 以上の整数を読む。全角も受け、ほかは誤り', () => {
  assert.deepEqual(parseEvery('3'), { n: 3 });
  assert.deepEqual(parseEvery(' ２ '), { n: 2 });
  for (const text of ['', '0', '1.5', 'a', '-2'])
    assert.deepEqual(parseEvery(text), { error: '1 以上の整数を書いてください' }, text);
});

test('カンマのすぐ後に空白が無く 3 けたが続くときは、千の位の区切りとして読む（決定79 ②）', () => {
  assert.deepEqual(parseCuts('1,000', 1200), { numbers: [1000] });
  assert.deepEqual(parseCuts('3, 1,000', 1200), { numbers: [3, 1000] });
  assert.deepEqual(parseCuts('3,700', 5000), { numbers: [3700] });
  assert.deepEqual(parseCuts('3, 700', 5000), { numbers: [3, 700] }, '空白があれば番号の区切り');
  assert.deepEqual(parseCuts('3,7000', 9000), { numbers: [3, 7000] }, '4 けたなら番号の区切り');
  assert.deepEqual(parseCuts('１，０００', 1200), { numbers: [1000] }, '全角も同じ');
  assert.deepEqual(parseEvery('1,000'), { n: 1000 });
});

test('parseCuts は「そのページの前で切る」番号を読み、昇順に並べる', () => {
  assert.deepEqual(parseCuts('7, 3', 10), { numbers: [3, 7] });
  assert.deepEqual(parseCuts('３，１０', 10), { numbers: [3, 10] });
});

test('parseCuts の誤り: 書き方・1・ページ数を超える・重なり', () => {
  assert.deepEqual(parseCuts('', 10), { error: '3, 7 のように書いてください' });
  assert.deepEqual(parseCuts('3-5', 10), { error: '3, 7 のように書いてください' });
  assert.deepEqual(parseCuts('1, 4', 10), { error: '1 の前では切れないので、2 から書いてください' });
  assert.deepEqual(parseCuts('4, 12', 10), { error: '10 ページまでです' });
  assert.deepEqual(parseCuts('7, 3, 7', 10), { error: '7 が 2 回あります' });
  // 1,000 以上の数にはカンマを付ける（決定78 ③）。
  assert.deepEqual(parseCuts('1,000,000', 2000), { error: '2,000 ページまでです' });
  assert.deepEqual(parseCuts('4, 1300', 1200), { error: '1,200 ページまでです' });
  assert.deepEqual(parseCuts('1500, 1500', 2000), { error: '1,500 が 2 回あります' });
});
