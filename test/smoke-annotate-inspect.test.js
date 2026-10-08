'use strict';

// 起動確認の、保存先の FreeText の欄を読む口（smoke-annotate-inspect.js。spec-4b-4b の起動確認）。回したテキストと吹き出しの欄を読むこと。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { inspectTexts } = require('../smoke-annotate-inspect.js');
const smokeText = require('../smoke-annotate-text.js');
const { applyAnnotations } = require('../worker/op-annotate.js');
const { createFontSource } = require('../worker/font-embed.js');
const { matrixOf } = require('../worker/shape-rotation.js');

test('inspectTexts は回したテキストの /Matrix・/BBox と、吹き出しの /IT・/CL・/LE・/RD を読み、箱で切り抜いているかを返す', async (t) => {
  assert.equal(smokeText.inspectTexts, inspectTexts, 'smoke-annotate-text.js からも同じ口を引ける');
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const base = { src: 0, kind: 'text', color: '#222a35', opacity: 1, fontSize: 10, rotation: 0, text: 'あいう', width: 'auto', lines: ['あいう'], inset: [2, 2] };
  const box = [100, 686, 134, 700];
  const add = [
    { ...base, rect: box, angle: 30 },
    { ...base, rect: [100, 500, 145.5, 523.5], inset: [6.75, 6.75], fill: '#ffffff', borderColor: '#c00000', borderWidth: 1.5, callout: { tip: [90, 460] } },
  ];
  const tools = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
  assert.equal((await applyAnnotations(doc, { add }, tools, { fontSource: createFontSource({ fontkit }) })).ok, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-inspect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'texts.pdf');
  fs.writeFileSync(file, await doc.save());
  const [turned, callout] = await inspectTexts(file);
  assert.deepEqual(turned.matrix, matrixOf(box, 30));
  assert.deepEqual(turned.bbox, box);
  assert.deepEqual([turned.IT, turned.CL, turned.LE, turned.RD, turned.clipped], [null, null, null, null, true]);
  assert.deepEqual([callout.IT, callout.LE, callout.matrix, callout.clipped], ['FreeTextCallout', 'None', null, false]);
  assert.deepEqual(callout.CL.slice(0, 2), [90, 460]);
  assert.equal(callout.RD.length, 4);
  assert.deepEqual(callout.rect, callout.bbox);
  assert.deepEqual([turned.appearance, callout.appearance], [true, true], '本アプリが書いた FreeText には外観がある');
});

test('inspectTexts は外観（/AP）の無い FreeText でも止まらず、外観から読む欄を「無い」の値で返す', async () => {
  // annotated.pdf の 1 ページ目に、他のアプリが付けた /AP の無い FreeText が 1 つある（test/fixtures/annotations.js）。
  // この文書を開いて保存すると、保存先にもそのまま残る。
  const texts = await inspectTexts(path.join(__dirname, 'fixtures', 'annotated.pdf'));
  assert.equal(texts.length, 1);
  const [other] = texts;
  assert.deepEqual([other.page, other.rect, other.DA, other.C], [1, [300, 640, 500, 670], '/Helv 12 Tf 0 0 1 rg', [1, 1, 0.8]]);
  assert.deepEqual(
    [other.appearance, other.group, other.prefix, other.lines, other.italic, other.matrix, other.bbox, other.clipped],
    [false, false, null, 0, false, null, null, false],
  );
});

test('inspectTexts は外観の流れが Flate 以外の圧縮でも読み、ほどけない圧縮では止まらずに「読めない」の値で返す', async (t) => {
  // 他のアプリが作った FreeText の外観（/AP /N）は、/ASCIIHexDecode や重ね掛けの圧縮のことがある。テストの中で組む（fixtures は使わない）。
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const ctx = doc.context;
  // 外観の中身。1 行を Tm で置き、箱で切り抜く。
  const drawn = Buffer.from(['q', '2 2 96 26 re W n', 'BT', '/Helv 12 Tf', '1 0 0 1 4 10 Tm', '(abc) Tj', 'ET', 'Q', ''].join('\n'), 'latin1');
  const hex = (bytes) => `${bytes.toString('hex')}>`;
  const kinds = [
    ['FlateDecode', zlib.deflateSync(drawn)],
    ['ASCIIHexDecode', hex(drawn)],
    [['ASCIIHexDecode', 'FlateDecode'], hex(zlib.deflateSync(drawn))],
    [undefined, drawn],
    // pdf-lib がほどけない圧縮の代わり（中身は読めない並びのまま置く）。
    ['DCTDecode', drawn],
  ];
  const matrix = [1, 0, 0, 1, 0, 0];
  const rects = kinds.map((_kind, index) => [10, 250 - index * 50, 110, 280 - index * 50]);
  const refs = kinds.map(([Filter, body], index) => {
    const bbox = [0, 0, 100, 30];
    const normal = ctx.stream(body, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Matrix: matrix, ...(Filter === undefined ? {} : { Filter }) });
    const annot = { Type: 'Annot', Subtype: 'FreeText', Rect: rects[index], DA: PDFString.of('/Helv 12 Tf 0 g'), AP: { N: ctx.register(normal) } };
    return ctx.register(ctx.obj(annot));
  });
  page.node.set(PDFName.of('Annots'), ctx.obj(refs));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-inspect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'filters.pdf');
  fs.writeFileSync(file, await doc.save());

  const texts = await inspectTexts(file);
  assert.deepEqual(texts.map((text) => text.rect), rects);
  const read = (text) => [text.appearance, text.group, text.prefix, text.lines, text.italic, text.clipped, text.matrix, text.bbox];
  const [flate, asciiHex, layered, plain, unknown] = texts;
  const readable = [['/FlateDecode', flate], ['/ASCIIHexDecode', asciiHex], ['[/ASCIIHexDecode /FlateDecode]', layered], ['圧縮なし', plain]];
  for (const [label, text] of readable)
    assert.deepEqual(read(text), [true, false, null, 1, false, true, matrix, [0, 0, 100, 30]], `${label} の外観を読める`);
  // ほどけない外観は、流れの中から読む欄を null（分からない）にし、辞書から読む /Matrix・/BBox は読む。
  assert.deepEqual(read(unknown), ['unreadable', false, null, null, null, null, matrix, [0, 0, 100, 30]]);
});
