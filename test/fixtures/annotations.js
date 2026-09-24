'use strict';

// 他のツールが付けた注釈を載せた検体（spec-4-4 完了判定5・7）。three-pages.pdf から作る。
//
//   1 ページ目: /AP の無いノート（/Text。他のツールの付箋の多くはこの形で、塊③まで本アプリでは
//              見えていなかった）・/Popup・他のツールの直線（/Line）・他のツールのテキスト
//              （/DA が Helv の FreeText）・/AP 付きのスタンプ・リンク
//   2 ページ目: /AP 付きのノート（自前と同じ形）
// 一覧に「表示のみ」として並ぶもの（Line・FreeText・Stamp）と、拾って直せるもの（Text）を
// 1 つの文書で確かめられる。リンクは一覧に出ない側の検体。

const { PDFDocument, PDFName, PDFString, PDFHexString } = require('pdf-lib');

function annotsOf(doc, page) {
  const ctx = doc.context;
  let annots = ctx.lookup(page.node.get(PDFName.of('Annots')));
  if (annots === undefined) {
    annots = ctx.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
  }
  return annots;
}

function addAnnot(doc, page, fields, appearance = null) {
  const ctx = doc.context;
  const dict = { Type: 'Annot', ...fields, P: page.ref, M: PDFString.of("D:20260918090000+09'00'") };
  if (appearance !== null) {
    dict.AP = {
      N: ctx.register(ctx.stream(appearance.content, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: appearance.bbox })),
    };
  }
  const ref = ctx.register(ctx.obj(dict));
  annotsOf(doc, page).push(ref);
  return ref;
}

function addNote(doc, page, { rect, contents, author, color, withAp }) {
  const appearance = withAp
    ? { content: `${color.join(' ')} rg 0.2 0.2 0.2 RG 1 w ${rect[0] + 1} ${rect[1] + 1} 18 18 re B`, bbox: rect }
    : null;
  const noteRef = addAnnot(doc, page, {
    Subtype: 'Text', Rect: rect, Contents: PDFHexString.fromText(contents), T: PDFHexString.fromText(author), C: color, CA: 1, F: 28, Name: 'Comment',
  }, appearance);
  const ctx = doc.context;
  const popupRef = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [rect[2] + 2, rect[3] - 100, rect[2] + 182, rect[3]], Parent: noteRef, Open: false, F: 28, P: page.ref }));
  ctx.lookup(noteRef).set(PDFName.of('Popup'), popupRef);
  annotsOf(doc, page).push(popupRef);
  return noteRef;
}

async function buildAnnotatedPdf(threePagesBytes) {
  const doc = await PDFDocument.load(threePagesBytes, { updateMetadata: false });
  doc.setTitle('他のツールの注釈を載せた3ページ');
  const [page1, page2] = doc.getPages();
  addNote(doc, page1, { rect: [60, 700, 80, 720], contents: '他のツールのノート\n2行目', author: 'other', color: [1, 0, 0], withAp: false });
  addAnnot(doc, page1, { Subtype: 'Line', Rect: [300, 700, 500, 760], L: [300, 700, 500, 760], C: [1, 0, 0], BS: { W: 2, S: 'S' }, Contents: PDFString.of('other line') });
  addAnnot(doc, page1, { Subtype: 'FreeText', Rect: [300, 640, 500, 670], DA: PDFString.of('/Helv 12 Tf 0 0 1 rg'), Contents: PDFHexString.fromText('Other tool text'), C: [1, 1, 0.8] });
  addAnnot(doc, page1, { Subtype: 'Stamp', Rect: [300, 340, 420, 380], Name: 'Draft', C: [1, 0, 0] },
    { content: '1 0 0 RG 2 w 302 342 116 36 re S', bbox: [300, 340, 420, 380] });
  addAnnot(doc, page1, { Subtype: 'Link', Rect: [300, 300, 420, 320], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of('https://example.invalid/') } });
  addNote(doc, page2, { rect: [100, 100, 120, 120], contents: 'p2 のノート', author: 'SigK', color: [0.55, 0.9, 0.6], withAp: true });
  return doc.save({ addDefaultPage: false, useObjectStreams: false });
}

// 本アプリで付けた注釈を載せた検体（spec-4-5 確定事項49。フラット化の起動確認の画素差）。
// three-pages.pdf の 1 ページ目に、保存と同じ経路（worker/op-annotate.js）でハイライト・下線・
// テキスト（50%）・矩形（50%）・楕円・矢印・ペン・ノート（75%）を付ける。回転の無いページなので、
// 焼き込み前後を pdf.js で描いた見た目は縁のにじみを除いて同じになるはずである（spec-4-5 事前調査 D）。
async function buildSigkAnnotatedPdf(threePagesBytes) {
  const fontkit = require('@pdf-lib/fontkit');
  const { PDFArray, PDFRef } = require('pdf-lib');
  const { applyAnnotations } = require('../../worker/op-annotate.js');
  const { createFontSource } = require('../../worker/font-embed.js');
  const doc = await PDFDocument.load(threePagesBytes, { updateMetadata: false });
  doc.setTitle('本アプリの注釈を載せた3ページ');
  const add = [
    { src: 0, kind: 'highlight', color: '#ffe45a', opacity: 1, quads: [[48, 790, 140, 790, 48, 774, 140, 774]], rect: [48, 774, 140, 790] },
    { src: 0, kind: 'underline', color: '#2c5cd9', opacity: 1, quads: [[48, 760, 232, 760, 48, 748, 232, 748]], rect: [48, 748, 232, 760] },
    { src: 0, kind: 'text', color: '#d92c2c', opacity: 0.5, rect: [100, 600, 300, 620.5], text: 'テキスト注釈', fontSize: 12, rotation: 0 },
    { src: 0, kind: 'square', color: '#d92c2c', opacity: 0.5, rect: [100, 480, 300, 560], lineWidth: 3 },
    { src: 0, kind: 'circle', color: '#2f9e5a', opacity: 1, rect: [340, 480, 500, 560], lineWidth: 2 },
    { src: 0, kind: 'arrow', color: '#2c5cd9', opacity: 1, rect: [98.5, 243.55, 301.5, 301.5], lineWidth: 3, paths: [[[100, 300], [300, 250]]] },
    { src: 0, kind: 'ink', color: '#1c2430', opacity: 1, rect: [319, 249, 401, 301], lineWidth: 2, paths: [[[320, 260], [350, 290], [390, 255]]] },
    { src: 0, kind: 'note', color: '#ffe45a', opacity: 0.75, rect: [520, 780, 540, 800], text: 'メモ', author: '総務' },
  ];
  const tools = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
  const result = await applyAnnotations(doc, { add }, tools, { fontSource: createFontSource({ fontkit }) });
  if (result.ok !== true)
    throw new Error(result.error);
  return doc.save({ addDefaultPage: false, useObjectStreams: false });
}

module.exports = { buildAnnotatedPdf, buildSigkAnnotatedPdf };
