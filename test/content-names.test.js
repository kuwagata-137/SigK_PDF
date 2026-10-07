'use strict';

// 内容の流れが使う資源の名前を読む（content-names.js。spec-4b-6b 確定事項22。コードの点検で足した）。

const test = require('node:test');
const assert = require('node:assert/strict');

const pdfLib = require('pdf-lib');
const { PDFDocument, PDFName, PDFDict } = pdfLib;
const { namesIn, createContentNames } = require('../worker/content-names.js');

const TOOLS = { PDFName, PDFDict, PDFArray: pdfLib.PDFArray, PDFRef: pdfLib.PDFRef, PDFStream: pdfLib.PDFStream, PDFRawStream: pdfLib.PDFRawStream,
  decodePDFRawStream: pdfLib.decodePDFRawStream };

test('namesIn は区切りの字で切り、# の書き方をほどく', () => {
  const found = namesIn(Buffer.from('q /Im1 Do /F#2D1 12 Tf [/Pattern]cs<</MCID 0>>BDC (a/b) /'), new Set());
  assert.deepEqual([...found].sort(), ['', 'F-1', 'Im1', 'MCID', 'Pattern', 'b']);
});

test('ページは /Contents の流れ（配列も）、フォームは流れ自身、Type3 は /CharProcs の流れから読む', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const { namesOf } = createContentNames(ctx, TOOLS);
  const page = doc.addPage([100, 100]);
  page.node.set(PDFName.of('Contents'), ctx.obj([ctx.register(ctx.flateStream('/Im1 Do')), ctx.register(ctx.stream('/F1 9 Tf'))]));
  assert.deepEqual([...namesOf(page.node)].sort(), ['F1', 'Im1']);
  const form = ctx.flateStream('/Fx2 Do', { Subtype: 'Form' });
  assert.deepEqual([...namesOf(form)], ['Fx2']);
  const type3 = ctx.obj({ Subtype: 'Type3', CharProcs: { a: ctx.register(ctx.flateStream('/Gs1 gs')) } });
  assert.deepEqual([...namesOf(type3)], ['Gs1']);
  // pdf-lib が作る内容の流れ（PDFContentStream）もほどく。
  const drawn = ctx.contentStream([pdfLib.PDFOperator.of('Do', [PDFName.of('Im9')])]);
  assert.deepEqual([...namesOf(drawn)], ['Im9']);
});

test('知らない圧縮の流れが 1 本でもあれば null', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([100, 100]);
  page.node.set(PDFName.of('Contents'), ctx.obj([ctx.register(ctx.flateStream('/Im1 Do')), ctx.register(ctx.stream('x', { Filter: 'JBIG2Decode' }))]));
  assert.equal(createContentNames(ctx, TOOLS).namesOf(page.node), null);
  assert.deepEqual([...createContentNames(ctx, TOOLS).namesOf(doc.addPage([10, 10]).node)], [], '/Contents が無いページは名前なし');
});
