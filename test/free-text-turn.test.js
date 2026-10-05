'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/free-text-turn.js');

// 回したテキストの箱の純粋層（spec-4b-4b 確定事項B・D1）。

const { SigK } = globalThis;
const turn = SigK.freeTextTurn;
const geometry = SigK.freeTextGeometry;
const rotation = SigK.shapeRotation;

const near = (a, b, tolerance = 0.006) => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);

// 回す前の座標の点 point が、entry の回し方で紙の上のどこに来るか。
function onPaper(entry, point) {
  return rotation.rotatePoint(point, rotation.centerOf(entry.rect), entry.angle ?? 0);
}

const BASE = { kind: 'text', rect: [100, 600, 220, 640], rotation: 0, angle: 30 };

test('turned は回していなければ frame をそのまま返す', () => {
  const frame = { rect: [100, 590, 240, 640], quads: [geometry.quadOfRect([100, 590, 240, 640])] };
  assert.equal(turn.turned({ ...BASE, angle: undefined }, frame), frame);
});

test('turned は回す前の座標で同じ点を保って組んだ箱を、その点が紙の上で動かないようにずらす', () => {
  for (const angle of [30, 90, 200, 359]) {
    for (const rotationOf of [0, 90, 180, 270]) {
      const entry = { ...BASE, rotation: rotationOf, angle };
      const anchor = geometry.frameOrigin(entry.rect, rotationOf);
      // 左上を保って右と下へ広げた箱（回す前の座標）。
      const size = geometry.frameSize(entry.rect, rotationOf);
      const grown = geometry.rectFromOrigin(anchor, { width: size.width + 37, height: size.height + 19 }, rotationOf);
      const frame = turn.turned(entry, { rect: grown, quads: [geometry.quadOfRect(grown)] });
      const shift = [frame.rect[0] - grown[0], frame.rect[1] - grown[1]];
      const anchorAfter = [anchor[0] + shift[0], anchor[1] + shift[1]];
      assert.ok(near(onPaper({ rect: frame.rect, angle }, anchorAfter), onPaper(entry, anchor)), `${angle}° 置いた向き ${rotationOf}`);
      // 大きさは変えない。四角は回した 4 隅。
      assert.ok(near([frame.rect[2] - frame.rect[0], frame.rect[3] - frame.rect[1]], [grown[2] - grown[0], grown[3] - grown[1]], 0.011));
      assert.deepEqual(frame.quads, [rotation.quadOf(frame.rect, angle)]);
    }
  }
});

test('turned は反対の辺を保った箱（左の幅のつまみ）でも、その辺の点を動かさない', () => {
  const entry = { ...BASE, angle: 45 };
  // 右の辺を保って左へ 30 広げた箱。
  const grown = [70, 600, 220, 640];
  const frame = turn.turned(entry, { rect: grown, quads: [geometry.quadOfRect(grown)] });
  const shift = [frame.rect[0] - grown[0], frame.rect[1] - grown[1]];
  assert.ok(near(onPaper({ rect: frame.rect, angle: 45 }, [220 + shift[0], 620 + shift[1]]), onPaper(entry, [220, 620])));
});

test('turnPoint・cornerOf は回す前の点と箱の左上を紙の上へ移す（置いた向きの左上）', () => {
  assert.deepEqual(turn.cornerOf({ ...BASE, angle: undefined }), [100, 640]);
  assert.ok(near(turn.cornerOf(BASE), onPaper(BASE, [100, 640])));
  assert.ok(near(turn.cornerOf({ ...BASE, rotation: 90 }), onPaper(BASE, [100, 600])));
  assert.ok(near(turn.turnPoint([150, 610], BASE), onPaper(BASE, [150, 610])));
  assert.deepEqual(turn.turnPoint([150, 610], { ...BASE, angle: 0 }), [150, 610]);
});

test('screenAngleOf は 4 方向の画面の角度に angle を足し、360 で回す', () => {
  assert.equal(turn.screenAngleOf(0, { rotation: 0 }), 0);
  assert.equal(turn.screenAngleOf(0, { rotation: 0, angle: 30 }), 30);
  assert.equal(turn.screenAngleOf(90, { rotation: 0, angle: 300 }), 30);
  assert.equal(turn.screenAngleOf(0, { rotation: 90, angle: 30 }), 300);
});

test('入力欄の左上と角度は、直している書き込みの回し方で出す（新しく置くものは回さない）', () => {
  const entry = { ...BASE, angle: 30 };
  const draft = { origin: [100, 640], rotation: 0, entry };
  assert.ok(near(turn.draftCornerOf(draft), onPaper(entry, [100, 640])));
  assert.equal(turn.draftAngleOf(0, draft), 30);
  assert.deepEqual(turn.draftCornerOf({ origin: [100, 640], rotation: 0, entry: null }), [100, 640]);
  assert.equal(turn.draftAngleOf(90, { origin: [100, 640], rotation: 0, entry: null }), 90);
});

// 角度を当てる patch（確定事項A3）。今までの形は新しい形（固定の幅）へ移し、箱は回す前のまま、四角は回した 4 隅。
test('anglePatch は今までの形を固定の幅の新しい形へ移し、四角を回した 4 隅にする', async (t) => {
  const { withTextShell, placeText } = require('./text-helpers.js');
  const shell = await withTextShell(t);
  const { SigK: S } = shell;
  const placed = placeText(shell, 100, 700, 'あいう');
  const legacy = { ...placed };
  delete legacy.width;
  const patch = S.freeTextTurn.anglePatch(legacy, 30);
  assert.equal(patch.angle, 30);
  assert.equal(typeof patch.width, 'number');
  assert.equal(S.annotationEntry.validEntry({ ...legacy, ...patch }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(patch.quads)), JSON.parse(JSON.stringify([S.shapeRotation.quadOf(patch.rect, 30)])));
  const modern = S.freeTextTurn.anglePatch(placed, 45);
  assert.equal('width' in modern, false);
  assert.deepEqual(JSON.parse(JSON.stringify(modern.rect)), JSON.parse(JSON.stringify(placed.rect)));
  const back = S.freeTextTurn.anglePatch({ ...placed, angle: 45 }, 0);
  assert.equal(back.angle, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(back.quads)), JSON.parse(JSON.stringify([S.freeTextGeometry.quadOfRect(placed.rect)])));
});
