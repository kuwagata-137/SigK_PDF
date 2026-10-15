'use strict';

// 分割の盤を帯（タブ）ごとに持つ層（spec-2-5 確定事項G5・G8。決定80 ㉟）。DOM に触れないので jsdom を要さない。
// 盤の中身の操作は split-board-model.test.js、画面の上の動きは split-board.test.js が見る。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-range.js');
require('../renderer/split-plan.js');
require('../renderer/split-board-model.js');
require('../renderer/split-board-history.js');
require('../renderer/split-board-store.js');

const SigK = globalThis.SigK;
const store = SigK.splitBoardStore;
const model = SigK.splitBoard;
const history = SigK.splitHistory;

// 1 始まりのページ番号で書けるように。
const at = (...pages) => pages.map((page) => page - 1);
const planOf = (...srcs) => srcs.map((src) => (typeof src === 'string' ? { insert: Number(src.slice(1)) } : { src: src - 1 }));
const viewOf = (doc, plan) => ({ doc, plan });
const current = (entry) => history.current(entry.history);

test('並びのページの鍵は、元のページなら s・差し込んだページなら i と番号', () => {
  assert.deepEqual(store.pageKeys(planOf(1, 2, 'i0', 3)), ['s0', 's1', 'i0', 's2']);
});

test('ずらす: 分け目は前のページで追い、前のページが消えたら直前に残るページへ寄せる', () => {
  const keys = store.pageKeys(planOf(1, 2, 3, 4, 5, 6));
  const board = { pageCount: 6, cuts: at(3, 5), skipped: at(6) };
  // 2 ページ目を消した: 3 ページ目の前（2 の後ろ）の分け目は 1 の後ろへ寄る。5 の前（4 の後ろ）は 4 の後ろのまま。
  const removed = store.remap(board, keys, store.pageKeys(planOf(1, 3, 4, 5, 6)));
  assert.deepEqual(removed, { pageCount: 5, cuts: at(2, 4), skipped: at(5) });
  // 1・2 ページ目を消した: 2 の後ろの分け目は前に残るページが無いので捨てる。
  const head = store.remap(board, keys, store.pageKeys(planOf(3, 4, 5, 6)));
  assert.deepEqual(head, { pageCount: 4, cuts: at(3), skipped: at(4) });
});

test('ずらす: 並べ替え・差し込みのあとも、分け目と書き出さない印はページについて動く', () => {
  const keys = store.pageKeys(planOf(1, 2, 3, 4));
  const board = { pageCount: 4, cuts: at(3), skipped: at(2) };
  // 4 ページ目を先頭へ、2 の後ろに差し込み。分け目は 2 の後ろ（＝差し込みの前）に残り、2 の印も 2 についていく。
  const moved = store.remap(board, keys, store.pageKeys(planOf(4, 1, 2, 'i0', 3)));
  assert.deepEqual(moved, { pageCount: 5, cuts: at(4), skipped: at(3) });
  // 同じ所へ 2 つ寄ったら 1 つにする。
  const merged = store.remap({ pageCount: 4, cuts: at(2, 3, 4), skipped: [] }, keys, store.pageKeys(planOf(1, 4)));
  assert.deepEqual(merged, { pageCount: 2, cuts: at(2), skipped: [] });
  // 前のページが末尾へ動いたら、分け目は範囲の外になるので捨てる。
  const tail = store.remap({ pageCount: 2, cuts: at(2), skipped: [] }, ['s0', 's1'], ['s1', 's0']);
  assert.deepEqual(tail, { pageCount: 2, cuts: [], skipped: [] });
});

test('帯ごとに覚える: 初めての帯は分け目なしの盤、戻ると前の盤と記録が残っている（決定80 ㉟）', () => {
  store.clear();
  const docA = {};
  const docB = {};
  const a = viewOf(docA, planOf(1, 2, 3));
  const b = viewOf(docB, planOf(1, 2));
  const first = store.entryFor(1, a);
  assert.equal(first.notice, null);
  assert.deepEqual(current(first), model.create(3));
  store.set(1, history.push(first.history, model.cut(current(first), 1)));
  assert.deepEqual(current(store.entryFor(2, b)), model.create(2), '別の帯は別の盤');
  const back = store.entryFor(1, a);
  assert.deepEqual(current(back).cuts, [1]);
  assert.equal(history.canUndo(back.history), true, 'Ctrl+Z の記録も残っている');
});

test('同じ文書で並びが変わったら、記録の盤を全部ずらす', () => {
  store.clear();
  const doc = {};
  const before = viewOf(doc, planOf(1, 2, 3, 4));
  let h = store.entryFor(1, before).history;
  h = history.push(h, model.cut(history.current(h), 2));
  h = history.push(h, model.cut(history.current(h), 3));
  store.set(1, h);
  const after = store.entryFor(1, viewOf(doc, planOf(1, 3, 4)));
  assert.equal(after.notice, null, '並びが変わっただけなら知らせない');
  assert.deepEqual(current(after), { pageCount: 3, cuts: at(2, 3), skipped: [] });
  const undone = history.undo(after.history);
  assert.deepEqual(history.current(undone), { pageCount: 3, cuts: at(2), skipped: [] });
});

test('文書が替わったとき（保存して開き直した）: ページ数が同じなら位置のまま、違えば作り直して知らせる', () => {
  store.clear();
  const old = {};
  const entry = store.entryFor(1, viewOf(old, planOf(1, 2, 'i0', 3)));
  store.set(1, history.push(entry.history, model.cut(current(entry), 2)));
  const saved = store.entryFor(1, viewOf({}, planOf(1, 2, 3, 4)));
  assert.equal(saved.notice, null);
  assert.deepEqual(current(saved).cuts, [2], 'ページ数が同じなら位置のまま');
  const recount = store.entryFor(1, viewOf({}, planOf(1, 2)));
  assert.equal(recount.notice, 'recount');
  assert.deepEqual(current(recount), model.create(2));
  assert.equal(history.canUndo(recount.history), false, '記録も作り直す');
  assert.equal(store.entryFor(1, viewOf({}, planOf(1, 2))).notice, null, '知らせるのは作り直したときだけ');
});

test('閉じた帯は捨てる（forget・prune）', () => {
  store.clear();
  const view = viewOf({}, planOf(1, 2, 3));
  for (const id of [1, 2, 3]) {
    const entry = store.entryFor(id, view);
    store.set(id, history.push(entry.history, model.cut(current(entry), 1)));
  }
  store.forget(1);
  store.prune([3]);
  assert.deepEqual(store.ids(), [3]);
  assert.deepEqual(current(store.entryFor(2, view)), model.create(3), '捨てた帯は分け目なしに戻る');
});
