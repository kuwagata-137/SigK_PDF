'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { applyAnnotations } = require('../worker/op-annotate.js');
const { createFontSource } = require('../worker/font-embed.js');
const { freeTextRotationOf } = require('../worker/free-text-frame.js');
const { detailsOf } = require('../worker/annotation-dict-reader.js');
const { matrixOf, rectOf } = require('../worker/shape-rotation.js');

// FreeText の回転の読み（spec-4b-4b 確定事項I1。事前調査 B・C）。

const TOOLS = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
const NOW = new Date(2026, 9, 4, 12, 0, 0);
const fontSource = createFontSource({ fontkit });

function wrapped(overrides = {}) {
  return {
    src: 0, kind: 'text', color: '#222a35', opacity: 1, rect: [100, 674.5, 224, 720.5], text: 'あいうえおかきくけこさし\nab', fontSize: 10,
    rotation: 0, width: 'auto', lines: ['あいうえおかきくけこさし', 'ab'], inset: [2, 2], ...overrides,
  };
}

// 保存して読み直した 1 件目の注釈の辞書。
async function savedDict(entry) {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const result = await applyAnnotations(doc, { add: [entry] }, TOOLS, { now: NOW, fontSource });
  assert.equal(result.ok, true);
  const saved = await PDFDocument.load(await doc.save({ addDefaultPage: false }));
  const annots = saved.context.lookup(saved.getPages()[0].node.get(PDFName.of('Annots')));
  return { dict: saved.context.lookup(annots.get(0)), context: saved.context };
}

test('SigK の回したテキストは /BBox をそのまま箱にし、角度を読む', async () => {
  const entry = wrapped({ angle: 30 });
  const { dict, context } = await savedDict(entry);
  assert.deepEqual(freeTextRotationOf(dict, context), { box: entry.rect, angle: 30 });
  assert.deepEqual(detailsOf(dict, context).rotation, { box: entry.rect, angle: 30 }, '口の答えの rotation に入る');
});

test('文字の向き 90・270 の cm があっても「ゆがみ」とみなさない（事前調査 C）', async () => {
  for (const rotation of [90, 270]) {
    const { dict, context } = await savedDict(wrapped({ rotation, rect: [100, 500, 146, 624], angle: 137 }));
    assert.deepEqual(freeTextRotationOf(dict, context), { box: [100, 500, 146, 624], angle: 137 });
    const flat = await savedDict(wrapped({ rotation, rect: [100, 500, 146, 624] }));
    assert.equal(freeTextRotationOf(flat.dict, flat.context), null, '回していなければ null');
  }
});

test('/Matrix が箱の中心まわりでない書き方（原点の /BBox など）は、四角・丸と同じ読み方の答えを返す', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const context = doc.context;
  const local = [0, 0, 120, 40];
  const turn = matrixOf(local, 45);
  const matrix = [turn[0], turn[1], turn[2], turn[3], turn[4] + 300, turn[5] + 400];
  const stream = context.register(context.stream('0 0 1 rg 0 0 120 40 re f', { Type: 'XObject', Subtype: 'Form', BBox: local, Matrix: matrix }));
  const rect = rectOf([300, 400, 420, 440], 45);
  const dict = context.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: rect, DA: PDFString.of('/Helv 12 Tf 0 g'), AP: { N: stream } });
  page.node.set(PDFName.of('Annots'), context.obj([context.register(dict)]));
  const answer = freeTextRotationOf(dict, context);
  assert.equal(answer.angle, 45);
  answer.box.forEach((value, index) => assert.ok(Math.abs(value - [300, 400, 420, 440][index]) <= 0.011));
});

test('外観や /Rect が無ければ null', async () => {
  const doc = await PDFDocument.create();
  const dict = doc.context.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [0, 0, 10, 10] });
  assert.equal(freeTextRotationOf(dict, doc.context), null);
  const bare = doc.context.obj({ Type: 'Annot', Subtype: 'FreeText' });
  assert.equal(freeTextRotationOf(bare, doc.context), null);
});

// ---- 吹き出し（spec-4b-4b 確定事項I2） ----

const { freeTextFrameOf } = require('../worker/free-text-frame.js');
const { fixturePath } = require('./fixtures/build.js');
const fs = require('node:fs');

function callout(overrides = {}) {
  return wrapped({ fill: '#ffffff', borderColor: '#c00000', borderWidth: 2, tip: [130, 640], ...overrides });
}

test('SigK の吹き出しは、箱を /BBox − /RD［左 下 右 上］、先を /CL の始点で読む（回していなければ rotation は null）', async () => {
  const entry = callout();
  const { dict, context } = await savedDict(entry);
  assert.deepEqual(freeTextFrameOf(dict, context), { rotation: null, callout: { box: entry.rect, tip: [130, 640] } });
  assert.deepEqual(detailsOf(dict, context).callout, { box: entry.rect, tip: [130, 640] });
});

test('回した吹き出しは、回転の中心が箱の中心であることを確かめ、先を回す前へ戻す', async () => {
  const entry = callout({ angle: 137, tip: [130.25, 640.5] });
  const { dict, context } = await savedDict(entry);
  const frame = freeTextFrameOf(dict, context);
  assert.deepEqual(frame.rotation, { box: entry.rect, angle: 137 });
  assert.deepEqual(frame.callout, { box: entry.rect, tip: [130.25, 640.5] });
});

test('吹き出しの /RD・/CL が崩れていれば unreadable、吹き出しでなければ callout は null', async () => {
  const { dict, context } = await savedDict(callout());
  dict.set(PDFName.of('RD'), context.obj([-1, 0, 0, 0]));
  assert.equal(freeTextFrameOf(dict, context).callout, 'unreadable');
  const second = await savedDict(callout());
  second.dict.delete(PDFName.of('CL'));
  assert.equal(freeTextFrameOf(second.dict, second.context).callout, 'unreadable');
  const plain = await savedDict(wrapped());
  assert.equal(freeTextFrameOf(plain.dict, plain.context).callout, null);
});

test('他のアプリの線と矢印の吹き出しと回した FreeText も読めはする（直せるかは画面が /DA の書体名で決める）', async () => {
  const doc = await PDFDocument.load(fs.readFileSync(fixturePath('callouts.pdf')));
  const annots = doc.context.lookup(doc.getPages()[0].node.get(PDFName.of('Annots')));
  const [other, turned] = annots.asArray().map((ref) => doc.context.lookup(ref));
  assert.deepEqual(freeTextFrameOf(other, doc.context), { rotation: null, callout: { box: [200, 600, 320, 640], tip: [120, 520] } });
  const turnedFrame = freeTextFrameOf(turned, doc.context);
  assert.equal(turnedFrame.rotation.angle, 30);
  assert.equal(turnedFrame.callout, null);
});

test('吹き出しの箱（/BBox − /RD）は足し引きの端数を持ち込まない', async () => {
  const { dict, context } = await savedDict(callout());
  const normal = context.lookup(context.lookup(dict.get(PDFName.of('AP'))).get(PDFName.of('N')));
  // 464.86 + 23.48 は浮動小数で 488.34000000000003 になる。
  normal.dict.set(PDFName.of('BBox'), context.obj([464.86, 600, 600, 700]));
  dict.set(PDFName.of('RD'), context.obj([23.48, 0, 0, 0]));
  assert.deepEqual(freeTextFrameOf(dict, context).callout.box, [488.34, 600, 600, 700]);
});
