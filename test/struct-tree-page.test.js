'use strict';

// 構造ツリーから 1 ページの要素を外す（spec-4b-6b 確定事項21。事前調査 I）。検体の全体は op-mosaic.test.js が見る。ここは形の違い。

const test = require('node:test');
const assert = require('node:assert/strict');

const pdfLib = require('pdf-lib');
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFString } = pdfLib;
const { dropPageFromStructTree } = require('../worker/struct-tree-page.js');

const TOOLS = { PDFName, PDFDict, PDFArray, PDFRef: pdfLib.PDFRef, PDFNumber, PDFStream: pdfLib.PDFStream };

async function twoPages() {
  const doc = await PDFDocument.create();
  return { doc, p1: doc.addPage([100, 100]), p2: doc.addPage([100, 100]) };
}

function setRoot(doc, root) {
  doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.register(root));
}

test('/Pg を持たない要素は親の /Pg を受け継ぎ、MCID の子だけなら外れる。書き込みを指す OBJR は残す', async () => {
  const { doc, p1, p2 } = await twoPages();
  const ctx = doc.context;
  const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] }));
  const inherited = ctx.obj({ S: 'Span', K: [0, 1], Alt: PDFString.of('INHERITED') });
  const link = ctx.obj({ S: 'Link', K: [ctx.obj({ Type: 'OBJR', Obj: annot })], ActualText: PDFString.of('LINKTEXT') });
  const parent = ctx.obj({ S: 'P', Pg: p1.ref, K: [inherited, link] });
  const other = ctx.obj({ S: 'P', Pg: p2.ref, K: 0 });
  setRoot(doc, ctx.obj({ Type: 'StructTreeRoot', K: [parent, other] }));

  assert.equal(dropPageFromStructTree(doc, p1.ref, undefined, TOOLS), true);
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const kids = root.lookup(PDFName.of('K'), PDFArray);
  assert.equal(kids.size(), 2, '書き込みの OBJR を持つ親は残る');
  const keptParent = kids.lookup(0, PDFDict);
  const parentKids = keptParent.lookup(PDFName.of('K'), PDFArray);
  assert.equal(parentKids.size(), 1, 'MCID だけの Span は外れ、Link は残る');
  const keptLink = parentKids.lookup(0, PDFDict);
  assert.equal(keptLink.get(PDFName.of('ActualText')), undefined, '1 ページ目の要素の ActualText は外す');
  assert.equal(kids.lookup(1, PDFDict).lookup(PDFName.of('K'), PDFNumber).asNumber(), 0, '2 ページ目はそのまま');
});

test('ParentTree が /Nums を直に持つ形でも、そのページの項だけを消す', async () => {
  const { doc, p1, p2 } = await twoPages();
  const ctx = doc.context;
  const e1 = ctx.register(ctx.obj({ S: 'P', Pg: p1.ref, K: 0 }));
  const e2 = ctx.register(ctx.obj({ S: 'P', Pg: p2.ref, K: 0 }));
  setRoot(doc, ctx.obj({ Type: 'StructTreeRoot', K: [e1, e2], ParentTree: { Nums: [0, [e1], 1, [e2]] } }));
  dropPageFromStructTree(doc, p1.ref, 0, TOOLS);
  const nums = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict).lookup(PDFName.of('ParentTree'), PDFDict).lookup(PDFName.of('Nums'), PDFArray);
  assert.equal(nums.size(), 2);
  assert.equal(nums.lookup(0, PDFNumber).asNumber(), 1);
});

test('構造ツリーが無ければ false で何もしない。要素の /K が 1 つだけ（配列でない）の形も扱う', async () => {
  const { doc, p1 } = await twoPages();
  assert.equal(dropPageFromStructTree(doc, p1.ref, 0, TOOLS), false);
  const ctx = doc.context;
  const single = ctx.obj({ S: 'Figure', Pg: p1.ref, K: ctx.obj({ Type: 'MCR', MCID: 3 }), Alt: PDFString.of('X') });
  setRoot(doc, ctx.obj({ Type: 'StructTreeRoot', K: single }));
  dropPageFromStructTree(doc, p1.ref, undefined, TOOLS);
  const kids = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict).lookup(PDFName.of('K'), PDFArray);
  assert.equal(kids.size(), 0);
});

// コードの点検で見つかった形（3 つ）。どれも直す前は元の文字が根から辿れて残った。
test('外す要素からも /ActualText・/Alt・/E を外す（/IDTree から辿れて残るため）', async () => {
  const { doc, p1, p2 } = await twoPages();
  const ctx = doc.context;
  const e1 = ctx.register(ctx.obj({ S: 'P', Pg: p1.ref, K: 0, ID: PDFString.of('x1'), ActualText: PDFString.of('IDTREESECRET'), Alt: PDFString.of('A'), E: PDFString.of('E') }));
  const e2 = ctx.register(ctx.obj({ S: 'P', Pg: p2.ref, K: 0 }));
  setRoot(doc, ctx.obj({ Type: 'StructTreeRoot', K: [e1, e2], IDTree: { Names: [PDFString.of('x1'), e1] } }));
  dropPageFromStructTree(doc, p1.ref, undefined, TOOLS);
  const root = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  assert.equal(root.lookup(PDFName.of('K'), PDFArray).size(), 1, '要素は外れる');
  const dropped = ctx.lookup(e1, PDFDict);
  for (const key of ['ActualText', 'Alt', 'E'])
    assert.equal(dropped.get(PDFName.of(key)), undefined, key);
});

test('ほかのページの要素でも、そのページの子（MCR）を外したら /ActualText を外す（ページをまたぐ段落）', async () => {
  const { doc, p1, p2 } = await twoPages();
  const ctx = doc.context;
  const para = ctx.obj({ S: 'P', Pg: p2.ref, K: [0, ctx.obj({ Type: 'MCR', Pg: p1.ref, MCID: 0 })], ActualText: PDFString.of('CROSSSECRET') });
  const untouched = ctx.obj({ S: 'P', Pg: p2.ref, K: 1, ActualText: PDFString.of('KEEP') });
  setRoot(doc, ctx.obj({ Type: 'StructTreeRoot', K: [para, untouched] }));
  dropPageFromStructTree(doc, p1.ref, undefined, TOOLS);
  const kids = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict).lookup(PDFName.of('K'), PDFArray);
  assert.equal(kids.size(), 2);
  assert.equal(kids.lookup(0, PDFDict).lookup(PDFName.of('K'), PDFArray).size(), 1, '2 ページ目の MCID は残る');
  assert.equal(kids.lookup(0, PDFDict).get(PDFName.of('ActualText')), undefined);
  assert.equal(kids.lookup(1, PDFDict).lookup(PDFName.of('ActualText')).decodeText(), 'KEEP', '子を外していない要素はそのまま');
});

test('そのページのフォーム・画像（流れ）を指す OBJR は外し、書き込みを指す OBJR は残す', async () => {
  const { doc, p1, p2 } = await twoPages();
  const ctx = doc.context;
  const formRef = ctx.register(ctx.flateStream('BT (FORMSECRET) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10] }));
  const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] }));
  const figure = ctx.obj({ S: 'Figure', Pg: p1.ref, K: [ctx.obj({ Type: 'OBJR', Obj: formRef }), ctx.obj({ Type: 'OBJR', Obj: annot })] });
  const otherForm = ctx.obj({ S: 'Figure', Pg: p2.ref, K: ctx.obj({ Type: 'OBJR', Obj: formRef }) });
  setRoot(doc, ctx.obj({ Type: 'StructTreeRoot', K: [figure, otherForm] }));
  dropPageFromStructTree(doc, p1.ref, undefined, TOOLS);
  const kids = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict).lookup(PDFName.of('K'), PDFArray);
  const figureKids = kids.lookup(0, PDFDict).lookup(PDFName.of('K'), PDFArray);
  assert.equal(figureKids.size(), 1);
  assert.equal(figureKids.lookup(0, PDFDict).get(PDFName.of('Obj')).toString(), annot.toString(), '書き込みの OBJR だけ残る');
  assert.ok(kids.lookup(1, PDFDict).get(PDFName.of('K')), '2 ページ目の OBJR はそのまま');
});
