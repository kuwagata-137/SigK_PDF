'use strict';

// 印刷するページの解決（renderer/print-pages.js。spec-1-4 確定事項33〜35・docs/spec-7-7-print-dialog.md）。
// 印刷するページ（すべて・現在のページ・ページ指定）と、詳細オプション（現在の表示範囲・偶数または奇数ページ・逆順に印刷）。
// ページ指定の読み方そのものは test/print.test.js が見る（SigK.print から同じ名前で呼べる）。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/print-pages.js');

const pages = globalThis.SigK.printPages;

test('すべて・現在のページ・ページ指定を、1 起点のページ番号の並びにする', () => {
  assert.deepEqual(pages.resolvePages({ mode: 'all', pageCount: 4 }), { pages: [1, 2, 3, 4] });
  assert.deepEqual(pages.resolvePages({ mode: 'current', pageCount: 4, current: 2 }), { pages: [3] });
  assert.deepEqual(pages.resolvePages({ mode: 'custom', text: '4, 1-2', pageCount: 4 }), { pages: [1, 2, 4] });
});

test('現在の表示範囲は、現在のページだけを印刷する（切り出す範囲は画面の側で決める）', () => {
  assert.deepEqual(pages.resolvePages({ mode: 'view', pageCount: 9, current: 4 }), { pages: [5] });
});

test('偶数または奇数ページは、範囲の中のページ番号の奇数・偶数で絞る', () => {
  assert.deepEqual(pages.resolvePages({ mode: 'all', pageCount: 7, parity: 'odd' }), { pages: [1, 3, 5, 7] });
  assert.deepEqual(pages.resolvePages({ mode: 'all', pageCount: 7, parity: 'even' }), { pages: [2, 4, 6] });
  assert.deepEqual(pages.resolvePages({ mode: 'custom', text: '2-6', pageCount: 7, parity: 'odd' }), { pages: [3, 5] });
  assert.deepEqual(pages.resolvePages({ mode: 'all', pageCount: 3, parity: 'all' }), { pages: [1, 2, 3] });
});

test('逆順に印刷は、絞った後の並びを逆にする', () => {
  assert.deepEqual(pages.resolvePages({ mode: 'all', pageCount: 5, reverse: true }), { pages: [5, 4, 3, 2, 1] });
  assert.deepEqual(pages.resolvePages({ mode: 'all', pageCount: 6, parity: 'even', reverse: true }), { pages: [6, 4, 2] });
});

test('絞った結果が 0 ページなら理由を返す', () => {
  assert.match(pages.resolvePages({ mode: 'current', pageCount: 5, current: 0, parity: 'even' }).error, /印刷するページがありません/);
});

test('上限 100 ページは、絞った後のページ数で数える', () => {
  assert.equal(pages.resolvePages({ mode: 'all', pageCount: 200, parity: 'odd' }).pages.length, 100);
  assert.match(pages.resolvePages({ mode: 'all', pageCount: 202, parity: 'odd' }).error, /101 ページが指定されていますが、一度に印刷できるのは 100 ページまでです/);
});

test('文書が開かれていない・印刷するページを選んでいない時は理由を返す', () => {
  assert.match(pages.resolvePages({ mode: 'all', pageCount: 0 }).error, /文書が開かれていません/);
  assert.match(pages.resolvePages({ mode: 'other', pageCount: 3 }).error, /印刷するページを選択してください/);
});

test('ページ指定の欄に、灰色で表示する範囲「1 - 総ページ数」を作る', () => {
  assert.equal(pages.rangeHint(21), '1 - 21');
  assert.equal(pages.rangeHint(1), '1');
  assert.equal(pages.rangeHint(0), '');
});
