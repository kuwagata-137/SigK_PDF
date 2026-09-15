'use strict';

// テキストマークアップ注釈を /Annots へ書く・から外す層（spec-4-1 確定事項22〜27）。
//
// 書いた結果は保存して読み直してから見る。組み立て途中の状態ではなく
// 「ファイルとして」正しいかを確かめるためである（op-extract.test.js と同じ流儀）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFDocument, PDFName, PDFString, PDFArray, PDFRef } = require('pdf-lib');
const { parseRef, applyAnnotations } = require('../worker/op-annotate.js');
const { pick } = require('../worker/pdf-tree-reader.js');

const TOOLS = { PDFName, PDFString, PDFArray, PDFRef };
const NOW = new Date(2026, 8, 15, 12, 0, 0);

const QUAD = [48, 753, 232, 753, 48, 743, 232, 743];
const RECT = [48, 743, 232, 753];

function markup(overrides = {}) {
  return { src: 0, kind: 'highlight', color: '#ffe45a', opacity: 1, quads: [QUAD], rect: RECT, ...overrides };
}

async function makeDoc(pageCount) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1)
    doc.addPage([595.28, 841.89]);
  return doc;
}

async function roundTrip(doc) {
  const bytes = await doc.save({ addDefaultPage: false });
  return PDFDocument.load(bytes, { updateMetadata: false });
}

// ページの /Annots を { ref, dict } の並びで読む。
function annotsOf(doc, pageIndex) {
  const page = doc.getPages()[pageIndex];
  const annots = doc.context.lookup(page.node.get(PDFName.of('Annots')));
  if (annots === undefined)
    return [];
  return annots.asArray().map((ref) => ({ ref, dict: doc.context.lookup(ref) }));
}

function nameOf(dict, key) {
  return pick(dict, key)?.asString?.() ?? null;
}

function numbersOf(doc, value) {
  return doc.context.lookup(value).asArray().map((item) => item.asNumber());
}

test('parseRef は pdf.js の id を番号と世代に読む', () => {
  assert.deepEqual(parseRef('86R'), { num: 86, gen: 0 });
  assert.deepEqual(parseRef('86R2'), { num: 86, gen: 2 });
  assert.equal(parseRef('R'), null);
  assert.equal(parseRef('sigk-1'), null);
  assert.equal(parseRef(undefined), null);
});

test('add で /Annots に辞書と外観が入る', async () => {
  const doc = await makeDoc(2);
  const result = applyAnnotations(doc, { add: [markup(), markup({ src: 1, kind: 'underline', color: '#d92c2c' })] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 2, removed: 0 });

  const saved = await roundTrip(doc);
  const first = annotsOf(saved, 0);
  assert.equal(first.length, 1);
  const dict = first[0].dict;
  assert.equal(nameOf(dict, '/Subtype'), '/Highlight');
  assert.equal(nameOf(dict, '/Type'), '/Annot');
  assert.deepEqual(numbersOf(saved, pick(dict, '/QuadPoints')), QUAD);
  assert.deepEqual(numbersOf(saved, pick(dict, '/Rect')), RECT);
  assert.deepEqual(numbersOf(saved, pick(dict, '/C')).map((v) => Math.round(v * 100) / 100), [1, 0.89, 0.35]);
  assert.equal(pick(dict, '/F').asNumber(), 4);
  assert.match(pick(dict, '/NM').decodeText(), /^sigk-[0-9a-z]+-1$/);
  assert.equal(pick(dict, '/M').decodeText(), "D:20260915120000+09'00'");
  // 外観は Form XObject で、ハイライトは Multiply。
  const ap = saved.context.lookup(pick(dict, '/AP'));
  const normal = saved.context.lookup(pick(ap, '/N'));
  assert.equal(nameOf(normal.dict, '/Subtype'), '/Form');
  const gs = saved.context.lookup(pick(saved.context.lookup(pick(normal.dict, '/Resources')), '/ExtGState'));
  assert.equal(nameOf(saved.context.lookup(pick(gs, '/GS')), '/BM'), '/Multiply');
  assert.match(Buffer.from(normal.contents).toString('latin1'), /re f$/);

  const second = annotsOf(saved, 1);
  assert.equal(nameOf(second[0].dict, '/Subtype'), '/Underline');
  const ap2 = saved.context.lookup(pick(second[0].dict, '/AP'));
  const gs2 = saved.context.lookup(pick(saved.context.lookup(pick(saved.context.lookup(pick(ap2, '/N')).dict, '/Resources')), '/ExtGState'));
  assert.equal(pick(saved.context.lookup(pick(gs2, '/GS')), '/BM'), undefined);
});

test('既に /Annots があるページには後ろに足す', async () => {
  const doc = await makeDoc(1);
  applyAnnotations(doc, { add: [markup()] }, TOOLS, { now: NOW });
  applyAnnotations(doc, { add: [markup({ kind: 'strikeout', color: '#000000' })] }, TOOLS, { now: NOW });
  const saved = await roundTrip(doc);
  assert.deepEqual(annotsOf(saved, 0).map((a) => nameOf(a.dict, '/Subtype')), ['/Highlight', '/StrikeOut']);
});

test('remove は pdf.js の id で外し、外観ごと消えて孤児が残らない', async () => {
  const doc = await makeDoc(1);
  applyAnnotations(doc, { add: [markup(), markup({ kind: 'underline', color: '#d92c2c' })] }, TOOLS, { now: NOW });
  const saved = await roundTrip(doc);
  const before = annotsOf(saved, 0);
  const objectsBefore = saved.context.enumerateIndirectObjects().length;
  const id = `${before[0].ref.objectNumber}R`;

  const result = applyAnnotations(saved, { remove: [id, '9999R'] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 0, removed: 1 });
  const again = await roundTrip(saved);
  const after = annotsOf(again, 0);
  assert.equal(after.length, 1);
  assert.equal(nameOf(after[0].dict, '/Subtype'), '/Underline');
  // 辞書と外観の 2 つが減る。
  assert.equal(again.context.enumerateIndirectObjects().length, objectsBefore - 2);
});

test('remove は /Popup を持つ注釈のポップアップも一緒に外す', async () => {
  const doc = await makeDoc(1);
  const page = doc.getPages()[0];
  const context = doc.context;
  const popupRef = context.register(context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [0, 0, 100, 100], Open: false }));
  const annotRef = context.register(context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: RECT, QuadPoints: QUAD, C: [1, 1, 0], Popup: popupRef }));
  context.lookup(popupRef).set(PDFName.of('Parent'), annotRef);
  page.node.set(PDFName.of('Annots'), context.obj([annotRef, popupRef]));
  const saved = await roundTrip(doc);
  const id = `${annotsOf(saved, 0)[0].ref.objectNumber}R`;

  const result = applyAnnotations(saved, { remove: [id] }, TOOLS, { now: NOW });
  assert.equal(result.removed, 1);
  const again = await roundTrip(saved);
  assert.deepEqual(annotsOf(again, 0), []);
});

test('remove で消し、同じ保存で add も足せる', async () => {
  const doc = await makeDoc(2);
  applyAnnotations(doc, { add: [markup()] }, TOOLS, { now: NOW });
  const saved = await roundTrip(doc);
  const id = `${annotsOf(saved, 0)[0].ref.objectNumber}R`;
  const result = applyAnnotations(saved, { add: [markup({ src: 1 })], remove: [id] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 1, removed: 1 });
  const again = await roundTrip(saved);
  assert.equal(annotsOf(again, 0).length, 0);
  assert.equal(annotsOf(again, 1).length, 1);
});

test('形が違えば何も書かずに断る', async () => {
  const doc = await makeDoc(1);
  assert.deepEqual(applyAnnotations(doc, { add: [markup({ src: 3 })] }, TOOLS), { error: '注釈 1 のページ番号が文書に合いません。' });
  assert.deepEqual(applyAnnotations(doc, { add: [markup(), markup({ kind: 'note' })] }, TOOLS), { error: '注釈 2 の形が読めません。' });
  assert.deepEqual(applyAnnotations(doc, { remove: ['abc'] }, TOOLS), { error: '消す注釈の指定が読めません。' });
  assert.deepEqual(annotsOf(await roundTrip(doc), 0), []);
});

test('何も無ければ何もしない', async () => {
  const doc = await makeDoc(1);
  assert.deepEqual(applyAnnotations(doc, {}, TOOLS), { ok: true, added: 0, removed: 0 });
  assert.deepEqual(applyAnnotations(doc, undefined, TOOLS), { ok: true, added: 0, removed: 0 });
});
