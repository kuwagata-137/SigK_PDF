'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-draft.js');

// 図形・ペンの下書き（spec-4-3 確定事項3・4・6・9・10）。履歴も選択も知らない。

const draft = globalThis.SigK.shapeDraft;

// 倍率 2・回転 0 の viewport（A4）。
const viewport = {
  scale: 2, rotation: 0,
  convertToViewportPoint: (x, y) => [x * 2, (841.89 - y) * 2],
  convertToPdfPoint: (px, py) => [px / 2, 841.89 - py / 2],
};

function begin(kind, point = [200, 283.78], overrides = {}) {
  return draft.begin({ index: 0, src: 0, viewport, kind, point, color: '#d92c2c', lineWidth: 2, ...overrides });
}

const near = (actual, expected, eps = 0.02) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} は ${expected} に近くない`);

test('begin → update → draftFor で紙の座標の矩形が出る', () => {
  assert.equal(draft.isDrawing(), false);
  assert.equal(draft.draftFor(0), null);
  assert.equal(begin('square'), true);
  assert.equal(draft.isDrawing(), true);
  assert.equal(draft.update([600, 483.78]), true);
  const entry = draft.draftFor(0);
  assert.equal(entry.kind, 'square');
  assert.equal(entry.color, '#d92c2c');
  assert.equal(entry.lineWidth, 2);
  assert.equal(entry.src, 0);
  assert.deepEqual(entry.rect, [100, 600, 300, 700]);
  assert.equal(entry.quads.length, 1);
  assert.equal('paths' in entry, false);
  // 別のページには無い
  assert.equal(draft.draftFor(1), null);
  assert.equal(draft.cancel(), true);
  assert.equal(draft.isDrawing(), false);
  assert.equal(draft.cancel(), false);
});

test('Shift で正方形になり、finish は動いていれば entry を返す', () => {
  begin('circle');
  draft.update([400, 323.78], true);
  const entry = draft.finish([400, 323.78], true, 3);
  assert.equal(entry.kind, 'circle');
  assert.deepEqual(entry.rect, [100, 600, 200, 700]);
  assert.equal(draft.isDrawing(), false);
});

test('finish は slop 以内なら null で、下書きは消える', () => {
  begin('square');
  assert.equal(draft.finish([202, 285.78], false, 3), null);
  assert.equal(draft.isDrawing(), false);
  assert.equal(draft.finish([300, 300], false, 3), null);
});

test('直線は押した点から離した点へ向き、Shift で 45° に吸着する', () => {
  begin('line');
  let entry = draft.finish([600, 383.78], false, 3);
  assert.deepEqual(entry.paths, [[[100, 700], [300, 650]]]);
  assert.deepEqual(entry.rect, [99, 649, 301, 701]);
  begin('arrow');
  entry = draft.finish([600, 303.78], true, 3);
  assert.equal(entry.kind, 'arrow');
  near(entry.paths[0][1][1], 700 - 0);
  // 水平に吸着: 長さは hypot(400, 20) px = 200.5 pt
  near(entry.paths[0][1][0], 100 + Math.hypot(400, 20) / 2, 0.02);
  assert.ok(entry.rect[1] < 699);
});

test('ペンは MIN_STEP 未満の点を足さず、finish で Douglas–Peucker をかける', () => {
  begin('ink', [200, 400]);
  for (let x = 200.5; x <= 400; x += 0.5)
    draft.update([x, 400 + (x % 2 === 0 ? 0.4 : 0)]);
  const live = draft.draftFor(0);
  assert.ok(live.paths[0].length < 120, `描いている間の点 ${live.paths[0].length}`);
  const entry = draft.finish([400, 400], false, 3);
  assert.equal(entry.kind, 'ink');
  assert.equal(entry.paths.length, 1);
  assert.equal(entry.paths[0].length, 2);
  // 最後に残した点は (400, 400.4)。離した点は直前の点から MIN_STEP 未満なので足さない
  assert.deepEqual(entry.paths[0], [[100, 641.89], [200, 641.69]]);
  assert.deepEqual(entry.rect, [99, 640.69, 201, 642.89]);
});

test('ペンは途中の点が slop を超えていれば、押した点へ戻して離しても作る', () => {
  begin('ink', [200, 400]);
  draft.update([260, 400]);
  draft.update([200, 400]);
  const entry = draft.finish([200, 400], false, 3);
  assert.ok(entry !== null);
  assert.equal(entry.paths[0].length, 3);
});
