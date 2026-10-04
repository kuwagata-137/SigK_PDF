'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/callout-geometry.js');
const worker = require('../worker/callout-outline.js');

// 吹き出しの形の純粋層（spec-4b-4b 確定事項E・D3）。画面側（renderer/callout-geometry.js）とワーカー側（worker/callout-outline.js）の
// 式が同じであることもここで見張る。

const callout = globalThis.SigK.calloutGeometry;

test('出る辺は箱の中心から先への差を幅・高さで割って比べ、8 方向で上下左右に分かれる（CheckListMaker と同じ。確定事項E2）', () => {
  const cases = [
    [[50, -40], 'top'], [[50, 80], 'bottom'], [[-30, 20], 'left'], [[130, 20], 'right'],
    [[-30, -40], 'top'], [[130, 80], 'bottom'], [[-60, 0], 'left'], [[160, 40], 'right'],
  ];
  for (const [tip, edge] of cases)
    assert.equal(callout.edgeOf(100, 40, tip), edge, `${tip}`);
  // ちょうど対角（|dy|/h と |dx|/w が等しい）は上か下。
  assert.equal(callout.edgeOf(100, 40, [150, 60]), 'bottom');
});

test('輪郭は角の丸い箱としっぽを 1 本で描き、先を通り、根元は先に合わせて辺の上を滑る（確定事項E2〜E4）', () => {
  const { segments, edge, base } = callout.outlineOf({ width: 100, height: 40, tip: [30, 80], fontSize: 10 });
  assert.equal(edge, 'bottom');
  assert.equal(segments[0].op, 'M');
  assert.equal(segments.at(-1).op, 'Z');
  assert.equal(segments.filter((segment) => segment.op === 'C').length, 4, '角は 4 つのベジェ');
  assert.ok(segments.some((segment) => segment.op === 'L' && segment.points[0][0] === 30 && segment.points[0][1] === 80), '先を通る');
  assert.deepEqual(base, [30, 40]);
  // 先が箱の左端より外でも、根元は角の丸み＋半幅の内側で止まる（r = 6、半幅 = 6）。
  assert.deepEqual(callout.outlineOf({ width: 100, height: 40, tip: [-50, 100], fontSize: 10 }).base, [12, 40]);
  // 枠線の分だけ輪郭を内側へ入れる。先は動かさない。
  const inset = callout.outlineOf({ width: 100, height: 40, tip: [30, 80], fontSize: 10, inset: 1 });
  assert.deepEqual(inset.segments[0].points[0], [7, 1]);
  assert.deepEqual(inset.base, [30, 39]);
});

test('短い辺では根元の半幅を抑え、2pt を下回らない（確定事項E2）', () => {
  // 高さ 14 の箱の右から出す: 角の丸み 7（高さの半分）で辺に残りが無い → 半幅は下限 2。
  const { segments, edge } = callout.outlineOf({ width: 100, height: 14, tip: [150, 7], fontSize: 20 });
  assert.equal(edge, 'right');
  const tipAt = segments.findIndex((segment) => segment.op === 'L' && segment.points[0][0] === 150);
  assert.deepEqual([segments[tipAt - 1].points[0][1], segments[tipAt + 1].points[0][1]], [5, 9]);
});

test('外接は箱と先を含み、先は線の太さの半分だけ外へ出る。置いた直後の先は箱の下（確定事項D3・H2）', () => {
  assert.deepEqual(callout.boundsOf(100, 40, [30, 80], 2), [0, 0, 100, 81]);
  assert.deepEqual(callout.boundsOf(100, 40, [-20, -10]), [-20.5, -10.5, 100, 40]);
  assert.deepEqual(callout.defaultTipOf(100, 40, 10), [25, 56]);
  assert.deepEqual(callout.defaultTipOf(200, 40, 10), [30, 56], '右へは 30pt まで');
});

test('ローカルと紙の座標の行き来は、文字の向き 4 つで逆になる', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const origin = [100, 700];
    const paper = callout.paperOf(origin, rotation, [12, 34]);
    assert.deepEqual(callout.localOf(origin, rotation, paper), [12, 34]);
  }
  assert.deepEqual(callout.paperOf([100, 700], 0, [12, 34]), [112, 666]);
  assert.deepEqual(callout.paperOf([100, 700], 90, [12, 34]), [134, 712]);
});

test('画面側とワーカー側の輪郭・辺・外接・座標の行き来は同じ値を返す', () => {
  const inputs = [];
  for (const tip of [[30, 80], [-40, 10], [140, 20], [60, -50], [50, 20], [-80, -90]])
    for (const [width, height, fontSize, inset] of [[100, 40, 10, 0], [60, 120, 24, 1.5], [14, 14, 8, 0.5]])
      inputs.push({ width, height, tip, fontSize, inset });
  for (const input of inputs) {
    assert.deepEqual(worker.outlineOf(input), callout.outlineOf(input), JSON.stringify(input));
    assert.equal(worker.edgeOf(input.width, input.height, input.tip), callout.edgeOf(input.width, input.height, input.tip));
    assert.deepEqual(worker.boundsOf(input.width, input.height, input.tip, 3), callout.boundsOf(input.width, input.height, input.tip, 3));
  }
  for (const rotation of [0, 90, 180, 270]) {
    assert.deepEqual(worker.paperOf([10, 20], rotation, [3, 4]), callout.paperOf([10, 20], rotation, [3, 4]));
    assert.deepEqual(worker.localOf([10, 20], rotation, [13, 24]), callout.localOf([10, 20], rotation, [13, 24]));
  }
  for (const key of ['CORNER_RATIO', 'BASE_RATIO', 'BASE_MIN', 'KAPPA'])
    assert.equal(worker[key], callout[key]);
});

test('ワーカーの outlineOps は、ローカルの点を文字の向きの cm のあとの座標（左上が first、y は上向き）へ直して m・l・c・h にする', () => {
  const ops = worker.outlineOps([
    { op: 'M', points: [[1, 2]] }, { op: 'L', points: [[3, 4]] }, { op: 'C', points: [[1, 1], [2, 2], [3, 3]] }, { op: 'Z', points: [] },
  ], [100, 700]);
  assert.deepEqual(ops, ['101 698 m', '103 696 l', '101 699 102 698 103 697 c', 'h']);
});
