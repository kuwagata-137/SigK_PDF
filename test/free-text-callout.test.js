'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isCallout, validCallout, calloutPartsOf, originOf, sizeOf } = require('../worker/free-text-callout.js');
const { matrixOf } = require('../worker/shape-rotation.js');
const { transformPoint } = require('../worker/pdf-matrix.js');

// 吹き出しの外観と辞書の欄（spec-4b-4b 確定事項H2・H3）。

const RECT = [100, 600, 220, 630];
const ENTRY = { rotation: 0, fontSize: 12, tip: [130, 560] };
const PARTS = { rect: RECT, first: [100, 630], fillRgb: [1, 1, 1], borderRgb: [0.753, 0, 0], borderWidth: 2 };

test('isCallout・validCallout は 2 つの数の先と、塗りか枠線を見る（確定事項A3・A5）', () => {
  assert.equal(isCallout(ENTRY), true);
  assert.equal(isCallout({}), false);
  assert.equal(validCallout({}, false, false), true, '吹き出しでなければ見ない');
  assert.equal(validCallout(ENTRY, true, false), true);
  assert.equal(validCallout(ENTRY, false, true), true);
  assert.equal(validCallout(ENTRY, false, false), false);
  assert.equal(validCallout({ tip: [1] }, true, true), false);
  assert.equal(validCallout({ tip: [1, Number.NaN] }, true, true), false);
  assert.equal(validCallout({ tip: 'x' }, true, true), false);
});

test('originOf・sizeOf は表示の左上と表示の向きの大きさ（renderer の frameOrigin・frameSize と同じ）', () => {
  assert.deepEqual(originOf(RECT, 0), [100, 630]);
  assert.deepEqual(originOf(RECT, 90), [100, 600]);
  assert.deepEqual(originOf(RECT, 180), [220, 600]);
  assert.deepEqual(originOf(RECT, 270), [220, 630]);
  assert.deepEqual(sizeOf(RECT, 0), { width: 120, height: 30 });
  assert.deepEqual(sizeOf(RECT, 90), { width: 30, height: 120 });
});

test('/BBox は箱と先（線の太さの半分）を含み、/RD は［左 下 右 上］、/CL は先と根元の中心（決定59 ③）', () => {
  const parts = calloutPartsOf(ENTRY, PARTS);
  assert.deepEqual(parts.bbox, [100, 559, 220, 630]);
  assert.deepEqual(parts.rd, [0, 41, 0, 0], '下にだけしっぽが出る');
  // 根元は下の辺（枠線の分だけ内側 = 601）で、先の x に合わせて滑る。
  assert.deepEqual(parts.cl, [130, 560, 130, 601]);
  assert.equal(parts.ops[0], '1 1 1 rg');
  assert.deepEqual(parts.ops.slice(1, 4), ['0.753 0 0 RG', '2 w', '1 j']);
  assert.equal(parts.ops.at(-1), 'B');
  assert.ok(parts.ops.includes('130 560 l'), '先を通る');
});

test('塗りだけなら f、枠線だけなら S。枠線が無ければ /BBox は先から 0.5 だけ外へ', () => {
  const fillOnly = calloutPartsOf(ENTRY, { ...PARTS, borderRgb: null, borderWidth: 0 });
  assert.equal(fillOnly.ops.at(-1), 'f');
  assert.equal(fillOnly.ops.some((op) => op.endsWith(' RG')), false);
  assert.deepEqual(fillOnly.bbox, [100, 559.5, 220, 630]);
  const borderOnly = calloutPartsOf(ENTRY, { ...PARTS, fillRgb: null });
  assert.equal(borderOnly.ops.at(-1), 'S');
  assert.equal(borderOnly.ops.some((op) => op.endsWith(' rg')), false);
});

test('回した吹き出しの /CL は回した位置（小数 4 桁）、/BBox と /RD は回す前のまま（確定事項H2）', () => {
  const turned = calloutPartsOf({ ...ENTRY, angle: 137 }, PARTS);
  const plain = calloutPartsOf(ENTRY, PARTS);
  assert.deepEqual(turned.bbox, plain.bbox);
  assert.deepEqual(turned.rd, plain.rd);
  const tip = transformPoint([130, 560], matrixOf(RECT, 137)).map((value) => Math.round(value * 10000) / 10000);
  assert.deepEqual(turned.cl.slice(0, 2), tip);
  assert.ok(turned.cl.some((value) => !Number.isInteger(value * 100)), '2 桁に丸めない');
});

test('文字の向き 90 の吹き出しは、ローカルの向きで輪郭を組み、紙の座標の /BBox にする', () => {
  // 向き 90 の箱 [100 600 130 720]（表示の幅 120・高さ 30）。表示の下は紙の +x。
  const rect = [100, 600, 130, 720];
  const parts = calloutPartsOf({ rotation: 90, fontSize: 12, tip: [170, 630] }, { ...PARTS, rect, first: [600, -100] });
  assert.deepEqual(parts.bbox, [100, 600, 171, 720]);
  assert.deepEqual(parts.rd, [0, 0, 41, 0]);
});
