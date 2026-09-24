'use strict';

// 透かしのワーカー（spec-4-5 確定事項20〜26）。fixture と生成した画像だけを使う（.claude/CLAUDE.md 付則C）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFImage, PngEmbedder, PDFHexString, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { WATERMARK_NAME, MAX_TEXT_LENGTH, WATERMARK_FONT_ERROR, applyWatermark } = require('../worker/op-watermark.js');
const { placementOf, matrixText } = require('../worker/watermark-layout.js');
const { createFontSource } = require('../worker/font-embed.js');
const { runTask } = require('../worker/pdf-task.js');
const { makePng, makeJpeg } = require('./fixtures/images.js');
const { fixturePath } = require('./fixtures/build.js');

const TOOLS = { PDFDocument, PDFName, PDFImage, PngEmbedder, PDFHexString, rgb };
const fontSource = createFontSource({ fontkit });
const TEXT_MARK = { type: 'text', text: '社外秘', color: '#808080', opacity: 0.3, angle: 45, size: 'medium', position: 'center' };

async function makeDoc(pageCount, { rotate = {} } = {}) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`page ${index + 1}`, { x: 50, y: 780, size: 12 });
    if (rotate[index] !== undefined)
      page.setRotation({ type: 'degrees', angle: rotate[index] });
  }
  return doc;
}

async function roundTrip(doc) {
  return PDFDocument.load(await doc.save({ addDefaultPage: false }), { updateMetadata: false });
}

function textOf(stream) {
  const filter = stream.dict.get(PDFName.of('Filter'));
  const bytes = filter?.encodedName === '/FlateDecode' ? zlib.inflateSync(Buffer.from(stream.contents)) : Buffer.from(stream.contents);
  return bytes.toString('latin1');
}

function xobjectsOf(doc, index) {
  const resources = doc.getPage(index).node.Resources();
  const dict = resources?.lookup(PDFName.of('XObject'));
  return dict instanceof PDFDict ? dict : null;
}

// ページの内容の最後の 1 本（透かしの行）。
function lastContentOf(doc, index) {
  const contents = doc.context.lookup(doc.getPage(index).node.get(PDFName.of('Contents')));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return textOf(doc.context.lookup(refs[refs.length - 1]));
}

function countObjects(doc, predicate) {
  return doc.context.enumerateIndirectObjects().filter(([, obj]) => predicate(obj)).length;
}

const isFont = (obj) => obj instanceof PDFDict && obj.get(PDFName.of('Type'))?.encodedName === '/Font';
const isWatermarkForm = (obj) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.encodedName === '/Form'
  && textOf(obj).startsWith('/GS gs');

test('文字の透かしは対象ページだけに SigKWM を置き、XObject は文書に 1 つで、フォントを埋めない', async () => {
  // 読み直した文書に当てる（drawText のフォントは保存のときに初めて登録されるので、数える前に 1 度保存する）。
  const doc = await roundTrip(await makeDoc(3));
  const fontsBefore = countObjects(doc, isFont);
  assert.equal(fontsBefore, 3);
  const result = await applyWatermark(doc, { pages: [0, 2], mark: TEXT_MARK }, TOOLS, { fontSource });
  assert.deepEqual(result, { ok: true, pages: 2 });
  const saved = await roundTrip(doc);
  const first = xobjectsOf(saved, 0).get(PDFName.of(WATERMARK_NAME));
  const third = xobjectsOf(saved, 2).get(PDFName.of(WATERMARK_NAME));
  assert.ok(first instanceof PDFRef);
  assert.equal(first.objectNumber, third.objectNumber);
  assert.equal(xobjectsOf(saved, 1)?.get(PDFName.of(WATERMARK_NAME)), undefined);
  assert.equal(countObjects(saved, isWatermarkForm), 1);
  assert.equal(countObjects(saved, isFont), fontsBefore);
});

test('透かしの XObject は輪郭だけで文字の演算子を持たず、不透明度と色を持つ', async () => {
  const doc = await makeDoc(1);
  await applyWatermark(doc, { pages: [0], mark: { ...TEXT_MARK, color: '#d92c2c', opacity: 0.5 } }, TOOLS, { fontSource });
  const saved = await roundTrip(doc);
  const form = saved.context.lookup(xobjectsOf(saved, 0).get(PDFName.of(WATERMARK_NAME)));
  const content = textOf(form);
  assert.match(content, /^\/GS gs\n0\.85 0\.17 0\.17 rg\n/);
  assert.match(content, /\nf$/);
  assert.doesNotMatch(content, /\bBT\b|\bTj\b|\bTJ\b|\bTf\b/);
  const gs = saved.context.lookup(saved.context.lookup(form.dict.get(PDFName.of('Resources'))).lookup(PDFName.of('ExtGState'))).lookup(PDFName.of('GS'));
  assert.equal(gs.get(PDFName.of('ca')).asNumber(), 0.5);
  assert.equal(gs.get(PDFName.of('CA')).asNumber(), 0.5);
  const bbox = form.dict.lookup(PDFName.of('BBox')).asArray().map((item) => item.asNumber());
  assert.ok(bbox[0] <= -150 && bbox[2] >= 150 && bbox[1] <= -72.4 && bbox[3] >= 72.4, String(bbox));
});

test('ページの内容に /Artifact で包んだ 1 行を足し、行列は watermark-layout.js と同じ（/Rotate 90 のページも）', async () => {
  const doc = await makeDoc(2, { rotate: { 1: 90 } });
  await applyWatermark(doc, { pages: [0, 1], mark: TEXT_MARK }, TOOLS, { fontSource });
  const saved = await roundTrip(doc);
  const form = saved.context.lookup(xobjectsOf(saved, 1).get(PDFName.of(WATERMARK_NAME)));
  const bbox = form.dict.lookup(PDFName.of('BBox')).asArray().map((item) => item.asNumber());
  assert.ok(bbox.length === 4);
  for (const [index, rotate] of [[0, 0], [1, 90]]) {
    const matrix = placementOf({ box: [0, 0, 595.28, 841.89], rotate, width: 300, height: 144.8, angle: 45, size: 'medium', position: 'center' });
    assert.equal(lastContentOf(saved, index),
      `/Artifact <</Type /Pagination /Subtype /Watermark>> BDC q ${matrixText(matrix)} cm /${WATERMARK_NAME} Do Q EMC`);
  }
});

test('CropBox が MediaBox と違うページでは CropBox を基準に置く', async () => {
  const doc = await makeDoc(1);
  doc.getPage(0).setCropBox(100, 200, 300, 400);
  await applyWatermark(doc, { pages: [0], mark: { ...TEXT_MARK, angle: 0 } }, TOOLS, { fontSource });
  const matrix = placementOf({ box: [100, 200, 400, 600], rotate: 0, width: 300, height: 144.8, angle: 0, size: 'medium', position: 'center' });
  assert.equal(lastContentOf(await roundTrip(doc), 0), `/Artifact <</Type /Pagination /Subtype /Watermark>> BDC q ${matrixText(matrix)} cm /${WATERMARK_NAME} Do Q EMC`);
  assert.equal(matrix[4], 250);
  assert.equal(matrix[5], 400);
});

test('Resources を共有する PDF でもキーは 1 つだけ増える', async () => {
  // 3 ページが 1 つの Resources を指す文書を作り、保存して読み直したものに当てる（実際のファイルと同じ形）。
  const built = await PDFDocument.create();
  const shared = built.context.register(built.context.obj({ XObject: {} }));
  for (let index = 0; index < 3; index += 1)
    built.addPage([595.28, 841.89]).node.set(PDFName.of('Resources'), shared);
  const doc = await roundTrip(built);
  await applyWatermark(doc, { pages: [0, 1, 2], mark: TEXT_MARK }, TOOLS, { fontSource });
  const saved = await roundTrip(doc);
  for (const index of [0, 1, 2])
    assert.deepEqual(xobjectsOf(saved, index).keys().map((key) => key.encodedName), [`/${WATERMARK_NAME}`], String(index));
  assert.equal(countObjects(saved, isWatermarkForm), 1);
});

test('SigKWM という名前に別のものがあれば、空いている SigKWM1 を使う', async () => {
  const doc = await makeDoc(1);
  const other = doc.context.register(doc.context.stream('0 0 m', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1] }));
  doc.getPage(0).node.normalizedEntries().XObject.set(PDFName.of(WATERMARK_NAME), other);
  await applyWatermark(doc, { pages: [0], mark: TEXT_MARK }, TOOLS, { fontSource });
  const saved = await roundTrip(doc);
  assert.equal(xobjectsOf(saved, 0).get(PDFName.of(WATERMARK_NAME)).objectNumber, other.objectNumber);
  assert.ok(xobjectsOf(saved, 0).get(PDFName.of(`${WATERMARK_NAME}1`)) instanceof PDFRef);
  assert.match(lastContentOf(saved, 0), new RegExp(`/${WATERMARK_NAME}1 Do Q EMC$`));
});

test('PNG の透かしは画像を 1 回だけ埋め、透過（SMask）を保つ', async () => {
  const doc = await makeDoc(2);
  const png = makePng({ width: 40, height: 20, alpha: 0x80 });
  const readFile = async () => new Uint8Array(png);
  const mark = { type: 'image', image: 'logo.png', opacity: 0.5, angle: 0, size: 'small', position: 'top-right' };
  assert.deepEqual(await applyWatermark(doc, { pages: [0, 1], mark }, TOOLS, { fontSource, readFile }), { ok: true, pages: 2 });
  const saved = await roundTrip(doc);
  const form = saved.context.lookup(xobjectsOf(saved, 0).get(PDFName.of(WATERMARK_NAME)));
  assert.equal(textOf(form), ['/GS gs', 'q 100 0 0 50 -50 -25 cm', '/Im Do', 'Q'].join('\n'));
  const image = saved.context.lookup(saved.context.lookup(form.dict.get(PDFName.of('Resources'))).lookup(PDFName.of('XObject')).get(PDFName.of('Im')));
  assert.equal(image.dict.get(PDFName.of('Subtype')).encodedName, '/Image');
  assert.ok(image.dict.get(PDFName.of('SMask')) instanceof PDFRef);
  const images = countObjects(saved, (obj) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.encodedName === '/Image');
  assert.equal(images, 2);   // 本体と SMask の 2 つ。ページ数ぶんは増えない
});

test('JPEG の透かしも埋められ、BMP は PNG か JPEG を選ぶよう断る', async () => {
  const doc = await makeDoc(1);
  const mark = { type: 'image', image: 'photo.jpg', opacity: 0.3, angle: 45, size: 'large', position: 'center' };
  const jpeg = makeJpeg({ width: 32, height: 16 });
  assert.deepEqual(await applyWatermark(doc, { pages: [0], mark }, TOOLS, { fontSource, readFile: async () => new Uint8Array(jpeg) }), { ok: true, pages: 1 });
  const bmp = fs.readFileSync(fixturePath('image-rgb.bmp'));
  assert.deepEqual(await applyWatermark(await makeDoc(1), { pages: [0], mark }, TOOLS, { fontSource, readFile: async () => new Uint8Array(bmp) }),
    { error: 'PNG か JPEG の画像を選んでください。' });
});

test('画像を読めなければ断る', async () => {
  const mark = { type: 'image', image: 'missing.png', opacity: 0.3, angle: 0, size: 'medium', position: 'center' };
  const readFile = async () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); };
  assert.deepEqual(await applyWatermark(await makeDoc(1), { pages: [0], mark }, TOOLS, { fontSource, readFile }),
    { error: '透かしの画像を読めませんでした。' });
});

test('対象ページが空・範囲外・重複・昇順でなければ、何も書かずに断る', async () => {
  for (const pages of [[], [3], [-1], [1, 1], [2, 0], [0.5], 'all', undefined]) {
    const doc = await makeDoc(3);
    assert.deepEqual(await applyWatermark(doc, { pages, mark: TEXT_MARK }, TOOLS, { fontSource }), { error: '透かしを入れるページが正しくありません。' }, String(pages));
    assert.equal(xobjectsOf(doc, 0)?.get(PDFName.of(WATERMARK_NAME)), undefined);
  }
});

test('設定が読めなければ断る（向き・大きさ・位置・不透明度・色・種類）', async () => {
  const cases = [
    { angle: 30 }, { size: 'huge' }, { position: 'middle' }, { opacity: 0 }, { opacity: 1.5 }, { color: 'gray' }, { type: 'stamp' },
  ];
  for (const patch of cases) {
    const result = await applyWatermark(await makeDoc(1), { pages: [0], mark: { ...TEXT_MARK, ...patch } }, TOOLS, { fontSource });
    assert.deepEqual(result, { error: '透かしの設定が読めません。' }, JSON.stringify(patch));
  }
});

test('文字は空白だけ・長すぎるものを断り、50 文字ちょうどは受ける', async () => {
  assert.equal(MAX_TEXT_LENGTH, 50);
  const run = async (text) => applyWatermark(await makeDoc(1), { pages: [0], mark: { ...TEXT_MARK, text } }, TOOLS, { fontSource });
  assert.deepEqual(await run('   '), { error: '透かしの文字を入れてください。' });
  assert.deepEqual(await run(''), { error: '透かしの文字を入れてください。' });
  assert.deepEqual(await run('あ'.repeat(51)), { error: `透かしの文字は ${MAX_TEXT_LENGTH} 文字までです。` });
  assert.deepEqual(await run('あ'.repeat(50)), { ok: true, pages: 1 });
});

test('同梱フォントを読めなければ文字の透かしを断る', async () => {
  const broken = { load: () => ({ ok: false, error: 'x' }) };
  assert.deepEqual(await applyWatermark(await makeDoc(1), { pages: [0], mark: TEXT_MARK }, TOOLS, { fontSource: broken }), { error: WATERMARK_FONT_ERROR });
});

test('runTask の kind: watermark で読み → 当てる → 書くが通り、元のファイルは変わらない', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-watermark-'));
  try {
    const source = path.join(dir, 'in.pdf');
    const target = path.join(dir, 'out.pdf');
    fs.copyFileSync(fixturePath('rotated.pdf'), source);
    const before = fs.readFileSync(source);
    const phases = [];
    const result = await runTask(
      { kind: 'watermark', source, target, pages: [0, 1, 2], mark: TEXT_MARK },
      { send: (message) => phases.push(message.phase) },
    );
    assert.equal(result.ok, true, result.error);
    assert.equal(result.pages, 3);
    assert.equal(result.path, target);
    assert.deepEqual([...new Set(phases)], ['read', 'load', 'apply', 'save', 'write']);
    assert.deepEqual(fs.readFileSync(source), before);
    const written = await PDFDocument.load(fs.readFileSync(target), { updateMetadata: false });
    for (const index of [0, 1, 2])
      assert.ok(xobjectsOf(written, index).get(PDFName.of(WATERMARK_NAME)) instanceof PDFRef, String(index));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runTask の kind: watermark は元が読めない・壊れていると断る', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-watermark-'));
  try {
    const target = path.join(dir, 'out.pdf');
    const missing = await runTask({ kind: 'watermark', source: path.join(dir, 'none.pdf'), target, pages: [0], mark: TEXT_MARK });
    assert.equal(missing.error, '元のファイルが見つかりません。移動または削除された可能性があります。');
    const broken = await runTask({ kind: 'watermark', source: fixturePath('broken.pdf'), target, pages: [0], mark: TEXT_MARK });
    assert.equal(broken.error, 'この PDF は内容が壊れているため保存できません。');
    assert.equal(fs.existsSync(target), false);
    assert.equal((await runTask({ kind: 'watermark', target, pages: [0], mark: TEXT_MARK })).error, '対象のファイルが決まっていません。');
    assert.equal((await runTask({ kind: 'watermark', source: fixturePath('one-page.pdf'), pages: [0], mark: TEXT_MARK })).error, '保存先が決まっていません。');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
