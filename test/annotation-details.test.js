'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/imported-values.js');
require('../renderer/shape-rotation.js');
require('../renderer/annotation-box-details.js');
require('../renderer/annotation-details.js');

// 注釈の辞書の読み戻しを当てる層（spec-4b-1a 確定事項25〜27、spec-4b-1b 確定事項36〜39）。純関数と、口を 1 本ずつ呼ぶ順番待ちを見る。
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

// 塗りは灰・CMYK を RGB に直して当てる（確定事項36・39）。直線・矢印の /IC は開いた矢じりに効かないので当てない。
test('applyDetails は四角・丸の塗りを当て、灰と CMYK は RGB に直す', () => {
  const apply = (kind, detail, extra) => details.applyDetails(entry(kind, extra), detail);
  assert.equal(apply('square', { interior: [1, 1, 0] }).fill, '#ffff00');
  assert.equal(apply('circle', { interior: [0.8] }).fill, '#cccccc');
  assert.equal(apply('square', { interior: [0, 0, 1, 0] }).fill, '#ffff00');
  assert.equal(apply('square', { interior: [0, 0, 0, 0.25] }).fill, '#bfbfbf');
  assert.equal(apply('square', { interior: [] }).fill, undefined, '空の /IC は塗りなし');
  assert.equal(apply('square', { interior: [1, 0] }).fill, undefined, '成分の数が合わなければ塗りなし');
  assert.equal(apply('line', { interior: [1, 0, 0] }).fill, undefined);
  assert.equal(apply('square', { interior: [1, 1, 0] }).readonly, undefined);
});

// 雲形は強さ（2 まで）を当て、箱は /Rect のまま（確定事項38。決定47 ⑯）。強さ 0 か無いものは雲形でない。
test('applyDetails は雲形の強さを当て、雲形の破線は表示のみにする', () => {
  const apply = (kind, detail, extra) => details.applyDetails(entry(kind, extra), detail);
  const cloudy = apply('circle', { cloudy: true, cloudIntensity: 1, rectDifference: [10, 10, 10, 10] });
  assert.equal(cloudy.lineStyle, 'cloudy');
  assert.equal(cloudy.cloudIntensity, 1);
  assert.deepEqual(cloudy.rect, [10, 10, 60, 40], '雲形の箱は /Rect のまま');
  assert.equal(apply('square', { cloudy: true, cloudIntensity: 3 }).cloudIntensity, 2);
  assert.equal(apply('square', { cloudy: true, cloudIntensity: 0 }).lineStyle, undefined);
  assert.equal(apply('square', { cloudy: true, cloudIntensity: null }).lineStyle, undefined);
  assert.equal(apply('square', { cloudy: true, cloudIntensity: 1 }, { lineStyle: 'dashed' }).readonly, true);
  assert.equal(apply('square', { cloudy: true, cloudIntensity: 1, rectDifference: [40, 0, 40, 0] }).readonly, true, '雲形でも崩れた /RD は表示のみ');
});

// 雲形でない四角・丸の /RD（規格の順で 左・上・右・下）は、/Rect から引いた箱を使う（確定事項38）。
test('applyDetails は /RD を引いた箱を当て、崩れた /RD は表示のみにする', () => {
  const apply = (kind, detail) => details.applyDetails(entry(kind), detail);
  const inset = apply('square', { rectDifference: [1, 2, 3, 4] });
  assert.deepEqual(inset.rect, [11, 14, 57, 38]);
  assert.deepEqual(inset.quads, [[11, 38, 57, 38, 11, 14, 57, 14]]);
  assert.deepEqual(apply('square', { rectDifference: [0, 0, 0, 0] }).rect, [10, 10, 60, 40]);
  assert.deepEqual(apply('square', { rectDifference: [30, 0, 30, 0] }), details.readonlyOf(entry('square')), '左右の和が幅以上');
  assert.equal(apply('circle', { rectDifference: [0, 15, 0, 15] }).readonly, true, '上下の和が高さ以上');
  assert.equal(apply('square', { rectDifference: [-1, 0, 0, 0] }).readonly, true);
  assert.equal(apply('square', { rectDifference: [1, 2, 3] }).readonly, true);
});

// 線なし（/C が無いか線幅 0 の四角・丸）は塗りがあれば直せ、無ければ答えが無くても表示のみ（確定事項36）。
test('applyDetails は線も塗りも無いものと、不透明度 0 を表示のみにする', () => {
  assert.equal(details.applyDetails(entry('square', { color: null }), { interior: [1, 1, 0] }).color, null);
  assert.equal(details.applyDetails(entry('square', { color: null }), { interior: null }).readonly, true);
  assert.equal(details.applyDetails(entry('circle', { color: null }), undefined).readonly, true);
  assert.deepEqual(details.applyDetails(entry('square', { color: null }), {}), {
    ref: '30R', src: 0, kind: 'other', subtype: 'Square', color: null, opacity: 1,
    quads: [[10, 40, 60, 40, 10, 10, 60, 10]], rect: [10, 10, 60, 40], text: '', author: '', readonly: true,
  });
  assert.equal(details.applyDetails(entry('note'), { ca: 0 }).subtype, 'Text');
  assert.equal(details.readonlyOf(entry('arrow', { text: undefined })).subtype, 'PolyLine');
  const readonly = details.readonlyOf(entry('square'));
  assert.equal(details.applyDetails(readonly, { interior: [1, 0, 0] }), readonly, '表示のみのものは変えない');
});

test('applyDetails は回した四角・丸に回す前の箱と角度を当て、四角を回した 4 隅にする（spec-4b-2 確定事項35）', () => {
  const rotation = { box: [20, 20, 70, 50], angle: 30 };
  const turned = details.applyDetails(entry('square', { rect: [5, 3, 85, 67] }), { rotation, rectDifference: [2, 2, 2, 2] });
  assert.deepEqual(turned.rect, [20, 20, 70, 50]);
  assert.equal(turned.angle, 30);
  assert.deepEqual(turned.quads, [globalThis.SigK.shapeRotation.quadOf([20, 20, 70, 50], 30)]);
  // 回した雲形も雲形のまま、回した箱で描く（/RD は使わない）
  const cloudy = details.applyDetails(entry('circle'), { rotation, cloudy: true, cloudIntensity: 1, rectDifference: [9, 9, 9, 9] });
  assert.equal(cloudy.lineStyle, 'cloudy');
  assert.deepEqual(cloudy.rect, [20, 20, 70, 50]);
  // 回っていなければ今までどおり
  assert.equal(details.applyDetails(entry('square'), { rotation: null }).angle, undefined);
});

test('applyDetails は回転を読めない外観（skewed）の四角・丸を表示のみにする', () => {
  const answer = details.applyDetails(entry('square'), { rotation: 'skewed', interior: [1, 1, 0] });
  assert.equal(answer.readonly, true);
  assert.equal(answer.kind, 'other');
  assert.equal(answer.subtype, 'Square');
});

test('applyDetails は口がまるごと答えなかったときの四角・丸を表示のみにし、ほかの種類はそのまま（spec-4b-2 確定事項36）', () => {
  assert.equal(details.applyDetails(entry('square'), undefined, { answered: false }).readonly, true);
  assert.equal(details.applyDetails(entry('circle'), undefined, { answered: false }).subtype, 'Circle');
  const line = entry('line', { paths: [[[10, 10], [60, 40]]] });
  assert.equal(details.applyDetails(line, undefined, { answered: false }), line);
  // 口は答えたがその注釈の欄が無いときは、今までどおり pdf.js の値のまま
  const same = entry('square');
  assert.equal(details.applyDetails(same, undefined), same);
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
