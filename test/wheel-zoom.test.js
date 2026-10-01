'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/wheel-zoom.js');

// ホイールで回した量を溜めて、拡大・縮小の段にする（spec-4b-3b 確定事項C3。決定55）。溜めた量が 50 を超えたら 1 段。
// 上へ回す（deltaY が負）と +1（拡大）、下へ回すと -1（縮小）。1 段進めたら 0 に戻す。向きが変わるか 250ms 空いたら溜め直す。

const { THRESHOLD, IDLE_MS, deltaOf, accumulate } = globalThis.SigK.wheelZoom;

function run(deltas, { gap = 16 } = {}) {
  let acc = null;
  const steps = [];
  deltas.forEach((delta, i) => {
    const result = accumulate(acc, delta, i * gap);
    acc = result.acc;
    steps.push(result.step);
  });
  return steps;
}

test('溜める量と間の既定は 50 と 250ms', () => {
  assert.equal(THRESHOLD, 50);
  assert.equal(IDLE_MS, 250);
});

test('マウスの 1 目盛り（100 前後）は 1 回で 1 段。上は拡大、下は縮小', () => {
  assert.deepEqual(run([-100]), [1]);
  assert.deepEqual(run([100]), [-1]);
  assert.deepEqual(run([-120, -120, -120]), [1, 1, 1]);
});

test('表示の拡大率で 1 目盛りが 125 でも、1 回で 1 段のまま（余りを持ち越さない）。大きく回しても 1 回 1 段まで', () => {
  assert.deepEqual(run([-125, -125, -125, -125]), [1, 1, 1, 1]);
  assert.deepEqual(run([-300]), [1]);
});

test('タッチパッドの細かい量は、溜まって 50 を超えたところで 1 段', () => {
  assert.deepEqual(run([-8, -8, -8, -8, -8, -8, -8]), [0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(run([12, 12, 12, 12, 12, 12]), [0, 0, 0, 0, -1, 0], '60 で 1 段、0 に戻って 12');
});

test('向きが変わったら溜め直す', () => {
  assert.deepEqual(run([-40, 40, 40]), [0, 0, -1]);
});

test('250ms より空いたら溜め直す', () => {
  assert.deepEqual(run([-40, -40], { gap: 300 }), [0, 0]);
  assert.deepEqual(run([-40, -40], { gap: 200 }), [0, 1]);
});

test('deltaOf は deltaMode を px に揃える（行は 40 倍、ページは 800 倍）', () => {
  assert.equal(deltaOf({ deltaY: -100, deltaMode: 0 }), -100);
  assert.equal(deltaOf({ deltaY: 3, deltaMode: 1 }), 120);
  assert.equal(deltaOf({ deltaY: -1, deltaMode: 2 }), -800);
  assert.equal(deltaOf({ deltaY: 5 }), 5);
});
