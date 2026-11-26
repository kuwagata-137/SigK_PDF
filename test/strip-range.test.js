'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-range.js');
require('../renderer/strip-range.js');
const { numberingMatches, displayNumbers, fileNumbers, describe } = globalThis.SigK.stripRange;

// 帯で選択したページ（表示の並びの位置。strip-selection.js）を、範囲欄の番号にする（版 1.5.0 の②。docs/spec-7-11-view-font.md）。
// 並びの要素は { src, rotate }（元ファイルの 0 始まりのページ）か { insert, rotate }（差し込んだページ）。

const plain = (count) => Array.from({ length: count }, (_value, index) => ({ src: index, rotate: 0 }));

test('numberingMatches は、並びの番号がファイルのページ番号と同じ時だけ true', () => {
  assert.equal(numberingMatches(plain(5), 5), true);
  assert.equal(numberingMatches(plain(5).map((page) => ({ ...page, rotate: 90 })), 5), true, '回転だけなら番号は同じ');
  assert.equal(numberingMatches([{ src: 0, rotate: 0, crop: [0, 0, 10, 10] }, { src: 1, rotate: 0 }], 2), true, 'トリミングだけなら番号は同じ');
  const moved = plain(5);
  moved.splice(1, 0, moved.splice(4, 1)[0]);
  assert.equal(numberingMatches(moved, 5), false, '5 ページ目を 2 番目へ移動した');
  assert.equal(numberingMatches(plain(5).slice(0, 4), 5), false, '最後のページを削除した');
  assert.equal(numberingMatches([{ src: 0, rotate: 0 }, { insert: 0, rotate: 0 }], 1), false, 'ページを差し込んだ');
  assert.equal(numberingMatches(null, 3), false);
});

test('displayNumbers は表示の位置を 1 始まりの番号にする', () => {
  assert.deepEqual(displayNumbers([3, 1, 2]), [4, 2, 3]);
  assert.deepEqual(displayNumbers([0, -1, 1.5, null]), [1]);
});

test('fileNumbers は表示の位置を、ファイルのページ番号（1 始まり）にする。差し込んだページは番号が無いので除く', () => {
  const plan = [{ src: 0, rotate: 0 }, { src: 4, rotate: 0 }, { src: 1, rotate: 0 }, { insert: 0, rotate: 0 }];
  assert.deepEqual(fileNumbers(plan, [1, 2]), [5, 2]);
  assert.deepEqual(fileNumbers(plan, [3]), []);
  assert.deepEqual(fileNumbers(plan, [9]), [], '並びの外の位置は除く');
});

test('describe は、表示の位置とファイルのページ番号の両方の文字列と、番号が同じかを返す', () => {
  assert.deepEqual(describe({ plan: plain(40), pageCount: 40, indices: [1, 2, 3, 6] }), { matches: true, display: '2-4, 7', file: '2-4, 7' });
  const moved = plain(40);
  moved.splice(1, 0, moved.splice(4, 1)[0]);
  assert.deepEqual(describe({ plan: moved, pageCount: 40, indices: [1] }), { matches: false, display: '2', file: '5' }, '質問 RG2 の例');
  assert.deepEqual(describe({ plan: plain(3), pageCount: 3, indices: [] }), { matches: true, display: '', file: '' });
});
