'use strict';

// 画素列を /XObject /Image にする層のテスト（spec-3-2 確定事項15〜17）。pdf-lib に依る。

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const pdfLib = require('pdf-lib');
const { PDFDocument, PDFPage, PDFName, rgb } = pdfLib;
const { embedPixels } = require('../worker/pixel-image.js');

const TOOLS = { PDFImage: pdfLib.PDFImage, PngEmbedder: pdfLib.PngEmbedder, PDFName, PDFHexString: pdfLib.PDFHexString, PDFPage, rgb };

function xObjectOf(doc, image) {
  const stream = doc.context.lookup(image.ref);
  const entry = (key) => stream.dict.get(PDFName.of(key));
  return { stream, entry, bytes: zlib.inflateSync(Buffer.from(stream.getContents())) };
}

test('RGB 8bit を /DeviceRGB の FlateDecode ストリームにして、その場で embed する', async () => {
  const doc = await PDFDocument.create();
  const bytes = Uint8Array.from({ length: 4 * 3 * 3 }, (_, i) => i);
  const embedded = await embedPixels(doc, { width: 4, height: 3, colorSpace: 'rgb', bitsPerComponent: 8, bytes }, TOOLS);
  assert.equal(embedded.ok, true, embedded.error);
  const { image } = embedded;
  assert.ok(image instanceof pdfLib.PDFImage);
  assert.equal(image.width, 4);
  assert.equal(image.height, 3);
  assert.equal(image.embedder, undefined, 'embed() 済みで画素を手放している');
  const { entry, bytes: stored } = xObjectOf(doc, image);
  assert.equal(entry('Subtype').asString(), '/Image');
  assert.equal(entry('ColorSpace').asString(), '/DeviceRGB');
  assert.equal(entry('BitsPerComponent').asNumber(), 8);
  assert.equal(entry('Filter').asString(), '/FlateDecode');
  assert.deepEqual(Array.from(stored), Array.from(bytes));
  await image.embed();                                     // 2回目は no-op
  assert.equal(doc.context.lookup(image.ref), xObjectOf(doc, image).stream);
});

test('2値の gray は 1bit のまま入り、inverted なら /Decode [1 0] が付く', async () => {
  const doc = await PDFDocument.create();
  const bytes = Uint8Array.from([0xf0, 0x0f]);
  const inverted = await embedPixels(doc, { width: 16, height: 1, colorSpace: 'gray', bitsPerComponent: 1, bytes, inverted: true }, TOOLS);
  const { entry, bytes: stored } = xObjectOf(doc, inverted.image);
  assert.equal(entry('ColorSpace').asString(), '/DeviceGray');
  assert.equal(entry('BitsPerComponent').asNumber(), 1);
  assert.deepEqual(entry('Decode').asArray().map((n) => n.asNumber()), [1, 0]);
  assert.deepEqual(Array.from(stored), [0xf0, 0x0f]);
  const plain = await embedPixels(doc, { width: 16, height: 1, colorSpace: 'gray', bitsPerComponent: 1, bytes }, TOOLS);
  assert.equal(xObjectOf(doc, plain.image).entry('Decode'), undefined);
});

test('パレットは /Indexed /DeviceRGB hival <16進> になり、CMYK は /DeviceCMYK', async () => {
  const doc = await PDFDocument.create();
  const palette = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const indexed = await embedPixels(doc, { width: 4, height: 1, colorSpace: 'indexed', bitsPerComponent: 2, bytes: Uint8Array.from([0b00011011]), palette }, TOOLS);
  const colorSpace = xObjectOf(doc, indexed.image).entry('ColorSpace');
  const parts = colorSpace.asArray();
  assert.equal(parts[0].asString(), '/Indexed');
  assert.equal(parts[1].asString(), '/DeviceRGB');
  assert.equal(parts[2].asNumber(), 3);
  assert.equal(parts[3].asString(), 'ff000000ff000000ffffffff');
  assert.equal(parts[3].toString(), '<ff000000ff000000ffffffff>');
  const cmyk = await embedPixels(doc, { width: 1, height: 1, colorSpace: 'cmyk', bitsPerComponent: 8, bytes: Uint8Array.from([1, 2, 3, 4]) }, TOOLS);
  assert.equal(xObjectOf(doc, cmyk.image).entry('ColorSpace').asString(), '/DeviceCMYK');
});

test('埋め込んだ絵は page.drawImage で載せられ、save して読み直せる', async () => {
  const doc = await PDFDocument.create();
  const embedded = await embedPixels(doc, { width: 2, height: 2, colorSpace: 'gray', bitsPerComponent: 8, bytes: Uint8Array.from([0, 85, 170, 255]) }, TOOLS);
  const page = PDFPage.create(doc);
  page.setSize(100, 100);
  page.drawImage(embedded.image, { x: 10, y: 10, width: 80, height: 80 });
  doc.addPage(page);
  const saved = await doc.save();
  const again = await PDFDocument.load(saved);
  assert.equal(again.getPageCount(), 1);
  const resources = again.context.lookup(again.getPage(0).node.get(PDFName.of('Resources')));
  const xObjects = again.context.lookup(resources.get(PDFName.of('XObject')));
  const [name] = xObjects.keys();
  const stream = again.context.lookup(xObjects.get(name));
  assert.equal(stream.dict.get(PDFName.of('Width')).asNumber(), 2);
  assert.deepEqual(Array.from(zlib.inflateSync(Buffer.from(stream.getContents()))), [0, 85, 170, 255]);
});

test('形の合わない pixels は文言で断る', async () => {
  const doc = await PDFDocument.create();
  const before = doc.context.enumerateIndirectObjects().length;
  const bytes = new Uint8Array(3);
  assert.match((await embedPixels(doc, { width: 0, height: 1, colorSpace: 'rgb', bitsPerComponent: 8, bytes }, TOOLS)).error, /大きさ/);
  assert.match((await embedPixels(doc, { width: 1, height: 1, colorSpace: 'ycbcr', bitsPerComponent: 8, bytes }, TOOLS)).error, /色の形式/);
  assert.match((await embedPixels(doc, { width: 1, height: 1, colorSpace: 'rgb', bitsPerComponent: 16, bytes }, TOOLS)).error, /色の形式/);
  assert.match((await embedPixels(doc, { width: 1, height: 1, colorSpace: 'rgb', bitsPerComponent: 8, bytes: null }, TOOLS)).error, /壊れている/);
  assert.equal(doc.context.enumerateIndirectObjects().length, before, '断ったときは何も登録しない');
});
