'use strict';

// モザイクのページを画像 1 枚に差し替える（spec-4b-6b 確定事項20〜22。事前調査 I）。op-mosaic.js・struct-tree-page.js・orphan-objects.js を
// pdf-lib（node_modules）の文書で直に呼ぶ。保存の経路（runSave）は mosaic-save-worker.test.js。

const test = require('node:test');
const assert = require('node:assert/strict');

const pdfLib = require('pdf-lib');
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber } = pdfLib;
const { applyMosaics, validateMosaics, IMAGE_NAME } = require('../worker/op-mosaic.js');
const { pruneOrphans } = require('../worker/orphan-objects.js');
const { SECRETS, KEEPS, scan, buildMosaicSample, pngBytes } = require('./fixtures/mosaic-sample.js');

const TOOLS = { PDFName, PDFDict, PDFArray, PDFRef: pdfLib.PDFRef, PDFNumber, PDFStream: pdfLib.PDFStream, PDFRawStream: pdfLib.PDFRawStream };
const BOX = [0, 0, 595, 842];

async function mosaicked({ prune = true } = {}) {
  const doc = await PDFDocument.load(await buildMosaicSample(), { updateMetadata: false });
  const result = await applyMosaics(doc, [{ src: 0, kind: 'png', bytes: pngBytes(), box: BOX }], TOOLS);
  const removed = prune ? pruneOrphans(doc, TOOLS) : 0;
  const bytes = await doc.save();
  return { result, removed, bytes, reopened: await PDFDocument.load(bytes) };
}

test('差し替えて辿れない中身を消すと、1 ページ目の元の文字はどこにも残らず、2 ページ目と共有のもの・書き込みは残る', async () => {
  const before = scan(await buildMosaicSample(), [...SECRETS, ...KEEPS]);
  for (const word of [...SECRETS, ...KEEPS])
    assert.ok(before[word] > 0, `検体に ${word} がある`);

  const { result, removed, bytes } = await mosaicked();
  assert.deepEqual(result, { ok: true, count: 1 });
  assert.ok(removed > 0);
  const after = scan(bytes, [...SECRETS, ...KEEPS]);
  for (const word of SECRETS)
    assert.equal(after[word], 0, `${word} が残っている`);
  for (const word of KEEPS)
    assert.ok(after[word] > 0, `${word} が消えた`);
});

test('辿れない中身を消さなければ、本文と 1 ページ目だけのフォームが残る（消す段が要る理由）', async () => {
  const { bytes } = await mosaicked({ prune: false });
  const after = scan(bytes, SECRETS);
  assert.ok(after['SECRET-ONE'] > 0);
  assert.ok(after.FORMSECRET > 0);
});

test('差し替えたページは画像 1 枚の流れになり、書き込み・回転・CropBox・紙の大きさは変わらない', async () => {
  const { reopened } = await mosaicked();
  const page = reopened.getPages()[0];
  const xobjects = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  assert.deepEqual(xobjects.keys().map((key) => key.decodeText()), [IMAGE_NAME]);
  assert.equal(page.node.Resources().lookup(PDFName.of('Font')), undefined);
  assert.equal(page.getRotation().angle, 90);
  const crop = page.getCropBox();
  assert.deepEqual([crop.x, crop.y, crop.x + crop.width, crop.y + crop.height], [10, 20, 500, 800]);
  assert.deepEqual(Object.values(page.getMediaBox()), [0, 0, 595, 842]);
  assert.equal(page.node.Annots().size(), 1);
  for (const key of ['Thumb', 'PieceInfo', 'Metadata', 'StructParents'])
    assert.equal(page.node.get(PDFName.of(key)), undefined, key);
  // 2 ページ目は元のまま。
  const second = reopened.getPages()[1];
  assert.ok(second.node.Resources().lookup(PDFName.of('Font'), PDFDict) !== undefined);
  assert.equal(second.node.get(PDFName.of('StructParents')).asNumber(), 1);
});

test('構造ツリー: 1 ページ目の要素を外し、2 ページ目の子を持つ要素は ActualText だけ外して残し、ParentTree の項も消す', async () => {
  const { reopened } = await mosaicked();
  const root = reopened.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const section = root.lookup(PDFName.of('K'), PDFArray).lookup(0, PDFDict);
  assert.equal(section.get(PDFName.of('ActualText')), undefined);
  assert.equal(section.lookup(PDFName.of('T')).decodeText(), 'PARENTKEEP');
  const kids = section.lookup(PDFName.of('K'), PDFArray);
  assert.equal(kids.size(), 1);
  assert.equal(kids.lookup(0, PDFDict).lookup(PDFName.of('ActualText')).decodeText(), 'KEEPACTUAL');
  const leaf = root.lookup(PDFName.of('ParentTree'), PDFDict).lookup(PDFName.of('Kids'), PDFArray).lookup(0, PDFDict);
  const nums = leaf.lookup(PDFName.of('Nums'), PDFArray);
  assert.equal(nums.size(), 2);
  assert.equal(nums.lookup(0, PDFNumber).asNumber(), 1);
});

test('構造ツリーが無い文書でも差し替えられ、モザイクが無ければ何もしない', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 300]);
  assert.deepEqual(await applyMosaics(doc, [{ src: 0, kind: 'png', bytes: pngBytes(), box: [0, 0, 200, 300] }], TOOLS), { ok: true, count: 1 });
  assert.deepEqual(await applyMosaics(doc, [], TOOLS), { ok: true, count: 0 });
  assert.deepEqual(await applyMosaics(doc, undefined, TOOLS), { ok: true, count: 0 });
});

test('validateMosaics は、ページの外・重なり・形式・空のバイト列・箱の誤りを断る', () => {
  const ok = { src: 0, kind: 'png', bytes: new Uint8Array([1]), box: [0, 0, 1, 1] };
  assert.deepEqual(validateMosaics([ok], 2), { ok: true });
  for (const bad of [{ ...ok, src: 2 }, { ...ok, src: -1 }, { ...ok, kind: 'gif' }, { ...ok, bytes: new Uint8Array() }, { ...ok, bytes: [1] }, { ...ok, box: [0, 0, 0, 1] }, null])
    assert.ok(validateMosaics([bad], 2).error, JSON.stringify(bad));
  assert.ok(validateMosaics([ok, ok], 2).error, '同じページを 2 度');
  assert.ok(validateMosaics('x', 2).error);
});

test('画像を読めなければ断る（文書は差し替えない）', async () => {
  const doc = await PDFDocument.load(await buildMosaicSample());
  const result = await applyMosaics(doc, [{ src: 0, kind: 'png', bytes: new Uint8Array([1, 2, 3]), box: BOX }], TOOLS);
  assert.ok(result.error);
});

test('pruneOrphans は辿れるものを残し、辿れないものだけを消す', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  const orphan = doc.context.register(doc.context.obj({ Lost: true }));
  const kept = doc.context.register(doc.context.obj({ Kept: true }));
  page.node.set(PDFName.of('Kept'), kept);
  assert.equal(pruneOrphans(doc, TOOLS), 1);
  assert.equal(doc.context.lookup(orphan), undefined);
  assert.ok(doc.context.lookup(kept) instanceof PDFDict);
  assert.equal(pruneOrphans(doc, TOOLS), 0);
});
