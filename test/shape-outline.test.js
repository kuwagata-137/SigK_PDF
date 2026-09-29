'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/shape-outline.js');

// 四角・丸・直線の輪郭の点列（spec-4b-1b 確定事項30・32・41）。保存の外観と同じ始点・同じ向きで返す。

const outline = globalThis.SigK.shapeOutline;

test('描く線幅は短い辺の半分で頭打ちにする', () => {
  assert.equal(outline.drawWidthOf([0, 0, 100, 50], 2), 2);
  assert.equal(outline.drawWidthOf([0, 0, 100, 50], 40), 25);
  assert.equal(outline.drawWidthOf([0, 0, 30, 30], 40), 15);
  assert.equal(outline.drawWidthOf([0, 0, 0, 30], 4), 0);
});

// 四角は re と同じく左下から反時計回り（下の辺を右へ → 右の辺を上へ → 上の辺を左へ → 閉じる）。線の中心は線幅の半分だけ内側。
test('四角の輪郭は左下から反時計回りで、線の中心は線幅の半分だけ内側', () => {
  assert.deepEqual(outline.rectOutline([100, 200, 300, 260], 4), [
    { op: 'M', points: [[102, 202]] },
    { op: 'L', points: [[298, 202]] },
    { op: 'L', points: [[298, 258]] },
    { op: 'L', points: [[102, 258]] },
    { op: 'Z', points: [] },
  ]);
  // 線なしの塗りは箱そのもの（線幅 0）。つぶれる箱は中心の線にする。
  assert.deepEqual(outline.rectOutline([0, 0, 10, 10], 0)[2].points[0], [10, 10]);
  assert.deepEqual(outline.rectOutline([0, 0, 10, 2], 4).map((segment) => segment.points[0]).slice(0, 4), [[2, 2], [8, 2], [8, 2], [2, 2]]);
});

// 丸は右端から反時計回りのベジェ 4 本（κ = 0.5523）。worker/shape-appearance.js の楕円と同じ。
test('丸の輪郭は右端から反時計回りのベジェ 4 本', () => {
  const segments = outline.ellipseOutline([0, 0, 104, 54], 4);
  assert.equal(outline.KAPPA, 0.5523);
  assert.deepEqual(segments[0], { op: 'M', points: [[102, 27]] });
  assert.deepEqual(segments.map((segment) => segment.op), ['M', 'C', 'C', 'C', 'C', 'Z']);
  assert.deepEqual(segments[1].points[2], [52, 52], '1 本目は上端へ（反時計回り）');
  assert.deepEqual(segments[1].points[0], [102, 27 + 25 * 0.5523]);
  assert.deepEqual(segments[4].points[2], [102, 27], '最後は右端へ戻る');
});

test('折れ線は始点から順に M・L', () => {
  assert.deepEqual(outline.polylineOutline([[1, 2], [3, 4], [5, 6]]), [
    { op: 'M', points: [[1, 2]] }, { op: 'L', points: [[3, 4]] }, { op: 'L', points: [[5, 6]] },
  ]);
});

// 紙の点を表示の px に直す（回転した紙でも同じ点になる）。数は小数 2 桁。
test('SVG の d は toView で表示の点に直して小数 2 桁で書く', () => {
  const toView = ([x, y]) => [x * 1.5, 1000 - y * 1.5];
  const d = outline.svgPathOf([
    { op: 'M', points: [[10, 20]] },
    { op: 'L', points: [[30.3333, 20]] },
    { op: 'C', points: [[1, 2], [3, 4], [5, 6]] },
    { op: 'Z', points: [] },
  ], toView);
  assert.equal(d, 'M15,970 L45.5,970 C1.5,997 4.5,994 7.5,991 Z');
});

test('canvas には beginPath から同じ path を引く', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  outline.tracePath(ctx, [
    { op: 'M', points: [[10, 20]] },
    { op: 'L', points: [[30, 20]] },
    { op: 'C', points: [[1, 2], [3, 4], [5, 6]] },
    { op: 'Z', points: [] },
  ], ([x, y]) => [x * 2, y * 2]);
  assert.deepEqual(calls, [
    ['beginPath'], ['moveTo', 20, 40], ['lineTo', 60, 40], ['bezierCurveTo', 2, 4, 6, 8, 10, 12], ['closePath'],
  ]);
});
