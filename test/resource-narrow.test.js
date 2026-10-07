'use strict';

// モザイクのある保存で /Resources を使う名前だけに絞る（resource-narrow.js。spec-4b-6b 確定事項22。コードの点検で直した）。
//   - 共有・受け継ぎ・名前だけ並べた・書き込みの外観が共有する /Resources から、1 ページ目だけの中身が辿れて残らない
//   - 2 ページ目が使う物（自分の /Resources を持たないフォームが使うページのフォントも）と書き込みは残る
//   - ほどけない流れのページは絞らずに残す

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pdfLib = require('pdf-lib');
const { PDFDocument, PDFName, PDFDict } = pdfLib;
const { runSave } = require('../worker/pdf-task.js');
const { readSignature } = require('../pdf-write.js');
const { narrowResources } = require('../worker/resource-narrow.js');
const { scan, pngBytes } = require('./fixtures/mosaic-sample.js');
const { builders } = require('./fixtures/mosaic-leaks.js');

const TOOLS = { PDFName, PDFDict, PDFArray: pdfLib.PDFArray, PDFRef: pdfLib.PDFRef, PDFStream: pdfLib.PDFStream, PDFRawStream: pdfLib.PDFRawStream,
  decodePDFRawStream: pdfLib.decodePDFRawStream };

// 1 ページ目にモザイクを入れて保存（または抽出）し、保存先で語を数える。
async function saveWithMosaic(t, bytes, words, { kind = 'save' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-narrow-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'a.pdf');
  const target = kind === 'save' ? file : path.join(dir, 'b.pdf');
  fs.writeFileSync(file, bytes);
  const pages = kind === 'save' ? [{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }] : [{ src: 0, rotate: 0 }];
  const result = await runSave({ kind, source: file, target, pages, mosaics: [{ src: 0, kind: 'png', bytes: pngBytes(), box: [0, 0, 595, 842] }],
    dropBackup: kind === 'save', expect: await readSignature(file) });
  assert.equal(result.ok, true, result.error);
  const saved = fs.readFileSync(target);
  return { counts: scan(saved, words), doc: await PDFDocument.load(saved) };
}

function names(dict, category) {
  return dict.lookup(PDFName.of(category), PDFDict)?.keys().map((key) => key.decodeText()).sort() ?? [];
}

for (const [shape, label] of [['shared', '2 ページが 1 つの /Resources を共有'], ['inherited', '/Pages の /Resources を受け継ぐ'], ['listed', '2 ページ目が使わないフォームを名前だけ並べる']]) {
  test(`${label}: 1 ページ目だけのフォームは残らず、2 ページ目のフォームは残る`, async (t) => {
    const { counts, doc } = await saveWithMosaic(t, await builders[shape](), ['FORMSECRET', 'P2KEEP']);
    assert.deepEqual(counts, { FORMSECRET: 0, P2KEEP: 1 });
    const second = doc.getPages()[1].node;
    assert.deepEqual(names(second.Resources(), 'XObject'), ['FxC']);
    assert.equal(doc.catalog.Pages().get(PDFName.of('Resources')), undefined, '/Pages の /Resources は外す');
  });
}

test('自分の /Resources を持たないフォームが使うページのフォントは残す（# の書き方・2 本の /Contents）', async (t) => {
  const { counts, doc } = await saveWithMosaic(t, await builders.borrowing(), ['PAGESECRET', 'BORROWKEEP']);
  assert.deepEqual(counts, { PAGESECRET: 0, BORROWKEEP: 1 });
  const second = doc.getPages()[1].node.Resources();
  assert.deepEqual(names(second, 'XObject'), ['Fx-B']);
  assert.deepEqual(names(second, 'Font'), ['F1']);
});

test('書き込みの外観がページの /Resources を共有していても、保存でも抽出でも 1 ページ目のフォームは残らない', async (t) => {
  for (const kind of ['save', 'extract']) {
    const { counts, doc } = await saveWithMosaic(t, await builders.appearance(), ['FORMSECRET', 'ANNOTKEEP'], { kind });
    assert.deepEqual(counts, { FORMSECRET: 0, ANNOTKEEP: 1 }, kind);
    const annot = doc.getPages()[0].node.lookup(PDFName.of('Annots')).lookup(0, PDFDict);
    const appearance = annot.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
    assert.deepEqual(names(appearance.dict.lookup(PDFName.of('Resources'), PDFDict), 'Font'), ['F1'], `${kind}: 外観のフォントは残る`);
  }
});

test('ほどけない流れのページは絞らず、そのページの /Resources を自分の辞書として持つ', async () => {
  const doc = await PDFDocument.load(await builders.inherited());
  const second = doc.getPages()[1];
  second.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream('x', { Filter: 'JBIG2Decode' })));
  const result = narrowResources(doc, new Set([doc.getPages()[0].ref.toString()]), TOOLS);
  assert.equal(result.skipped, 1);
  assert.deepEqual(names(second.node.Resources(), 'XObject'), ['FxA', 'FxC'], '絞らずに残す');
  assert.equal(doc.catalog.Pages().get(PDFName.of('Resources')), undefined);
});
