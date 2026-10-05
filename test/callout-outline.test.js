'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { outlineOf, calloutGeometryOf, outlineOps } = require('../worker/callout-outline.js');

require('../renderer/free-text-geometry.js');
require('../renderer/free-text-layout.js');
require('../renderer/shape-rotation.js');
require('../renderer/callout-shape.js');

// 保存側の吹き出しの輪郭（spec-4b-4b 確定事項E・G2・G3）。画面の callout-shape.js と同じ式（プロセスが違うので読み込み合わない）。

const BOX = [100, 600, 220, 644];

test('outlineOf は画面の callout-shape.js と同じ点の並びを返す', () => {
  const screen = globalThis.SigK.calloutShape;
  const cases = [
    [BOX, [80, 540], 12, 0.75], [BOX, [400, 900], 24, 1], [BOX, [300, 630], 12, 0], [BOX, [20, 610], 10.5, 2],
    [BOX, [150, 620], 12, 0.75], [[100, 600, 116, 617], [108, 560], 8, 0.75], [BOX, [220, 644.01], 12, 0.75],
  ];
  for (const [box, tip, fontSize, inset] of cases)
    assert.deepEqual(outlineOf(box, tip, { fontSize, inset }), screen.outlineOf(box, tip, { fontSize, inset }), JSON.stringify([box, tip]));
});

test('calloutGeometryOf は /BBox（箱と先を線の半分＋1 だけ広げた範囲）・/RD（箱との差）・/CL（紙の上の先と付け根）を組む', () => {
  const geometry = calloutGeometryOf({ rect: BOX, fontSize: 12, borderWidth: 1.5, callout: { tip: [80, 540] } });
  // 余白は 1.5/2 ＋ 1 ＝ 1.75。
  assert.deepEqual(geometry.bbox, [78.25, 538.25, 221.75, 645.75]);
  assert.deepEqual(geometry.rd, [21.75, 61.75, 1.75, 1.75]);
  // 付け根は線の半分だけ内へ寄せた箱の下の辺（y ＝ 600.75）の、角丸と半幅の内側（x ＝ 100.75 ＋ 10 ＋ 10）。
  assert.deepEqual(geometry.cl, [80, 540, 120.75, 600.75]);
  const inside = calloutGeometryOf({ rect: BOX, fontSize: 12, borderWidth: 1.5, callout: { tip: [150, 620] } });
  assert.deepEqual(inside.bbox, [98.25, 598.25, 221.75, 645.75]);
  assert.deepEqual(inside.cl, [150, 620, 150, 620], 'しっぽが無ければ付け根も先と同じ点');
});

test('回した吹き出しは、先を回す前の座標へ戻して組み、/CL の付け根は紙の上へ回す', () => {
  const center = [160, 622];
  const t = (30 * Math.PI) / 180;
  const turn = ([x, y], a) => [center[0] + (x - center[0]) * Math.cos(a) + (y - center[1]) * Math.sin(a), center[1] - (x - center[0]) * Math.sin(a) + (y - center[1]) * Math.cos(a)];
  const tip = turn([80, 540], t);
  const geometry = calloutGeometryOf({ rect: BOX, angle: 30, fontSize: 12, borderWidth: 1.5, callout: { tip } });
  assert.deepEqual(geometry.bbox, [78.25, 538.25, 221.75, 645.75]);
  assert.deepEqual(geometry.cl.slice(0, 2), tip.map((value) => Math.round(value * 100) / 100));
  const knee = turn([120.75, 600.75], t);
  assert.ok(Math.abs(geometry.cl[2] - knee[0]) < 0.006 && Math.abs(geometry.cl[3] - knee[1]) < 0.006);
});

test('outlineOps は点の並びを m・l・c・h にし、塗りと枠線に合わせて B・f・S で閉じる', () => {
  const segments = outlineOf(BOX, [80, 540], { fontSize: 12, inset: 0.75 });
  const both = outlineOps(segments, { fill: [1, 1, 1], border: [0.753, 0, 0], borderWidth: 1.5 });
  assert.equal(both[0], 'q');
  assert.ok(both.includes('1 1 1 rg') && both.includes('0.753 0 0 RG') && both.includes('1.5 w') && both.includes('1 j'));
  assert.equal(both.at(-2), 'B');
  assert.equal(both.at(-1), 'Q');
  assert.ok(both.some((op) => op.endsWith(' c')) && both.some((op) => op.endsWith(' m')) && both.includes('h'));
  assert.equal(outlineOps(segments, { fill: [1, 1, 1], border: null, borderWidth: 0 }).at(-2), 'f');
  assert.equal(outlineOps(segments, { fill: null, border: [0, 0, 0], borderWidth: 2 }).at(-2), 'S');
  assert.deepEqual(outlineOps(segments, { fill: null, border: null, borderWidth: 0 }), []);
});
