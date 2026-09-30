'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-details.js');

// 注釈の辞書の読み戻しを当てる層（spec-4b-1a 確定事項25〜27）。純関数と、口を 1 本ずつ呼ぶ順番待ちを見る。
// 読み込みの流れの中での使われ方は annotation-import.test.js が見る。

const details = globalThis.SigK.annotationDetails;
const FILE = { path: 'a.pdf', size: 2048, mtimeMs: 1 };

const entry = (kind, extra = {}) => ({ ref: '30R', src: 0, kind, color: '#ff0000', opacity: 1, lineWidth: 2, rect: [10, 10, 60, 40], quads: [[10, 40, 60, 40, 10, 10, 60, 10]], ...extra });

function withApi(t, readDetails, available = true) {
  globalThis.annotationAPI = { available, readDetails };
  t.after(() => { delete globalThis.annotationAPI; });
}

test('口が要るのは表示のみでない四角・丸・直線・矢印・テキスト・ノートで、refsOf はその参照を並べる', () => {
  for (const kind of ['square', 'circle', 'line', 'arrow', 'text', 'note'])
    assert.equal(details.needsDetails(entry(kind)), true, kind);
  for (const kind of ['highlight', 'underline', 'strikeout', 'ink'])
    assert.equal(details.needsDetails(entry(kind)), false, kind);
  assert.equal(details.needsDetails(entry('square', { readonly: true })), false);
  assert.equal(details.needsDetails(entry('square', { ref: undefined })), false, '自分で足したもの（ref が無い）は頼まない');
  assert.deepEqual(details.refsOf({ 0: [entry('square', { ref: '1R' }), entry('ink', { ref: '2R' })], 3: [entry('note', { ref: '9R1' })] }), ['1R', '9R1']);
  assert.deepEqual(details.refsOf(undefined), []);
});

test('applyDetails は不透明度を当て、答えが無ければそのまま', () => {
  assert.equal(details.applyDetails(entry('square'), { ca: 0.35 }).opacity, 0.35);
  assert.equal(details.applyDetails(entry('text'), { ca: 1.5 }).opacity, 1, '1 を超えれば 1');
  assert.equal(details.applyDetails(entry('note'), { ca: null }).opacity, 1, '/CA が無ければそのまま');
  const same = entry('circle');
  assert.equal(details.applyDetails(same, undefined), same);
  // 直線・矢印の /IC は開いた矢じりの見た目に効かないので、表示のみにしない。
  assert.equal(details.applyDetails(entry('line'), { ca: 0.5, interior: [1, 0, 0] }).readonly, undefined);
});

test('applyDetails は四角・丸の塗り・雲形・0 でない /RD と、不透明度 0 を表示のみにする', () => {
  const readonly = (kind, detail) => details.applyDetails(entry(kind), detail);
  assert.deepEqual(readonly('square', { interior: [1, 1, 0] }), {
    ref: '30R', src: 0, kind: 'other', subtype: 'Square', color: '#ff0000', opacity: 1,
    quads: [[10, 40, 60, 40, 10, 10, 60, 10]], rect: [10, 10, 60, 40], text: '', author: '', readonly: true,
  });
  assert.equal(readonly('circle', { cloudy: true }).subtype, 'Circle');
  assert.equal(readonly('square', { rectDifference: [0, 5, 0, 0] }).readonly, true);
  assert.equal(readonly('square', { rectDifference: [0, 0, 0, 0] }).readonly, undefined, '/RD が 0 なら直せる');
  assert.equal(readonly('square', { interior: [] }).readonly, undefined, '空の /IC は塗りなし');
  assert.equal(readonly('note', { ca: 0 }).subtype, 'Text');
  assert.equal(details.readonlyOf(entry('arrow', { text: undefined })).subtype, 'PolyLine');
});

test('requestDetails は口を呼べないとき呼ばずに理由を返す', async (t) => {
  const calls = [];
  withApi(t, async (spec) => { calls.push(spec); return { ok: true, details: {} }; });
  assert.deepEqual(await details.requestDetails(FILE, []), { ok: false, reason: 'none', called: false });
  assert.deepEqual(await details.requestDetails({ path: 'a.pdf', size: 2048, mtimeMs: null }, ['1R']), { ok: false, reason: 'no-file', called: false });
  assert.deepEqual(await details.requestDetails({ ...FILE, size: details.SIZE_MAX + 1 }, ['1R']), { ok: false, reason: 'too-large', called: false });
  assert.deepEqual(await details.requestDetails(FILE, Array.from({ length: details.REFS_MAX + 1 }, (_, index) => `${index + 1}R`)), { ok: false, reason: 'too-many', called: false });
  globalThis.annotationAPI.available = false;
  assert.deepEqual(await details.requestDetails(FILE, ['1R']), { ok: false, reason: 'unavailable', called: false });
  assert.equal(calls.length, 0);
  assert.deepEqual(details.lastRequest(), { called: false, refs: 1, answered: 0, ms: 0, reason: 'unavailable' });
});

test('requestDetails は 1 本ずつ順番に呼び、答えを揃える', async (t) => {
  const order = [];
  const releases = [];
  withApi(t, (spec) => {
    order.push(`start ${spec.refs[0]}`);
    return new Promise((resolve) => releases.push(() => { order.push(`end ${spec.refs[0]}`); resolve({ ok: true, details: { [spec.refs[0]]: { ca: 0.5 } } }); }));
  });
  const first = details.requestDetails(FILE, ['1R']);
  const second = details.requestDetails(FILE, ['2R']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start 1R'], '2 本目は 1 本目が終わるまで呼ばない');
  releases[0]();
  assert.deepEqual(await first, { ok: true, details: { '1R': { ca: 0.5 } }, called: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start 1R', 'end 1R', 'start 2R']);
  releases[1]();
  assert.equal((await second).ok, true);
  assert.deepEqual(globalThis.structuredClone({ ...details.lastRequest(), ms: 0 }), { called: true, refs: 1, answered: 1, ms: 0, reason: null });
});

test('requestDetails は断られた答えと、口が投げたときを reason に揃え、次の呼び出しを止めない', async (t) => {
  const answers = [{ ok: false, reason: 'timeout' }, new Error('IPC が切れた'), { ok: true, details: {} }];
  withApi(t, async () => {
    const next = answers.shift();
    if (next instanceof Error)
      throw next;
    return next;
  });
  assert.deepEqual(await details.requestDetails(FILE, ['1R']), { ok: false, reason: 'timeout', called: true });
  assert.deepEqual(await details.requestDetails(FILE, ['1R']), { ok: false, reason: 'unreadable', called: true });
  assert.deepEqual(await details.requestDetails(FILE, ['1R']), { ok: true, details: {}, called: true });
});
