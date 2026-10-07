'use strict';

// モザイクの保存で、元の中身が mosaic-sample.js とは違う形で残り得る検体（spec-4b-6b 確定事項21・22。コードの点検で見つかった形）。
// どれも 2 ページで、1 ページ目にモザイクを入れる。SECRET の付く語は 1 ページ目だけが描く（保存後に 0 回であるべき）、KEEP の付く語は
// 2 ページ目か書き込みが使う（残るべき）。
//   shared     … 2 ページが 1 つの /Resources（間接）を共有し、1 ページ目だけが描くフォームがその中にある
//   inherited  … /Resources を /Pages に置き、2 ページとも受け継ぐ
//   listed     … 2 ページ目の /Resources が、使わない 1 ページ目のフォームを名前だけ並べる
//   borrowing  … 2 ページ目のフォームが自分の /Resources を持たず、ページのフォントを使う（絞りすぎないことを見る）
//   appearance … 1 ページ目の書き込みの外観の /Resources が、ページの /Resources と同じ物
//   pageKeys   … 1 ページ目の /AF（関連ファイル）と /AA（ページを開いたときの動作）

const { PDFDocument, PDFName, PDFString, StandardFonts } = require('pdf-lib');

function form(ctx, font, text, { resources = true } = {}) {
  const dict = { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 595, 842] };
  if (resources)
    dict.Resources = { Font: { F1: font.ref } };
  return ctx.register(ctx.flateStream(`BT /F1 12 Tf 72 300 Td (${text}) Tj ET`, dict));
}

async function base() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595, 842]);
  const p2 = doc.addPage([595, 842]);
  return { doc, ctx: doc.context, font, p1, p2 };
}

function draw(ctx, page, content) {
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
}

const builders = {
  async shared() {
    const { doc, ctx, font, p1, p2 } = await base();
    const res = ctx.register(ctx.obj({ Font: { F1: font.ref }, XObject: { FxA: form(ctx, font, 'FORMSECRET'), FxC: form(ctx, font, 'P2KEEP') } }));
    p1.node.set(PDFName.of('Resources'), res);
    p2.node.set(PDFName.of('Resources'), res);
    draw(ctx, p1, 'q /FxA Do Q');
    draw(ctx, p2, 'q /FxC Do Q');
    return doc.save();
  },

  async inherited() {
    const { doc, ctx, font, p1, p2 } = await base();
    p1.node.delete(PDFName.of('Resources'));
    p2.node.delete(PDFName.of('Resources'));
    doc.catalog.Pages().set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref }, XObject: { FxA: form(ctx, font, 'FORMSECRET'), FxC: form(ctx, font, 'P2KEEP') } }));
    draw(ctx, p1, 'q /FxA Do Q');
    draw(ctx, p2, 'q /FxC Do Q');
    return doc.save();
  },

  async listed() {
    const { doc, ctx, font, p1, p2 } = await base();
    const secret = form(ctx, font, 'FORMSECRET');
    p1.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { FxA: secret } }));
    p2.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { FxA: secret, FxC: form(ctx, font, 'P2KEEP') } }));
    draw(ctx, p1, 'q /FxA Do Q');
    draw(ctx, p2, 'q /FxC Do Q');
    return doc.save();
  },

  async borrowing() {
    const { doc, ctx, font, p1, p2 } = await base();
    p1.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref } }));
    // 名前に # の書き方（#2D は -）を使い、/Contents を 2 本の流れに分ける。
    p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref }, XObject: { 'Fx-B': form(ctx, font, 'BORROWKEEP', { resources: false }) } }));
    draw(ctx, p1, 'BT /F1 12 Tf 72 700 Td (PAGESECRET) Tj ET');
    p2.node.set(PDFName.of('Contents'), ctx.obj([ctx.register(ctx.flateStream('q')), ctx.register(ctx.flateStream('/Fx#2DB Do Q'))]));
    return doc.save();
  },

  async appearance() {
    const { doc, ctx, font, p1 } = await base();
    const res = ctx.register(ctx.obj({ Font: { F1: font.ref }, XObject: { FxA: form(ctx, font, 'FORMSECRET') } }));
    p1.node.set(PDFName.of('Resources'), res);
    draw(ctx, p1, 'q /FxA Do Q');
    const ap = ctx.register(ctx.flateStream('BT /F1 12 Tf 2 2 Td (ANNOTKEEP) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 120, 20], Resources: res }));
    const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [72, 600, 192, 620], P: p1.ref, DA: PDFString.of('/Helv 12 Tf 0 g'), AP: { N: ap } }));
    p1.node.set(PDFName.of('Annots'), ctx.obj([annot]));
    return doc.save();
  },

  async pageKeys() {
    const { doc, ctx, p1 } = await base();
    const file = ctx.register(ctx.flateStream('AFSECRET', { Type: 'EmbeddedFile' }));
    p1.node.set(PDFName.of('AF'), ctx.obj([{ Type: 'Filespec', F: PDFString.of('src.txt'), AFRelationship: 'Source', EF: { F: file } }]));
    p1.node.set(PDFName.of('AA'), ctx.obj({ O: { S: 'JavaScript', JS: PDFString.of('app.alert("AASECRET")') } }));
    return doc.save();
  },
};

module.exports = { builders };
