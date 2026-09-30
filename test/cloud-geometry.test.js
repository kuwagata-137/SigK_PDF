'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/cloud-geometry.js');
const worker = require('../worker/cloud-appearance.js');
const { num } = require('../worker/annotation-appearance.js');

// 雲形の幾何（spec-4b-1b 確定事項33。事前調査 H）。画面の点列（renderer/cloud-geometry.js）と保存の外観の path
// （worker/cloud-appearance.js）が同じ入力で同じになることも見る（矢じりと同じ扱い）。

const cloud = globalThis.SigK.cloudGeometry;

// ベジェの上の点（t = 0〜1 を 16 等分）。
function curvePoints(segments) {
  const points = [];
  let last = null;
  for (const { op, points: at } of segments) {
    if (op === 'M')
      last = at[0];
    if (op !== 'C')
      continue;
    for (let i = 0; i <= 16; i += 1) {
      const t = i / 16;
      const u = 1 - t;
      const x = u * u * u * last[0] + 3 * u * u * t * at[0][0] + 3 * u * t * t * at[1][0] + t * t * t * at[2][0];
      const y = u * u * u * last[1] + 3 * u * u * t * at[0][1] + 3 * u * t * t * at[1][1] + t * t * t * at[2][1];
      points.push([x, y]);
    }
    last = at[2];
  }
  return points;
}

function boundsOf(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// 弧の半径は 強さ × 4（丸は 4.75）＋ 描く線幅 / 2（他のツールと同じ慣習の値）。
test('弧の半径は強さと線の太さで決まり、丸は少し大きい', () => {
  assert.equal(cloud.radiusOf('square', 1, 2), 5);
  assert.equal(cloud.radiusOf('square', 2, 2), 9);
  assert.equal(cloud.radiusOf('circle', 1, 2), 5.75);
  assert.equal(cloud.radiusOf('circle', 2, 0), 9.5);
  assert.equal(Math.round((cloud.OVERLAP * 180) / Math.PI), 34);
  assert.equal(Math.round((cloud.TAIL * 180) / Math.PI), 22);
});

// 雲は箱の内側に収める（線の外側の縁まで入れて箱の中。確定事項33）。
test('雲は線の太さの半分まで入れて箱の内側に収まり、外側の縁は箱の辺に届く', () => {
  for (const [kind, box, intensity, lineWidth] of [
    ['square', [100, 100, 300, 200], 1, 2],
    ['square', [100, 100, 300, 200], 2, 8],
    ['circle', [50, 400, 250, 520], 1, 2],
    ['circle', [50, 400, 90, 440], 2, 1],
  ]) {
    const result = cloud.cloudOf({ kind, box, intensity, lineWidth });
    const [x1, y1, x2, y2] = boundsOf(curvePoints(result.segments));
    const half = result.drawWidth / 2;
    const slack = 0.02;
    assert.ok(x1 - half >= box[0] - slack && y1 - half >= box[1] - slack, `${kind} 左下 ${x1},${y1}`);
    assert.ok(x2 + half <= box[2] + slack && y2 + half <= box[3] + slack, `${kind} 右上 ${x2},${y2}`);
    if (kind === 'square') {
      assert.ok(Math.abs(x1 - half - box[0]) < 0.05 && Math.abs(y2 + half - box[3]) < 0.05, `${kind} 箱に届く`);
    }
    assert.equal(result.margin, result.radius + result.drawWidth / 2);
  }
});

test('path は M で始まり Z で閉じ、最後の弧の終わりは最初の点に戻る', () => {
  const { segments } = cloud.cloudOf({ kind: 'square', box: [0, 0, 100, 60], intensity: 1, lineWidth: 2 });
  assert.equal(segments[0].op, 'M');
  assert.equal(segments.at(-1).op, 'Z');
  const lastCurve = segments.at(-2);
  assert.equal(lastCurve.op, 'C');
  assert.ok(Math.hypot(lastCurve.points[2][0] - segments[0].points[0][0], lastCurve.points[2][1] - segments[0].points[0][1]) < 1e-9);
  assert.ok(segments.slice(1, -1).every((segment) => segment.op === 'C'));
});

// 各弧は、しっぽ（前の弧の内側へ 22°）で 1 本、外へふくらむ弧を 90° 以下に割って辺で 2 本・角で 3 本のベジェになる。
// 100×60 の箱・強さ 1・線 2pt: 余白 6 で中心の輪郭は 88×48、間隔は 2·5·cos34° 以下で横 11・縦 6、中心は 34 個（角 4）。
test('四角の中心は角に置き、辺を等しく割る（ベジェの数で見る）', () => {
  const { segments, radius, margin } = cloud.cloudOf({ kind: 'square', box: [0, 0, 100, 60], intensity: 1, lineWidth: 2 });
  assert.equal(radius, 5);
  assert.equal(margin, 6);
  const curves = segments.filter((segment) => segment.op === 'C').length;
  assert.equal(curves, 4 * (1 + 3) + 30 * (1 + 2));
});

// 小さな箱では弧を (短い辺 − 描く線幅) / 4 まで縮め、半径が 1pt を切るなら雲形をやめる（事前調査 H）。
test('小さな箱では弧を縮め、半径が 1pt を切るなら null', () => {
  const small = cloud.cloudOf({ kind: 'square', box: [0, 0, 20, 12], intensity: 1, lineWidth: 2 });
  assert.equal(small.radius, (12 - 2) / 4);
  assert.equal(cloud.cloudOf({ kind: 'square', box: [0, 0, 100, 5], intensity: 1, lineWidth: 2 }), null);
  assert.equal(cloud.cloudOf({ kind: 'circle', box: [0, 0, 4, 4], intensity: 2, lineWidth: 1 }), null);
  assert.equal(cloud.cloudOf({ kind: 'square', box: [0, 0, 0, 0], intensity: 1, lineWidth: 2 }), null);
});

// 描く線幅は短い辺の半分で頭打ち（四角・丸と同じ。確定事項30）。
test('描く線幅は短い辺の半分で頭打ちにする', () => {
  const thick = cloud.cloudOf({ kind: 'square', box: [0, 0, 200, 60], intensity: 1, lineWidth: 40 });
  assert.equal(thick.drawWidth, 30);
  assert.equal(thick.radius, Math.min(4 + 15, (60 - 30) / 4));
  assert.equal(cloud.cloudOf({ kind: 'square', box: [0, 0, 200, 100], intensity: 1, lineWidth: 12 }).drawWidth, 12);
});

// 画面の点列と保存の外観の path が同じ（数は外観と同じ小数 2 桁で文字にして比べる）。
test('画面の点列とワーカーの path は、同じ入力で同じになる', () => {
  const toOps = (segments) => segments.map(({ op, points }) => {
    if (op === 'M')
      return `${num(points[0][0])} ${num(points[0][1])} m`;
    if (op === 'C')
      return `${points.flat().map(num).join(' ')} c`;
    return 'h';
  }).join('\n');
  const inputs = [
    { kind: 'square', box: [60, 690, 250, 790], intensity: 1, lineWidth: 2 },
    { kind: 'square', box: [330, 400, 520, 500], intensity: 2, lineWidth: 8 },
    { kind: 'circle', box: [60, 400, 250, 500], intensity: 1, lineWidth: 2 },
    { kind: 'circle', box: [110.5, 110.25, 140.75, 150], intensity: 1.5, lineWidth: 1 },
    { kind: 'square', box: [0, 0, 20, 12], intensity: 1, lineWidth: 2 },
    { kind: 'square', box: [380, 150, 500, 300], intensity: 1, lineWidth: 40 },
  ];
  for (const input of inputs) {
    const screen = cloud.cloudOf(input);
    const saved = worker.cloudPathOf(input);
    assert.equal(saved.ops, toOps(screen.segments), JSON.stringify(input));
    assert.equal(saved.margin, screen.margin);
    assert.equal(saved.drawWidth, screen.drawWidth);
  }
  assert.equal(worker.cloudPathOf({ kind: 'square', box: [0, 0, 100, 5], intensity: 1, lineWidth: 2 }), null);
  assert.equal(worker.OVERLAP, cloud.OVERLAP);
  assert.equal(worker.TAIL, cloud.TAIL);
  assert.equal(worker.MIN_RADIUS, cloud.MIN_RADIUS);
});
