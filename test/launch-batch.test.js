'use strict';

// 起動要求の束の印のテスト（spec-5-1 確定事項3〜5）。
//
// 依存なしで回る層である。時計は差し替えて、窓の境目をミリ秒単位で確かめる。
// 束は「直前の要求と意図が同じで、間隔が W 以下」なら続く。静まるのを待って
// まとめる形ではないので、どの要求もすぐ返る（論点1）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { BATCH_WINDOW_MS, createLaunchBatcher } = require('../launch-batch.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const C = 'C:\\work\\c.pdf';

// 呼ぶたびに決めた時刻を返す時計。
function clockOf(...times) {
  let at = 0;
  return () => times[at++];
}

test('W は 2000ms（事前調査 A3 の最大間隔 362ms の 3 倍より長い）', () => {
  assert.equal(BATCH_WINDOW_MS, 2000);
});

test('最初の要求は新しい束の先頭になる', () => {
  const batcher = createLaunchBatcher({ now: clockOf(0) });

  assert.deepEqual(batcher.assign({ intent: 'merge', paths: [A] }),
    { intent: 'merge', paths: [A], batch: { id: 1, first: true } });
});

test('同じ操作が W 以内に続けば同じ束で、先頭の印は 1 回だけ', () => {
  const batcher = createLaunchBatcher({ now: clockOf(0, 300, 650) });

  const batches = [A, B, C].map((p) => batcher.assign({ intent: 'merge', paths: [p] }).batch);

  assert.deepEqual(batches, [{ id: 1, first: true }, { id: 1, first: false }, { id: 1, first: false }]);
});

test('【境目】間隔が W ちょうどなら同じ束、W を 1ms 超えれば別の束', () => {
  const batcher = createLaunchBatcher({ windowMs: 2000, now: clockOf(0, 2000, 4001) });

  assert.deepEqual(batcher.assign({ intent: 'merge', paths: [A] }).batch, { id: 1, first: true });
  assert.deepEqual(batcher.assign({ intent: 'merge', paths: [B] }).batch, { id: 1, first: false });
  assert.deepEqual(batcher.assign({ intent: 'merge', paths: [C] }).batch, { id: 2, first: true });
});

test('間隔は直前の要求から測る（束の長さは W を超えてよい）', () => {
  // 20 個選ぶと届き終わるまで 1.8 秒かかる（事前調査 A3）。先頭から測ると割れる。
  const batcher = createLaunchBatcher({ now: clockOf(0, 1500, 3000, 4500) });

  const ids = [A, B, C, A].map((p) => batcher.assign({ intent: 'merge', paths: [p] }).batch.id);

  assert.deepEqual(ids, [1, 1, 1, 1]);
});

test('操作が変われば、W 以内でも別の束になる', () => {
  const batcher = createLaunchBatcher({ now: clockOf(0, 100, 200) });

  const merge = batcher.assign({ intent: 'merge', paths: [A] });
  const open = batcher.assign({ intent: 'open', paths: [B] });
  const back = batcher.assign({ intent: 'merge', paths: [C] });

  assert.deepEqual([merge.batch, open.batch, back.batch],
    [{ id: 1, first: true }, { id: 2, first: true }, { id: 3, first: true }]);
});

test('パスの配列は写して返す（受け取った配列を書き換えても印の結果は変わらない）', () => {
  const batcher = createLaunchBatcher({ now: clockOf(0) });
  const paths = [A, B];

  const result = batcher.assign({ intent: 'open', paths });
  paths.push(C);

  assert.deepEqual(result.paths, [A, B]);
});

test('時計を渡さなければ、戻らない時計（performance.now）で測る', () => {
  const batcher = createLaunchBatcher();

  const first = batcher.assign({ intent: 'split', paths: [A] });
  const second = batcher.assign({ intent: 'split', paths: [B] });

  assert.deepEqual([first.batch, second.batch], [{ id: 1, first: true }, { id: 1, first: false }]);
});
