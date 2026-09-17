'use strict';

// 注釈を /Annots から外す層（spec-4-1 確定事項27。op-annotate.js から切り出した）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFDocument, PDFName } = require('pdf-lib');
const { parseRef, sameRef, annotsOf, removeAnnotations } = require('../worker/annotation-remove.js');

const TOOLS = { PDFName };

async function docWithAnnots(count) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const context = doc.context;
  const refs = [];
  for (let index = 0; index < count; index += 1) {
    const ap = context.register(context.stream('0 0 1 1 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1] }));
    refs.push(context.register(context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [0, 0, 10, 10], AP: { N: ap } })));
  }
  page.node.set(PDFName.of('Annots'), context.obj(refs));
  return { doc, page, refs };
}

test('parseRef は pdf.js の id を番号と世代に読む', () => {
  assert.deepEqual(parseRef('86R'), { num: 86, gen: 0 });
  assert.deepEqual(parseRef('86R2'), { num: 86, gen: 2 });
  assert.equal(parseRef('R'), null);
  assert.equal(parseRef('sigk-1'), null);
  assert.equal(parseRef(undefined), null);
});

test('sameRef は番号と世代の両方を見る', async () => {
  const { refs } = await docWithAnnots(1);
  assert.equal(sameRef(refs[0], { num: refs[0].objectNumber, gen: 0 }), true);
  assert.equal(sameRef(refs[0], { num: refs[0].objectNumber, gen: 1 }), false);
  assert.equal(sameRef(undefined, { num: 1, gen: 0 }), false);
});

test('annotsOf は /Annots の配列を返し、無ければ null', async () => {
  const { doc, page } = await docWithAnnots(2);
  assert.equal(annotsOf(page, doc.context, PDFName).asArray().length, 2);
  const blank = await PDFDocument.create();
  assert.equal(annotsOf(blank.addPage(), blank.context, PDFName), null);
});

test('removeAnnotations は指定した注釈と外観を消し、残りを /Annots に並べ直す', async () => {
  const { doc, page, refs } = await docWithAnnots(3);
  const before = doc.context.enumerateIndirectObjects().length;
  const removed = removeAnnotations(doc, [`${refs[1].objectNumber}R`, '9999R', 'abc'], TOOLS);
  assert.equal(removed, 1);
  assert.deepEqual(annotsOf(page, doc.context, PDFName).asArray().map((ref) => ref.objectNumber),
    [refs[0].objectNumber, refs[2].objectNumber]);
  // 辞書と外観の 2 つが減る。
  assert.equal(doc.context.enumerateIndirectObjects().length, before - 2);
  assert.equal(removeAnnotations(doc, [], TOOLS), 0);
});
