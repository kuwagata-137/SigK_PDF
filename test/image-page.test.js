'use strict';

// 画像を紙に載せる層のテスト（spec-1-6 確定事項59〜62・spec-3-1 確定事項12・16）。
//
// 差し込みとの違いは「拡大の可否」と「紙と箱を別に受けること」の2つだけである。
// 差し込みの挙動が変わっていないことは test/op-insert.test.js が守る。

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const { PDFDocument, PDFPage, PDFName, rgb } = require('pdf-lib');
const { toBytes } = require('../file-io.js');
const { fitInside, embedImage, drawImagePage, placeImage } = require('../worker/image-page.js');
const { makePng, makeJpeg } = require('./fixtures/images.js');

const TOOLS = { PDFPage, rgb };
const A4 = { width: 595.28, height: 841.89 };

function contentStreamOf(doc, index) {
  const contents = doc.context.lookup(doc.getPage(index).node.get(PDFName.of('Contents')));
  const streams = typeof contents.asArray === 'function'
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return streams
    .map((stream) => zlib.inflateSync(Buffer.from(stream.getContents())).toString('latin1'))
    .join('\n');
}

// 絵の置き場所と大きさを内容ストリームから読む。
function placementOf(drawn) {
  // 「1 0 0 1 0 0 cm」（恒等）が間に挟まるので、移動と拡縮を1本の正規表現で続けて読む。
  const found = drawn.match(/q\n1 0 0 1 ([\d.]+) ([\d.]+) cm\n1 0 0 1 0 0 cm\n([\d.]+) 0 0 ([\d.]+) 0 0 cm/);
  assert.ok(found !== null, '絵の変換行列がある');
  return { x: Number(found[1]), y: Number(found[2]), width: Number(found[3]), height: Number(found[4]) };
}

test('既定は拡大しない。allowUpscale で余白の内側へ最大化する', () => {
  const icon = { width: 64, height: 64 };
  const asIs = fitInside(icon, A4);
  assert.deepEqual([asIs.width, asIs.height], [64, 64]);

  const grown = fitInside(icon, A4, { allowUpscale: true });
  assert.equal(Math.round(grown.width), Math.round(A4.width), '幅いっぱいまで');
  assert.equal(Math.round(grown.height), Math.round(A4.width), '縦横比は保つ');
  assert.equal(Math.round(grown.x), 0);
  assert.equal(Math.round(grown.y), Math.round((A4.height - A4.width) / 2));

  // 大きい絵は allowUpscale でも縮む（内接であることは変わらない）。
  const wide = fitInside({ width: 4000, height: 3000 }, A4, { allowUpscale: true });
  assert.equal(Math.round(wide.width), Math.round(A4.width));
  assert.equal(fitInside(null, A4, { allowUpscale: true }), null);
});

test('埋め込む前に寸法と上限で断る', async () => {
  const doc = await PDFDocument.create();
  assert.match((await embedImage(doc, { kind: 'jpeg', bytes: makeJpeg({ width: 9000, height: 5000 }) })).error, /大きすぎます/);
  assert.match((await embedImage(doc, { kind: 'png', bytes: makePng({ width: 0, height: 0 }) })).error, /読み取れません/);
  assert.match((await embedImage(doc, { kind: 'png', bytes: Buffer.from('broken') })).error, /読み取れません/);
  const ok = await embedImage(doc, { kind: 'png', bytes: toBytes(makePng({ width: 30, height: 20 })) });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.image.width, ok.image.height], [30, 20]);
});

test('紙と箱を別に受け、箱の位置を足して載せる', async () => {
  const doc = await PDFDocument.create();
  const { image } = await embedImage(doc, { kind: 'png', bytes: toBytes(makePng({ width: 100, height: 50 })) });
  // A4 縦に 20mm（56.69pt）の余白。箱は 481.9×728.5。
  const m = 56.69;
  const layout = { page: A4, box: { x: m, y: m, width: A4.width - 2 * m, height: A4.height - 2 * m }, allowUpscale: true };
  const made = drawImagePage(doc, image, layout, TOOLS);
  assert.equal(made.ok, true);
  doc.addPage(made.page);
  assert.deepEqual(made.page.getSize(), { width: A4.width, height: A4.height }, '紙は用紙の大きさ');

  const back = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  const drawn = contentStreamOf(back, 0);
  assert.match(drawn, /1 1 1 rg/, '白で塗ってから');
  // 幅 481.9 に合わせて 481.9×240.95。箱の中央なので y は m + (728.5 - 240.95) / 2 ≒ 300.5。
  // pdf-lib は絵を「q → 1 0 0 1 x y cm（移動）→ w 0 0 h 0 0 cm（拡縮）→ Do」で描く。
  const placed = placementOf(drawn);
  assert.equal(Math.round(placed.width), 482);
  assert.equal(Math.round(placed.height), 241);
  assert.equal(Math.round(placed.x), 57, 'x は箱の左端');
  assert.equal(Math.round(placed.y), 300, 'y は箱の中で中央');
});

test('placeImage は箱と同じ大きさの紙に拡大せず載せる（差し込みの型）', async () => {
  const doc = await PDFDocument.create();
  const made = await placeImage(doc, { kind: 'png', bytes: toBytes(makePng({ width: 64, height: 64 })) }, A4, TOOLS);
  assert.equal(made.ok, true);
  doc.addPage(made.page);
  const back = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  const placed = placementOf(contentStreamOf(back, 0));
  assert.equal(Math.round(placed.width), 64, '原寸のまま');
  assert.equal(Math.round(placed.x), Math.round((A4.width - 64) / 2));
});

// ---- BMP・GIF・TIFF（spec-3-2 確定事項19） ----

const { makeBmp, rgbaGradient } = require('./fixtures/bmp.js');
const { makeGif } = require('./fixtures/gif.js');
const { makeTiff } = require('./fixtures/tiff.js');

const pdfLib = require('pdf-lib');
const FULL_TOOLS = { ...TOOLS, PDFImage: pdfLib.PDFImage, PngEmbedder: pdfLib.PngEmbedder, PDFName, PDFHexString: pdfLib.PDFHexString };

function xObjectDict(doc, image) {
  return doc.context.lookup(image.ref).dict;
}

test('BMP・GIF・TIFF は画素へ展開して /XObject にし、その場で埋め込む', async () => {
  const doc = await PDFDocument.create();
  const bmp = await embedImage(doc, { kind: 'bmp', bytes: toBytes(makeBmp({ width: 12, height: 9, bits: 24, pixels: rgbaGradient(12, 9) })) }, FULL_TOOLS);
  assert.equal(bmp.ok, true, bmp.error);
  assert.deepEqual([bmp.image.width, bmp.image.height], [12, 9]);
  assert.equal(xObjectDict(doc, bmp.image).get(PDFName.of('ColorSpace')).asString(), '/DeviceRGB');
  assert.equal(bmp.image.embedder, undefined, 'その場で embed 済み');

  const gif = await embedImage(doc, { kind: 'gif', bytes: toBytes(makeGif({ width: 5, height: 4, palette: [0xff0000, 0x00ff00], indices: new Uint8Array(20) })) }, FULL_TOOLS);
  assert.equal(gif.ok, true, gif.error);
  assert.deepEqual([gif.image.width, gif.image.height], [5, 4]);

  const bilevel = { width: 16, height: 2, bitsPerSample: [1], photometric: 0, compression: 1, pixels: Uint8Array.from([0xff, 0, 0, 0xff]) };
  const tiff = await embedImage(doc, { kind: 'tiff', bytes: toBytes(makeTiff([bilevel])) }, FULL_TOOLS);
  assert.equal(tiff.ok, true, tiff.error);
  const dict = xObjectDict(doc, tiff.image);
  assert.equal(dict.get(PDFName.of('BitsPerComponent')).asNumber(), 1, '2値は 1bit のまま');
  assert.deepEqual(dict.get(PDFName.of('Decode')).asArray().map((n) => n.asNumber()), [1, 0]);
});

test('複数ページの TIFF は frame でページを選ぶ', async () => {
  const doc = await PDFDocument.create();
  const page = (width, height) => ({ width, height, bitsPerSample: [8], photometric: 1, compression: 1, pixels: new Uint8Array(width * height) });
  const bytes = toBytes(makeTiff([page(4, 3), page(9, 2), page(1, 1)]));
  const second = await embedImage(doc, { kind: 'tiff', bytes }, FULL_TOOLS, { frame: 1 });
  assert.deepEqual([second.image.width, second.image.height], [9, 2]);
  const placed = await placeImage(doc, { kind: 'tiff', bytes }, A4, FULL_TOOLS, { frame: 2 });
  assert.equal(placed.ok, true);
  assert.match((await embedImage(doc, { kind: 'tiff', bytes }, FULL_TOOLS, { frame: 3 })).error, /読み取れません/);
});

test('3形式でも寸法と上限は埋め込む前に断り、道具が無ければ埋め込まない', async () => {
  const doc = await PDFDocument.create();
  const huge = { width: 9000, height: 5000, bitsPerSample: [1], photometric: 0, compression: 1, strips: [new Uint8Array(0)] };
  assert.match((await embedImage(doc, { kind: 'tiff', bytes: toBytes(makeTiff([huge])) }, FULL_TOOLS)).error, /大きすぎます/);
  const bmp = toBytes(makeBmp({ width: 4, height: 4, bits: 24, pixels: rgbaGradient(4, 4) }));
  assert.match((await embedImage(doc, { kind: 'bmp', bytes: bmp }, TOOLS)).error, /道具/);
  assert.match((await embedImage(doc, { kind: 'bmp', bytes: bmp.subarray(0, 60) }, FULL_TOOLS)).error, /壊れている/);
});
