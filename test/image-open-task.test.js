'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument, PDFName } = require('pdf-lib');
const { buildImageDocument, runImageOpen } = require('../worker/image-open-task.js');
const { runTask } = require('../worker/pdf-task.js');
const { makePng, makeJpeg } = require('./fixtures/images.js');
const { makeBmp, rgbaGradient } = require('./fixtures/bmp.js');

// 画像を開くための PDF（spec-7-1 確定事項A1〜A4）。1 画素＝1pt で、白を敷かない。

function tempFile(t, name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-image-open-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, name);
  fs.writeFileSync(target, bytes);
  return target;
}

// 1 ページ目の内容の流れの文字列（白い四角を敷いていれば re と rg が入る）。
async function contentOf(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const streams = contents.asArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  const zlib = require('node:zlib');
  const text = streams.map((stream) => {
    const raw = Buffer.from(stream.getContents());
    return stream.dict.get(PDFName.of('Filter')) === undefined ? raw.toString('latin1') : zlib.inflateSync(raw).toString('latin1');
  }).join('\n');
  return { doc, page, text };
}

test('PNG は画素と同じ大きさ（1 画素＝1pt）の紙に、白を敷かずに載せる', async () => {
  const built = await buildImageDocument(new Uint8Array(makePng({ width: 30, height: 20, alpha: 0x80 })));
  assert.equal(built.ok, true);
  assert.equal(built.kind, 'png');
  assert.deepEqual(built.frames, [{ width: 30, height: 20 }]);
  const { page, text } = await contentOf(built.bytes);
  assert.deepEqual(page.getSize(), { width: 30, height: 20 });
  assert.doesNotMatch(text, / re\b/, '白い四角を敷いていない');
  assert.match(text, /30 0 0 20 0 0 cm/, '画像を紙いっぱいに等倍で置く');
});

test('BMP も展開して載せる', async () => {
  const bmp = makeBmp({ width: 5, height: 4, pixels: rgbaGradient(5, 4) });
  const built = await buildImageDocument(new Uint8Array(bmp));
  assert.equal(built.ok, true);
  assert.equal(built.kind, 'bmp');
  assert.deepEqual(built.frames, [{ width: 5, height: 4 }]);
});

test('プログレッシブ形式の JPEG は「開けません」で断る', async () => {
  const built = await buildImageDocument(new Uint8Array(makeJpeg({ marker: 0xc2 })));
  assert.equal(built.error, 'この JPEG はプログレッシブ形式なので、開けません。');
});

test('画像でないものは断る', async () => {
  const built = await buildImageDocument(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
  assert.equal(built.ok, undefined);
  assert.equal(typeof built.error, 'string');
});

test('runImageOpen は読む前の印を添え、JPEG のときだけ元のバイト列を添える', async (t) => {
  const png = tempFile(t, 'a.png', makePng({ width: 4, height: 3 }));
  const jpeg = tempFile(t, 'b.jpg', makeJpeg({ width: 16, height: 8 }));
  const fromPng = await runImageOpen({ path: png });
  assert.equal(fromPng.ok, true);
  assert.equal(fromPng.signature.size, fs.statSync(png).size);
  assert.equal('original' in fromPng, false);
  const fromJpeg = await runImageOpen({ path: jpeg });
  assert.equal(fromJpeg.kind, 'jpeg');
  assert.deepEqual([...fromJpeg.original], [...fs.readFileSync(jpeg)]);
});

test('runImageOpen は無いファイル・パスの無い頼みを断る', async () => {
  assert.equal((await runImageOpen({})).error, '開く画像が決まっていません。');
  assert.match((await runImageOpen({ path: path.join(os.tmpdir(), 'sigk-無い.png') })).error, /画像を読めませんでした/);
});

test('ワーカーの入口は image-open を振り分け、ファイルを書かない', async (t) => {
  const png = tempFile(t, 'c.png', makePng({ width: 4, height: 3 }));
  const before = fs.readdirSync(path.dirname(png));
  const result = await runTask({ kind: 'image-open', path: png });
  assert.equal(result.ok, true);
  assert.deepEqual(fs.readdirSync(path.dirname(png)), before);
});
