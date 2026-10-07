'use strict';

// モザイクの保存の検体（spec-4b-6b 事前調査 I・確定事項20〜22）。1 ページ目にだけ「消したい文字」を、2 ページ目に「残すべき文字」を置き、
// 元の文字が残り得る所（ページの /Thumb・/PieceInfo・/Metadata、構造ツリーの /ActualText・/Alt、1 ページ目だけのフォーム XObject）と、
// 2 ページで共有するもの（フォント・画像・フォーム XObject）、1 ページ目の書き込み（外観つきの FreeText）、/Rotate・/CropBox を持たせる。
// scan() は保存したバイト列の流れ（ObjStm も）を全部ほどいて、文字列が何回出るかを数える（素の字と 16 進の両方）。

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { PDFDocument, PDFName, PDFDict, PDFNumber, PDFString, StandardFonts } = require('pdf-lib');

const SECRETS = Object.freeze(['SECRET-ONE', 'THUMBSECRET', 'PIECESECRET', 'PAGEXMPSECRET', 'ACTUALSECRET', 'ALTSECRET', 'FORMSECRET', 'PARENTSECRET']);
const KEEPS = Object.freeze(['KEEP-TWO', 'KEEPACTUAL', 'ANNOTKEEP', 'SHAREDFORM', 'PARENTKEEP']);
const PNG = path.join(__dirname, 'image-small.png');

function hex(text) {
  return Buffer.from(text, 'latin1').toString('hex');
}

function scan(bytes, words) {
  const text = Buffer.from(bytes).toString('latin1');
  const bodies = [text];
  const re = /stream\r?\n/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endstream', start);
    try {
      bodies.push(zlib.inflateSync(Buffer.from(text.slice(start, end), 'latin1')).toString('latin1'));
    } catch {
      // 圧縮していない流れは text に入っている。
    }
  }
  const counts = {};
  for (const word of words) {
    counts[word] = 0;
    for (const body of bodies) {
      for (const needle of [word, hex(word), hex(word).toUpperCase()])
        counts[word] += body.split(needle).length - 1;
    }
  }
  return counts;
}

function addForm(ctx, page, name, ref) {
  page.node.Resources().lookup(PDFName.of('XObject'), PDFDict).set(PDFName.of(name), ref);
}

// 構造ツリー: 1 ページ目の段落（ActualText）と図（Alt）、2 ページ目の段落（ActualText）、両ページにまたがる節（1 ページ目の /Pg で
// ActualText を持ち、子に 2 ページ目の段落）。
function addStructTree(doc, p1, p2) {
  const ctx = doc.context;
  const root = ctx.nextRef();
  const section = ctx.nextRef();
  const e1 = ctx.register(ctx.obj({ Type: 'StructElem', S: 'P', P: section, Pg: p1.ref, K: 0, ActualText: PDFString.of('ACTUALSECRET') }));
  const figure = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Figure', P: section, Pg: p1.ref, K: { Type: 'MCR', Pg: p1.ref, MCID: 1 }, Alt: PDFString.of('ALTSECRET') }));
  const e2 = ctx.register(ctx.obj({ Type: 'StructElem', S: 'P', P: section, Pg: p2.ref, K: 0, ActualText: PDFString.of('KEEPACTUAL') }));
  ctx.assign(section, ctx.obj({ Type: 'StructElem', S: 'Sect', P: root, Pg: p1.ref, K: [e1, figure, e2], ActualText: PDFString.of('PARENTSECRET'), T: PDFString.of('PARENTKEEP') }));
  ctx.assign(root, ctx.obj({ Type: 'StructTreeRoot', K: [section], ParentTree: { Kids: [ctx.obj({ Nums: [0, [e1, figure], 1, [e2]], Limits: [0, 1] })] }, ParentTreeNextKey: 2 }));
  doc.catalog.set(PDFName.of('StructTreeRoot'), root);
  doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
  p1.node.set(PDFName.of('StructParents'), PDFNumber.of(0));
  p2.node.set(PDFName.of('StructParents'), PDFNumber.of(1));
  return { root, section, e1, figure, e2 };
}

async function buildMosaicSample() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(fs.readFileSync(PNG));
  const p1 = doc.addPage([595, 842]);
  const p2 = doc.addPage([595, 842]);
  p1.drawText('SECRET-ONE', { x: 72, y: 700, size: 24, font });
  p2.drawText('KEEP-TWO', { x: 72, y: 700, size: 24, font });
  p1.drawImage(png, { x: 72, y: 400, width: 100, height: 100 });
  p2.drawImage(png, { x: 72, y: 400, width: 100, height: 100 });
  const formOnly = ctx.register(ctx.flateStream('BT /F1 12 Tf 72 300 Td (FORMSECRET) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 595, 842], Resources: { Font: { F1: font.ref } } }));
  const formShared = ctx.register(ctx.flateStream('BT /F1 12 Tf 72 250 Td (SHAREDFORM) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 595, 842], Resources: { Font: { F1: font.ref } } }));
  addForm(ctx, p1, 'FxA', formOnly);
  addForm(ctx, p1, 'FxB', formShared);
  addForm(ctx, p2, 'FxB', formShared);
  p1.node.addContentStream(ctx.register(ctx.flateStream('q /FxA Do /FxB Do Q')));
  p2.node.addContentStream(ctx.register(ctx.flateStream('q /FxB Do Q')));
  p1.node.set(PDFName.of('Thumb'), ctx.register(ctx.stream('THUMBSECRET', { Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 })));
  p1.node.set(PDFName.of('PieceInfo'), ctx.obj({ App: { Private: PDFString.of('PIECESECRET'), LastModified: PDFString.of('D:2026') } }));
  p1.node.set(PDFName.of('Metadata'), ctx.register(ctx.stream('<x:xmpmeta>PAGEXMPSECRET</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })));
  p1.setRotation({ type: 'degrees', angle: 90 });
  p1.node.set(PDFName.of('CropBox'), ctx.obj([10, 20, 500, 800]));
  addStructTree(doc, p1, p2);
  const ap = ctx.register(ctx.flateStream('BT /F1 12 Tf 2 2 Td (ANNOTKEEP) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 120, 20], Resources: { Font: { F1: font.ref } } }));
  const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [72, 600, 192, 620], Contents: PDFString.of('ANNOTKEEP'), DA: PDFString.of('/Helv 12 Tf 0 g'), AP: { N: ap } }));
  p1.node.set(PDFName.of('Annots'), ctx.obj([annot]));
  return doc.save();
}

function pngBytes() {
  return new Uint8Array(fs.readFileSync(PNG));
}

module.exports = { SECRETS, KEEPS, scan, buildMosaicSample, pngBytes };
