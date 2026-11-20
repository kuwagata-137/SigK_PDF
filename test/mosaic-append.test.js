'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-crop.js');
require('../renderer/page-plan.js');
require('../renderer/page-mosaic.js');
require('../renderer/mosaic-paint.js');
require('../renderer/mosaic-region.js');
require('../renderer/mosaic-append.js');
const { create } = globalThis.SigK.mosaicAppend;

// 追加した範囲だけを塗る処理の順番と確認（決定99 ①。mosaic-append.js）。持ち主（ページの表示域・サムネイル）の代わりに偽物を使う。
// 偽物の paint は、試験が終わらせるまで待つ（owner.waiting）。

const item = (x) => ({ box: [x, x, x + 10, x + 10], block: 8 });
const entryWith = (...items) => (items.length === 0 ? { src: 0, rotate: 0 } : { src: 0, rotate: 0, mosaic: items });
const [P0, P1, P2] = [entryWith(), entryWith(item(10)), entryWith(item(10), item(40))];

// 偽の持ち主。絵は 1 ページ分（picture）。今の並びの要素は plan、倍率変更などで増える番号は token。log は呼ばれた順番。
function fakeOwner({ paintable = true } = {}) {
  const canvas = { getContext: () => (paintable ? { getImageData() {} } : {}) };
  const owner = {
    picture: { canvas, viewport: {}, page: {}, plan: P0 },
    plan: P1,
    token: 0,
    log: [],
    waiting: [],
    drawn: () => owner.picture,
    current: () => owner.plan,
    watch: (index, drawn) => {
      const token = owner.token;
      return () => token === owner.token && owner.picture?.canvas === drawn.canvas;
    },
    paint: (index, drawn, mosaic, alive) => new Promise((resolve, reject) => {
      owner.log.push(`paint ${mosaic.length}`);
      owner.waiting.push({ resolve, reject, alive });
    }),
    finish: (index, plan) => {
      owner.log.push(`finish ${plan.mosaic.length}`);
      owner.picture = { ...owner.picture, plan };
    },
    redraw: () => owner.log.push('redraw'),
    report: (error) => owner.log.push(`report ${error.message}`),
  };
  return owner;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('append は、モザイクが末尾に 1 つ増えただけで、描き終えた絵の並びが変更前の並びのときだけ予約する', () => {
  assert.equal(create(fakeOwner()).append(0, P0, P1), true);
  // 減った（取り消し・［このページのモザイクを削除］）・2 つ増えた・描き終えた絵が無い・絵の並びが違う・塗れない（jsdom）。
  assert.equal(create(fakeOwner()).append(0, P1, P0), false);
  assert.equal(create(fakeOwner()).append(0, P0, P2), false);
  const none = fakeOwner();
  none.picture = null;
  assert.equal(create(none).append(0, P0, P1), false);
  assert.equal(create(fakeOwner()).append(0, P1, P2), false);
  assert.equal(create(fakeOwner({ paintable: false })).append(0, P0, P1), false);
});

test('続けて配置した時は、前の塗りが終わってから次の塗りを始め、塗った時の並びの要素を順に記録する', async () => {
  const owner = fakeOwner();
  const appender = create(owner);
  assert.equal(appender.append(0, P0, P1), true);
  owner.plan = P2;
  // 前の塗りが終わっていないので、絵の並び（P0）が変更前の並び（P1）と違っても予約する（塗る前に確かめる）。
  assert.equal(appender.append(0, P1, P2), true);
  await tick();
  assert.deepEqual(owner.log, ['paint 1']);
  assert.equal(appender.pending(0), true);
  owner.waiting.shift().resolve(true);
  await tick();
  assert.deepEqual(owner.log, ['paint 1', 'finish 1', 'paint 2']);
  owner.waiting.shift().resolve(true);
  await tick();
  assert.deepEqual(owner.log, ['paint 1', 'finish 1', 'paint 2', 'finish 2']);
  assert.equal(owner.picture.plan, P2);
  assert.equal(appender.pending(0), false);
});

test('塗っている途中で倍率変更・取り消しなどが入ったら、書き込みも記録もせず、描き直しも呼ばない', async () => {
  for (const written of [false, true]) {
    const owner = fakeOwner();
    create(owner).append(0, P0, P1);
    await tick();
    // 倍率を変えて、枠の絵を手放したことにする。
    owner.token += 1;
    owner.picture = null;
    const { resolve, alive } = owner.waiting.shift();
    assert.equal(alive(), false);
    resolve(written);
    await tick();
    assert.deepEqual(owner.log, ['paint 1'], `paint が ${written} を返した時`);
  }
});

test('塗れなかった時・失敗した時は、今までどおり描き直す（取り消された描画は失敗として記録しない）', async () => {
  const failed = fakeOwner();
  create(failed).append(0, P0, P1);
  await tick();
  failed.waiting.shift().resolve(false);
  await tick();
  assert.deepEqual(failed.log, ['paint 1', 'redraw']);

  const broken = fakeOwner();
  create(broken).append(0, P0, P1);
  await tick();
  broken.waiting.shift().reject(new Error('描けない'));
  await tick();
  assert.deepEqual(broken.log, ['paint 1', 'report 描けない', 'redraw']);

  const canceled = fakeOwner();
  create(canceled).append(0, P0, P1);
  await tick();
  canceled.token += 1;
  canceled.waiting.shift().reject(new Error('RenderingCancelledException'));
  await tick();
  assert.deepEqual(canceled.log, ['paint 1']);
});

test('塗る前に、絵が無い・絵の並びが変更前の並びでなければ描き直す（今の並びの絵なら何もしない）', async () => {
  // 前の塗りが書き込めなかった（P0 の絵のまま）ので、次の塗り（P1 → P2）の前に描き直す。
  const stale = fakeOwner();
  const appender = create(stale);
  appender.append(0, P0, P1);
  stale.plan = P2;
  appender.append(0, P1, P2);
  await tick();
  stale.waiting.shift().resolve(false);
  await tick();
  assert.deepEqual(stale.log, ['paint 1', 'redraw', 'redraw']);

  // 前の塗りの間に、今の並び（P2）で描き直した絵になっていれば、何もしない。
  const fresh = fakeOwner();
  const next = create(fresh);
  next.append(0, P0, P1);
  fresh.plan = P2;
  next.append(0, P1, P2);
  await tick();
  fresh.picture = { ...fresh.picture, canvas: { getContext: () => ({ getImageData() {} }) }, plan: P2 };
  fresh.waiting.shift().resolve(false);
  await tick();
  assert.deepEqual(fresh.log, ['paint 1']);

  // 描き直しの途中（描き終えた絵が無い）なら、描き直して今の並びにそろえる。
  const drawing = fakeOwner();
  const third = create(drawing);
  third.append(0, P0, P1);
  drawing.plan = P2;
  third.append(0, P1, P2);
  await tick();
  drawing.picture = null;
  drawing.waiting.shift().resolve(false);
  await tick();
  assert.deepEqual(drawing.log, ['paint 1', 'redraw']);
});
