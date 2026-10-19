'use strict';

// 分割の盤（spec-2-2b 確定事項B1〜B6・C1〜C7）。分け目と書き出さないページだけを持つ純粋な層なので、jsdom を要さない。
// 上限の 500 は split-plan.js の MAX_OUTPUTS を使うので、先に読み込む。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-range.js');
require('../renderer/split-plan.js');
require('../renderer/split-board-model.js');

const board = globalThis.SigK.splitBoard;

// 1 始まりのページ番号の並びで書けるように（テストを読みやすくするため）。
const at = (...pages) => pages.map((page) => page - 1);
const withCuts = (pageCount, cuts, skipped = []) => ({ pageCount, cuts: at(...cuts), skipped: at(...skipped) });

test('入れた直後は分け目なしの箱 1 つで、実行できない理由は untouched', () => {
  const fresh = board.create(12);
  assert.deepEqual(fresh, { pageCount: 12, cuts: [], skipped: [] });
  assert.deepEqual(board.boxes(fresh).map(({ start, end, file }) => ({ start, end, file })), [{ start: 0, end: 11, file: 1 }]);
  assert.deepEqual(board.status(fresh), { ready: false, reason: 'untouched', files: 1 });
});

test('✂ はそのページの前に分け目を入れる。範囲の外と、もうある分け目は同じ盤を返す', () => {
  const fresh = board.create(12);
  const cut = board.cut(fresh, at(5)[0]);
  assert.deepEqual(cut.cuts, at(5));
  assert.equal(board.cut(cut, at(5)[0]), cut);
  assert.equal(board.cut(fresh, 0), fresh);    // 1 ページ目の前では切れない
  assert.equal(board.cut(fresh, 12), fresh);   // 最後のページの後ろは無い
  assert.deepEqual(board.cut(board.cut(fresh, at(9)[0]), at(5)[0]).cuts, at(5, 9));   // 昇順に並べる
});

test('箱は分け目で区切った続きの範囲で、書き出すページのある箱に上から番号を振る', () => {
  const split = withCuts(12, [5, 9], [12]);
  assert.deepEqual(board.boxes(split), [
    { index: 0, start: 0, end: 3, keptCount: 4, skippedCount: 0, first: 0, last: 3, file: 1 },
    { index: 1, start: 4, end: 7, keptCount: 4, skippedCount: 0, first: 4, last: 7, file: 2 },
    { index: 2, start: 8, end: 11, keptCount: 3, skippedCount: 1, first: 8, last: 10, file: 3 },
  ]);
});

test('全部が書き出さないページの箱は番号を振らず、ファイルを作らない', () => {
  const split = withCuts(6, [3, 5], [3, 4]);
  assert.deepEqual(board.boxes(split).map((box) => box.file), [1, null, 2]);
  assert.deepEqual(board.parts(split), [[0, 1], [4, 5]]);
});

test('parts は書き出さないページを除いた 0 始まりの並び。書き出さないページは分け目を作らない', () => {
  assert.deepEqual(board.parts(withCuts(12, [5, 9], [12])), [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10]]);
  assert.deepEqual(board.parts(withCuts(5, [], [2, 4])), [[0, 2, 4]]);
});

test('boxOf はページの入っている箱の番号を返す', () => {
  const split = withCuts(12, [5, 9]);
  assert.deepEqual(at(1, 4, 5, 8, 9, 12).map((page) => board.boxOf(split, page)), [0, 0, 1, 1, 2, 2]);
});

test('つなげるは、その箱の頭の分け目を消す。最初の箱と範囲の外は同じ盤を返す', () => {
  const split = withCuts(12, [5, 9]);
  assert.deepEqual(board.join(split, 2).cuts, at(5));
  assert.deepEqual(board.join(split, 1).cuts, at(9));
  assert.equal(board.join(split, 0), split);
  assert.equal(board.join(split, 3), split);
});

test('1 つのファイルにすると、範囲の両端に分け目を入れ、中の分け目と書き出さない印を消す（決定76 ⑩）', () => {
  const split = withCuts(12, [5, 9], [10]);
  const one = board.makeOne(split, at(4)[0], at(10)[0]);
  assert.deepEqual(one.cuts, at(4, 11));
  assert.deepEqual(one.skipped, []);
  assert.deepEqual(board.parts(one), [[0, 1, 2], [3, 4, 5, 6, 7, 8, 9], [10, 11]]);
});

test('1 つのファイルにする範囲が先頭や末尾に届いていれば、そこには分け目を入れない', () => {
  const one = board.makeOne(withCuts(12, [5]), 0, at(12)[0]);
  assert.deepEqual(one.cuts, []);
  assert.deepEqual(board.makeOne(board.create(12), 0, at(3)[0]).cuts, at(4));
});

test('書き出さない印を付ける・外す。分け目は変えない。変わらなければ同じ盤を返す', () => {
  const split = withCuts(12, [5]);
  const skipped = board.setSkipped(split, at(3)[0], at(6)[0], true);
  assert.deepEqual(skipped.skipped, at(3, 4, 5, 6));
  assert.deepEqual(skipped.cuts, at(5));
  assert.deepEqual(board.setSkipped(skipped, at(4)[0], at(5)[0], false).skipped, at(3, 6));
  assert.equal(board.setSkipped(split, 0, 2, false), split);
  assert.equal(board.setSkipped(skipped, at(3)[0], at(4)[0], true), skipped);
});

test('まとめて分ける 4 つは分け目を全部消してから入れ直し、書き出さない印は残す（決定76 ⑨）', () => {
  const split = withCuts(10, [2, 8], [4]);
  assert.deepEqual(board.splitEach(split), withCuts(10, [2, 3, 4, 5, 6, 7, 8, 9, 10], [4]));
  assert.deepEqual(board.splitEvery(split, 3), withCuts(10, [4, 7, 10], [4]));
  assert.deepEqual(board.splitBefore(split, [7, 3]), withCuts(10, [3, 7], [4]));
  assert.deepEqual(board.clearCuts(split), withCuts(10, [], [4]));
  assert.deepEqual(board.splitEvery(split, 20).cuts, []);
});

test('実行できるか: 分け目か書き出さない印があれば ready、書き出すページが無ければ empty、500 を超えれば too-many', () => {
  assert.deepEqual(board.status(withCuts(12, [5, 9])), { ready: true, reason: null, files: 3 });
  assert.deepEqual(board.status(withCuts(12, [], [12])), { ready: true, reason: null, files: 1 });
  assert.deepEqual(board.status(withCuts(3, [], [1, 2, 3])), { ready: false, reason: 'empty', files: 0 });
  assert.deepEqual(board.status(board.splitEach(board.create(640))), { ready: false, reason: 'too-many', files: 640 });
  assert.deepEqual(board.status(board.splitEach(board.create(500))), { ready: true, reason: null, files: 500 });
});

test('same は分け目と書き出さない印が同じかを見る', () => {
  assert.equal(board.same(withCuts(5, [2], [4]), withCuts(5, [2], [4])), true);
  assert.equal(board.same(withCuts(5, [2], [4]), withCuts(5, [3], [4])), false);
  assert.equal(board.same(withCuts(5, [2]), withCuts(5, [2], [4])), false);
});

test('5,000 ページを 1 ページずつにしても速く組める', () => {
  const started = Date.now();
  const each = board.splitEach(board.create(5000));
  const boxes = board.boxes(each);
  const parts = board.parts(each);
  assert.equal(boxes.length, 5000);
  assert.equal(parts.length, 5000);
  assert.equal(board.boxOf(each, 4321), 4321);
  assert.ok(Date.now() - started < 200, `${Date.now() - started}ms`);
});

test('setCuts は分け目をまとめて置き直し、範囲の外と重なりを捨てる。変わらなければ同じ盤', () => {
  // setCuts が受けるのは 0 始まりの位置（盤の cuts と同じ）。
  const start = withCuts(6, [3], [5]);
  assert.deepEqual(board.setCuts(start, [5, 0, 3, 3, 6]), withCuts(6, [4, 6], [5]));
  assert.equal(board.setCuts(start, [2]), start);
});

// 盤の中で動かしたあと（spec-2-5 I20）。動かしたページは落とした先の箱、ほかのページは元の箱に入る。from は動かす前の位置、to は動かしたあとの位置。
// ここだけは位置（from・to・答え）を 0 始まりで書く（page-transfer.js が渡す位置と同じ）。
test('cutsAfterMove は、ページごとの箱の番号が変わる所を新しい分け目にする', () => {
  const twelve = withCuts(12, [5]);
  // 3・4 ページ目（2・3）を箱 2 の末尾へ: [0,1,4..11,2,3]
  assert.deepEqual(board.cutsAfterMove(twelve, [2, 3], [10, 11], 1), [2]);
  // 4 ページ目（3）を箱 2 の 7 ページ目の前へ: [0,1,2,4,5,3,6..11]
  assert.deepEqual(board.cutsAfterMove(twelve, [3], [5], 1), [3]);
  // 4 ページ目を箱 1 の先頭へ: [3,0,1,2,4..11]
  assert.deepEqual(board.cutsAfterMove(twelve, [3], [0], 0), [4]);
  // 箱 1 の全部を箱 2 へ動かすと箱 1 が空になり、分け目は消える
  assert.deepEqual(board.cutsAfterMove(withCuts(6, [3]), [0, 1], [4, 5], 1), []);
});
