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

module.exports = { buildAnnotatedPdf };
