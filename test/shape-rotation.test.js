'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/shape-rotation.js');
const worker = require('../worker/shape-rotation.js');
const { transformPoint } = require('../worker/pdf-matrix.js');

// 四角・丸の回転の純粋層（spec-4b-2 確定事項1〜7・19・29・32）。画面側（renderer/shape-rotation.js）とワーカー側
// （worker/shape-rotation.js）の式が同じであることもここで見張る。

const rot = globalThis.SigK.shapeRotation;

function near(actual, expected, eps = 0.005) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} は ${expected} に近くない`);
}

function nearPoint(actual, expected, eps = 0.005) {
  near(actual[0], expected[0], eps);
  near(actual[1], expected[1], eps);
}

// A4 の紙（回転 0・倍率 1）の viewport。表示の y は下向き。
const viewport = {
  scale: 1,
  convertToViewportPoint: (x, y) => [x, 842 - y],
};

test('normalizeAngle は 360 の余りの小数 2 桁にし、整数に近ければ整数にする', () => {
  assert.equal(rot.normalizeAngle(30), 30);
  assert.equal(rot.normalizeAngle(-30), 330);
  assert.equal(rot.normalizeAngle(370), 10);
  assert.equal(rot.normalizeAngle(720), 0);
  assert.equal(rot.normalizeAngle(359.999), 0);
  assert.equal(rot.normalizeAngle(30.004), 30);
  assert.equal(rot.normalizeAngle(30.25), 30.25);
  assert.equal(rot.normalizeAngle(Number.NaN), 0);
  assert.equal(rot.normalizeAngle(undefined), 0);
});

test('snapAngle は刻みの角度そのものにそろえる（Shift で 15°）', () => {
  assert.equal(rot.snapAngle(37, 15), 30);
  assert.equal(rot.snapAngle(38, 15), 45);
  assert.equal(rot.snapAngle(-7, 15), 0);
  assert.equal(rot.snapAngle(353, 15), 0);
  assert.equal(rot.snapAngle(172, 15), 165);
});

test('angleOf・isRotated は無い角度と 0 を回していないとみなす', () => {
  assert.equal(rot.angleOf({}), 0);
  assert.equal(rot.isRotated({ angle: 0 }), false);
  assert.equal(rot.isRotated({}), false);
  assert.equal(rot.isRotated({ angle: 45 }), true);
});

test('rotatePoint は紙の座標で、画面の時計回りに回す（30° で右上の角が下がる）', () => {
  const center = [50, 25];
  const upperRight = rot.rotatePoint([100, 50], center, 30);
  nearPoint(upperRight, [105.80, 21.65], 0.01);
  assert.ok(upperRight[1] < 50, '右上の角は下がる');
  // 90°: 中心の右の点は真下へ（紙の y が減る）
  nearPoint(rot.rotatePoint([100, 25], center, 90), [50, -25]);
  nearPoint(rot.rotatePoint([100, 25], center, 180), [0, 25]);
  nearPoint(rot.rotatePoint([100, 25], center, 0), [100, 25]);
});

test('rotateViewPoint は表示の座標（y が下）で時計回りに回す', () => {
  nearPoint(rot.rotateViewPoint([110, 100], [100, 100], 90), [100, 110]);
  nearPoint(rot.rotateViewPoint([110, 100], [100, 100], 270), [100, 90]);
});

test('紙で回した点を表示へ直すと、表示で同じ角度だけ時計回りに回した点になる', () => {
  const box = [100, 600, 240, 680];
  const centerView = viewport.convertToViewportPoint(...rot.centerOf(box));
  for (const angle of [30, 45, 90, 200, 359]) {
    for (const corner of [[100, 600], [240, 680], [240, 600]]) {
      const viaPaper = viewport.convertToViewportPoint(...rot.rotatePoint(corner, rot.centerOf(box), angle));
      const viaView = rot.rotateViewPoint(viewport.convertToViewportPoint(...corner), centerView, angle);
      nearPoint(viaPaper, viaView);
    }
  }
});

test('cornersOf・quadOf は UL・UR・LL・LR の順で、0° なら quadOfRect と同じ', () => {
  const box = [10, 20, 110, 70];
  assert.deepEqual(rot.quadOf(box, 0), globalThis.SigK.freeTextGeometry.quadOfRect(box));
  const quad = rot.quadOf(box, 90);
  // 90°: 左上の角（10, 70）は右上へ回る
  nearPoint([quad[0], quad[1]], [85, 95]);
  assert.equal(quad.length, 8);
});

test('boundsOf は回した箱の外接で、90° は縦横が入れ替わる', () => {
  assert.deepEqual(rot.boundsOf([0, 0, 100, 50], 90), [25, -25, 75, 75]);
  assert.deepEqual(rot.boundsOf([0, 0, 100, 50], 0), [0, 0, 100, 50]);
  const [x1, y1, x2, y2] = rot.boundsOf([0, 0, 100, 50], 45);
  near(x2 - x1, 106.07, 0.01);
  near(y2 - y1, 106.07, 0.01);
});

test('toLocal は回した点を回す前の座標へ戻す', () => {
  const box = [10, 20, 110, 70];
  for (const angle of [15, 90, 271]) {
    const point = [83, 41];
    const moved = rot.rotatePoint(point, rot.centerOf(box), angle);
    nearPoint(rot.toLocal(moved, box, angle), point);
  }
});

test('matrixOf は画面とワーカーで同じ値になり、/BBox の隅を回した隅へ写す', () => {
  const boxes = [[0, 0, 100, 50], [72.5, 600.25, 212.5, 680], [10, 10, 11, 11]];
  for (const box of boxes) {
    for (const angle of [1, 15, 30, 45, 90, 135, 180, 270, 300, 359, 30.5]) {
      const m = rot.matrixOf(box, angle);
      assert.deepEqual(m, worker.matrixOf(box, angle), `箱 ${box}・${angle}°`);
      const corners = rot.cornersOf(box, angle);
      const mapped = [[box[0], box[3]], [box[2], box[3]], [box[0], box[1]], [box[2], box[1]]].map((point) => transformPoint(point, m));
      mapped.forEach((point, index) => nearPoint(point, corners[index], 0.05));
    }
  }
});

test('matrixOf は 90° の倍数で 0 と ±1 だけになり、-0 を書かない', () => {
  const m = rot.matrixOf([0, 0, 100, 50], 90);
  assert.deepEqual(m.slice(0, 4), [0, -1, 1, 0]);
  assert.ok(m.every((value) => !Object.is(value, -0)));
  assert.deepEqual(rot.matrixOf([0, 0, 100, 50], 180).slice(0, 4), [-1, 0, 0, -1]);
});

test('svgTransformOf・viewRotationOf は表示の座標で箱の中心まわり。回していなければ null', () => {
  const entry = { kind: 'square', rect: [100, 600, 240, 680] };
  assert.equal(rot.svgTransformOf(entry, viewport), null);
  assert.equal(rot.viewRotationOf(entry, viewport), null);
  assert.equal(rot.svgTransformOf({ ...entry, angle: 30 }, viewport), 'rotate(30 170 202)');
  assert.deepEqual(rot.viewRotationOf({ ...entry, angle: 30 }, viewport), { angle: 30, center: [170, 202] });
});

// ---- ワーカー: 保存の /Rect と、外観からの読み戻し（確定事項29・34） ----

test('rectOf は /BBox を /Matrix で写した外接（小数 2 桁）で、0° は箱そのもの', () => {
  assert.deepEqual(worker.rectOf([0, 0, 100, 50], 0), [0, 0, 100, 50]);
  assert.deepEqual(worker.rectOf([0, 0, 100, 50], 90), [25, -25, 75, 75]);
  assert.deepEqual(worker.rectOf([100, 600, 240, 680], 30), rot.boundsOf([100, 600, 240, 680], 30).map((value) => Math.round(value * 100) / 100));
});

test('rotationOf は SigK PDF の書き方から角度と回す前の箱を戻す', () => {
  for (const box of [[100, 600, 240, 680], [72.5, 600.25, 212.5, 680], [10, 10, 12, 40]]) {
    for (const angle of [1, 15, 30, 45, 89, 90, 135, 180, 270, 300, 359]) {
      const answer = worker.rotationOf({ rect: worker.rectOf(box, angle), bbox: box, matrix: worker.matrixOf(box, angle) });
      assert.equal(answer.angle, angle, `箱 ${box}・${angle}°`);
      answer.box.forEach((value, index) => near(value, box[index], 0.011));
    }
  }
});

test('rotationOf は回っていない外観（/Matrix が無い・拡大と移動だけ）を null にする', () => {
  assert.equal(worker.rotationOf({ rect: [0, 0, 100, 50], bbox: [0, 0, 100, 50] }), null);
  // 横に 1.5 倍（事前調査 B の P5）
  assert.equal(worker.rotationOf({ rect: [-25, 0, 125, 50], bbox: [0, 0, 100, 50], matrix: [1.5, 0, 0, 1, -25, 0] }), null);
  // /BBox の原点がずれていて /Rect に合わせて縮める
  assert.equal(worker.rotationOf({ rect: [200, 450, 260, 510], bbox: [100, 100, 220, 220] }), null);
});

test('rotationOf は /Rect だけをずらしたものを、ずらした箱として読む（事前調査 B の P10）', () => {
  const box = [230, 350, 380, 440];
  const rect = worker.rectOf(box, 30).map((value) => value + 40);
  const answer = worker.rotationOf({ rect, bbox: box, matrix: worker.matrixOf(box, 30) });
  assert.equal(answer.angle, 30);
  answer.box.forEach((value, index) => near(value, box[index] + 40, 0.011));
});

test('rotationOf は /Rect の縦横の比を変えたもの・裏返しを skewed にする（事前調査 B の P11）', () => {
  const box = [230, 350, 380, 440];
  const [x1, y1, x2, y2] = worker.rectOf(box, 30);
  assert.equal(worker.rotationOf({ rect: [x1, y1, x1 + (x2 - x1) * 1.3, y2], bbox: box, matrix: worker.matrixOf(box, 30) }), 'skewed');
  assert.equal(worker.rotationOf({ rect: [0, 0, 100, 50], bbox: [0, 0, 100, 50], matrix: [-1, 0, 0, 1, 100, 0] }), 'skewed');
});

test('rotationOf はほかの書き方の回転（原点の /BBox・拡大付き・小数の角度・180°）も読む', () => {
  // /BBox [0 0 140 80] を中心まわりに回してから (300, 400) へずらした外観（あるライブラリの書き方）
  const local = [0, 0, 140, 80];
  const turn = worker.matrixOf(local, 30);
  const matrix = [turn[0], turn[1], turn[2], turn[3], turn[4] + 300, turn[5] + 400];
  const corners = [[0, 0], [140, 0], [0, 80], [140, 80]].map((point) => transformPoint(point, matrix));
  const rect = [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))];
  const answer = worker.rotationOf({ rect, bbox: local, matrix });
  assert.equal(answer.angle, 30);
  answer.box.forEach((value, index) => near(value, [300, 400, 440, 480][index], 0.011));
  // 拡大 2 倍と回転（/BBox は半分の大きさ）
  const scaled = worker.rotationOf({ rect: worker.rectOf([0, 0, 200, 100], 45), bbox: [0, 0, 100, 50], matrix: worker.matrixOf([0, 0, 100, 50], 45) });
  assert.equal(scaled.angle, 45);
  near(scaled.box[2] - scaled.box[0], 200, 0.02);
  near(scaled.box[3] - scaled.box[1], 100, 0.02);
  // 小数の角度は丸めない
  const half = worker.rotationOf({ rect: worker.rectOf(local, 30.5), bbox: local, matrix: worker.matrixOf(local, 30.5) });
  assert.equal(half.angle, 30.5);
  // 180°（a = d = −1）
  assert.equal(worker.rotationOf({ rect: [0, 0, 100, 50], bbox: [0, 0, 100, 50], matrix: [-1, 0, 0, -1, 100, 50] }).angle, 180);
});

test('rotationOf は形の崩れた入力を null にする', () => {
  assert.equal(worker.rotationOf({ rect: [0, 0, 1], bbox: [0, 0, 1, 1] }), null);
  assert.equal(worker.rotationOf({ rect: [0, 0, 1, 1], bbox: [0, 0, 0, 1] }), null);
  assert.equal(worker.rotationOf({ rect: [0, 0, 1, 1], bbox: [0, 0, 1, 1], matrix: [1, 0, 0] }), null);
  assert.equal(worker.rotationOf({ rect: [0, 0, 1, 1], bbox: [0, 0, 1, 1], matrix: [0, 0, 0, 0, 0, 0] }), null);
});

test('recentered は組み直した箱の中心を元の箱の中心まわりに回し、回す前に動かさなかった点を紙の上でも動かさない（spec-4b-4b 確定事項B1）', () => {
  const box = [100, 600, 200, 650];
  // 回す前の左上 (100, 650) を据え置いて、右へ 60・下へ 20 伸ばした箱。
  const grown = [100, 580, 260, 650];
  for (const angle of [0, 30, 90, 137, 300]) {
    const next = rot.recentered(box, grown, angle);
    assert.equal(next[2] - next[0], 160);
    assert.equal(next[3] - next[1], 70);
    const before = rot.rotatePoint([100, 650], rot.centerOf(box), angle);
    const after = rot.rotatePoint([next[0], next[3]], rot.centerOf(next), angle);
    nearPoint(after, before, 1e-9);
  }
  assert.deepEqual(rot.recentered(box, grown, 0), grown);
  assert.notEqual(rot.recentered(box, grown, 0), grown, '回していなくても写しを返す');
});

test('ワーカーの turnOf は箱の中心まわりの /Matrix と、/BBox を写した外接の /Rect を返し、回していなければ空（spec-4b-4b 確定事項H1）', () => {
  assert.deepEqual(worker.turnOf([100, 600, 200, 650], 0), {});
  assert.deepEqual(worker.turnOf([100, 600, 200, 650], undefined), {});
  const square = worker.turnOf([100, 600, 200, 650], 30);
  assert.deepEqual(square, { matrix: worker.matrixOf([100, 600, 200, 650], 30), rect: worker.rectOf([100, 600, 200, 650], 30) });
  // /BBox が箱より広い（吹き出しのしっぽ）ときも、回転の中心は箱の中心のまま、/Rect は /BBox の外接。
  const wide = worker.turnOf([100, 600, 200, 650], 90, [90, 560, 210, 660]);
  assert.deepEqual(wide.matrix, worker.matrixOf([100, 600, 200, 650], 90));
  assert.deepEqual(wide.rect, [85, 565, 185, 685]);
});
