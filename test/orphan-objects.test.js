'use strict';

// 根から辿れない間接オブジェクトを消す（spec-4b-6b 確定事項22。事前調査 E・I）。モザイクの検体での働きは op-mosaic.test.js。

const test = require('node:test');
const assert = require('node:assert/strict');

const pdfLib = require('pdf-lib');
const { PDFDocument, PDFName, PDFDict } = pdfLib;
const { pruneOrphans, reachableRefs } = require('../worker/orphan-objects.js');

const TOOLS = { PDFRef: pdfLib.PDFRef, PDFDict, PDFArray: pdfLib.PDFArray, PDFStream: pdfLib.PDFStream, PDFRawStream: pdfLib.PDFRawStream };

test('辿れるもの（ページ・辞書・配列・流れの辞書の中の参照）は残し、辿れないものだけを消す', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([100, 100]);
  const orphan = ctx.register(ctx.obj({ Lost: true }));
  const viaArray = ctx.register(ctx.obj({ InArray: true }));
  const viaStream = ctx.register(ctx.obj({ InStream: true }));
  const stream = ctx.register(ctx.flateStream('q Q', { Ref: viaStream }));
  page.node.set(PDFName.of('Extra'), ctx.obj([viaArray, stream]));
  assert.equal(pruneOrphans(doc, TOOLS), 1);
  assert.equal(ctx.lookup(orphan), undefined);
  for (const ref of [viaArray, viaStream, stream])
    assert.ok(ctx.lookup(ref) !== undefined, ref.toString());
  assert.equal(pruneOrphans(doc, TOOLS), 0);
});

test('読み込んだファイルの古い版（相互参照の流れ・オブジェクトの流れ）は辿れずに消えても、保存して開き直せる', async () => {
  const source = await PDFDocument.create();
  source.addPage([100, 100]);
  const doc = await PDFDocument.load(await source.save({ useObjectStreams: true }));
  const before = reachableRefs(doc.context, TOOLS).size;
  pruneOrphans(doc, TOOLS);
  assert.equal(reachableRefs(doc.context, TOOLS).size, before);
  const reopened = await PDFDocument.load(await doc.save());
  assert.equal(reopened.getPageCount(), 1);
  assert.ok(reopened.catalog.lookup(PDFName.of('Pages'), PDFDict) !== undefined);
});
