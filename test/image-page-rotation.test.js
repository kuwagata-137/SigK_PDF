'use strict';

// 写真の EXIF の向きを当てて紙に載せる（画像→PDF と差し込み。spec-7-4 確定事項X4・X5）。
//
// 紙に載せる枠は、向きを当てた後の寸法（縦長の写真なら縦長）で決め、元の画素を回して枠に収める。
// 確かめ方: 内容ストリームの cm を掛け合わせて、元の画像の左上・右上の角が、紙のどの角へ移ったかを見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const { PDFDocument, PDFPage, PDFName, rgb, degrees } = require('pdf-lib');
const { embedImage, drawImagePage, placeImage } = require('../worker/image-page.js');
const { convertToSingle } = require('../worker/op-convert.js');
const { jpegWithExif } = require('./fixtures/jpeg-exif.js');

const TOOLS = { PDFDocument, PDFPage, rgb, degrees };

function contentOf(page) {
  const contents = page.doc.context.lookup(page.node.get(PDFName.of('Contents')));
  const streams = typeof contents.asArray === 'function' ? contents.asArray().map((ref) => page.doc.context.lookup(ref)) : [contents];
  return streams.map((stream) => {
    const raw = Buffer.from(stream.getContents());
    return stream.dict.get(PDFName.of('Filter')) === undefined ? raw.toString('latin1') : zlib.inflateSync(raw).toString('latin1');
  }).join('\n');
}

// 絵を描く q … Do … Q の中の cm を順に掛け、画像の単位正方形の点 (u, v) を紙の座標へ移す関数を返す。
function imageToPage(page) {
  const block = contentOf(page).split(/\bQ\b/).find((part) => / Do\b/.test(part));
  assert.ok(block !== undefined, '絵を描く命令がある');
  const matrices = [...block.matchAll(/([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) cm/g)].map((found) => found.slice(1).map(Number));
  return (u, v) => {
    let [x, y] = [u, v];
    for (const [a, b, c, d, e, f] of [...matrices].reverse())
      [x, y] = [a * x + c * y + e, b * x + d * y + f];
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  };
}

// 画像の単位正方形で、(0, 1) が元の画像の左上、(1, 1) が右上。
const TOP_LEFT = [0, 1];
const TOP_RIGHT = [1, 1];

async function drawWithExif(orientation, layout) {
  const doc = await PDFDocument.create();
  const embedded = await embedImage(doc, { kind: 'jpeg', bytes: jpegWithExif(orientation, { width: 30, height: 20 }) }, TOOLS);
  assert.equal(embedded.ok, true, embedded.error);
  const made = drawImagePage(doc, embedded.image, { ...layout, rotation: embedded.rotation }, TOOLS);
  assert.equal(made.ok, true, made.error);
  return { embedded, page: made.page };
}

const SQUARE = { page: { width: 100, height: 100 }, box: { x: 0, y: 0, width: 100, height: 100 } };

test('embedImage は、JPEG の向きのうち回転を rotation で返す（PNG・向きの無い JPEG・鏡に映した向きは 0）', async () => {
  for (const [orientation, rotation] of [[6, 90], [3, 180], [8, 270], [1, 0], [2, 0]])
    assert.equal((await drawWithExif(orientation, SQUARE)).embedded.rotation, rotation, `向き ${orientation}`);
});

test('向き 6（右に 90°）: 縦長の枠（20×30）に収め、元の左上を枠の右上へ、元の右上を枠の右下へ移す', async () => {
  const { page } = await drawWithExif(6, SQUARE);
  const map = imageToPage(page);
  // 縦長 20×30 を 100×100 の真ん中へ（拡大しない）: 枠は x 40〜60・y 35〜65。
  assert.deepEqual(map(...TOP_LEFT), [60, 65]);
  assert.deepEqual(map(...TOP_RIGHT), [60, 35]);
  assert.deepEqual(map(0, 0), [40, 65], '元の左下は枠の左上');
});

test('向き 3（180°）と 8（左に 90°）も、元の左上が回した後の正しい角へ移る', async () => {
  const upside = imageToPage((await drawWithExif(3, SQUARE)).page);
  // 横長 30×20: 枠は x 35〜65・y 40〜60。元の左上は右下へ。
  assert.deepEqual(upside(...TOP_LEFT), [65, 40]);
  assert.deepEqual(upside(...TOP_RIGHT), [35, 40]);
  const left = imageToPage((await drawWithExif(8, SQUARE)).page);
  // 縦長 20×30: 枠は x 40〜60・y 35〜65。元の左上は左下へ、元の右上は左上へ。
  assert.deepEqual(left(...TOP_LEFT), [40, 35]);
  assert.deepEqual(left(...TOP_RIGHT), [40, 65]);
});

test('向きが無ければ今までどおり回さずに載せる', async () => {
  const map = imageToPage((await drawWithExif(1, SQUARE)).page);
  assert.deepEqual(map(...TOP_LEFT), [35, 60]);
  assert.deepEqual(map(...TOP_RIGHT), [65, 60]);
});

test('拡大するとき（用紙に合わせる）は、向きを当てた後の縦横比で枠いっぱいにする', async () => {
  const map = imageToPage((await drawWithExif(6, { ...SQUARE, allowUpscale: true })).page);
  // 縦長 20×30 → 高さ 100 に合わせて 66.67×100。枠は x 16.67〜83.33。
  assert.deepEqual(map(...TOP_LEFT), [83.33, 100]);
  assert.deepEqual(map(0, 0), [16.67, 100]);
});

test('画像→PDF（convertToSingle）も向きを当てて載せる', async () => {
  const bytes = jpegWithExif(6, { width: 30, height: 20 });
  const result = await convertToSingle([{ name: 'photo.jpg', layouts: [SQUARE], load: async () => ({ ok: true, kind: 'jpeg', bytes, pages: 1 }) }], TOOLS);
  assert.equal(result.ok, true, result.error);
  const map = imageToPage(result.doc.getPage(0));
  assert.deepEqual(map(...TOP_LEFT), [60, 65]);
});

test('差し込み（placeImage）も向きを当て、縦長の写真は縦長の大きさで紙の真ん中に載せる', async () => {
  const doc = await PDFDocument.create();
  const made = await placeImage(doc, { kind: 'jpeg', bytes: jpegWithExif(6, { width: 30, height: 20 }) }, { width: 100, height: 100 }, TOOLS);
  assert.equal(made.ok, true, made.error);
  const map = imageToPage(made.page);
  assert.deepEqual(map(...TOP_LEFT), [60, 65]);
  assert.deepEqual(map(...TOP_RIGHT), [60, 35]);
});
