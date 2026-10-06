'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/edit-bar-fit.js');

// 道具の段に入りきらない道具を決める純粋層（spec-4b-5b 確定事項25。事前調査 G）。

const { EPSILON, fitOf } = globalThis.SigK.editBarFit;

const item = (width = 48) => ({ width, sep: false });
const sep = () => ({ width: 7, sep: true });

test('入りきれば全部見せ、「その他」は出さない', () => {
  const children = [item(), item(), sep(), item()];
  // 48 + 5 + 48 + 5 + 7 + 5 + 48 = 166、左右の余白 14 を足して 194
  assert.deepEqual(fitOf({ children, available: 194, gap: 5, padding: [14, 14], moreWidth: 48 }), { count: 4, more: false });
  assert.deepEqual(fitOf({ children, available: 194 - EPSILON, gap: 5, padding: [14, 14], moreWidth: 48 }), { count: 4, more: false }, '丸めのぶんは許す');
});

test('入りきらなければ右から隠し、「その他」の幅と間を空ける', () => {
  const children = [item(), item(), item(), item(), item()];
  // 全部は 48×5＋5×4＝260。3 つ（48×3＋5×2＝154）＋間 5＋「その他」48＝207
  assert.deepEqual(fitOf({ children, available: 207, gap: 5, moreWidth: 48 }), { count: 3, more: true });
  assert.deepEqual(fitOf({ children, available: 206, gap: 5, moreWidth: 48 }), { count: 2, more: true });
});

test('見せる子の末尾に残る区切り線は隠す', () => {
  const children = [item(), item(), sep(), item(), item(), item()];
  // 2 つと区切り線（48＋5＋48＋5＋7＝113）までは入るが、区切り線を末尾に残さず 2 つにする。
  const fit = fitOf({ children, available: 113 + 5 + 48, gap: 5, moreWidth: 48 });
  assert.deepEqual(fit, { count: 2, more: true });
  // 区切り線の右の道具まで入れば区切り線ごと見せる。
  assert.deepEqual(fitOf({ children, available: 113 + 5 + 48 + 5 + 48, gap: 5, moreWidth: 48 }), { count: 4, more: true });
});

test('何も入らなければ「その他」だけ', () => {
  assert.deepEqual(fitOf({ children: [item(), item()], available: 60, gap: 5, moreWidth: 48 }), { count: 0, more: true });
  assert.deepEqual(fitOf({ children: [sep(), item(100)], available: 60, gap: 5, moreWidth: 48 }), { count: 0, more: true });
  assert.deepEqual(fitOf({ children: [], available: 0 }), { count: 0, more: false });
});

// 事前調査 G の 944px（中身）: ペンの後ろにマーカー・消しゴムを足すと右端 954px（右の余白 14 で 968）。「その他」48px で消しゴム・ノートが入る。
test('944px の段では、右端の 2 つ（消しゴム・ノート）が「その他」に入る', () => {
  // 右端の 4 つ（ペン・マーカー・消しゴム・ノート）の手前までを 1 つにまとめた幅と、4 つの幅で、右端 954px の段を組む。
  const tail = [item(48), item(48), item(48), item(48)];
  const head = { width: 954 - 14 - (48 * 4 + 5 * 4), sep: false };
  const fit = fitOf({ children: [head, ...tail], available: 944, gap: 5, padding: [14, 14], moreWidth: 48 });
  assert.deepEqual(fit, { count: 3, more: true });
});
