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
    const resources = appearance.resources === undefined ? {} : { Resources: appearance.resources };
    dict.AP = {
      N: ctx.register(ctx.stream(appearance.content, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: appearance.bbox, ...resources })),
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

// 他のアプリが付けた「見た目を持つ」注釈を載せた検体（spec-4b-1a 確定事項24〜26・完了判定8）。three-pages.pdf から作る。
// pdf.js が返さない欄（/CA・/IC・/BE・/RD）と、pdf.js が 1 に置き換える太い線、参照の形の違いを 1 つの文書で確かめる。
//
//   1 ページ目: 不透明度 50% の矩形・楕円・2 点の PolyLine・ノート（直せる。不透明度は読み戻しで知る）、塗りのある矩形、
//              線幅 0 の矩形、破線の矩形、雲形の楕円、/RD の矩形、高さ 12 の箱に 12pt の水平な直線
//              （spec-4b-1a では表示のみ、spec-4b-1b からは塗り・線なし・破線・雲形・/RD を直せる形で読む）
//   2 ページ目: 強さ 2 の雲形の矩形（雲の外観付き）、CMYK で塗った矩形、間隔 [4 2] の破線の直線、線が無く灰で塗った楕円
//              （spec-4b-1b 確定事項36〜39）
//   3 ページ目: 世代 1 の参照の矩形（不透明度 60%）と、/Annots に直に置いた辞書の矩形（読み込まない）
// /RD の矩形の外観は、線を /Rect から /RD を引いた箱の内側に描く（規格の意味。spec-4b-1b 確定事項38）。
// どの外観も辞書の中身（丸・塗り・線幅 0・破線・雲形・不透明度）のとおりに描く。spec-4b-1b から読み込んだものは SigK PDF が
// 辞書から描き直すので、外観が辞書と食い違うと、開いただけで見た目が変わるように見える。雲の外観は SigK PDF の雲形の path を
// 借りる（他のアプリの絵の代わり）。
function strokeBox(rect, rgb, width) {
  const inset = width / 2;
  return { content: `${rgb.join(' ')} RG ${width} w ${rect[0] + inset} ${rect[1] + inset} ${rect[2] - rect[0] - width} ${rect[3] - rect[1] - width} re S`, bbox: rect };
}

// 楕円の path（箱を inset だけ内へ寄せ、右端から反時計回りのベジェ 4 本）。
function ellipsePath([x1, y1, x2, y2], inset) {
  const k = 0.5523;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = (x2 - x1) / 2 - inset;
  const ry = (y2 - y1) / 2 - inset;
  const n = (value) => Math.round(value * 100) / 100;
  const curve = (...values) => `${values.map(n).join(' ')} c`;
  return [`${n(cx + rx)} ${n(cy)} m`,
    curve(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry),
    curve(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy),
    curve(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry),
    curve(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy), 'h'].join(' ');
}

// 半透明の外観（pdf.js は外観があれば /CA を当てないので、外観の中で薄める）。
const HALF = { ExtGState: { GS0: { CA: 0.5, ca: 0.5 } } };

async function buildStyledPdf(threePagesBytes) {
  const { PDFRef } = require('pdf-lib');
  const { cloudPathOf } = require('../../worker/cloud-appearance.js');
  const doc = await PDFDocument.load(threePagesBytes, { updateMetadata: false });
  doc.setTitle('他のアプリの見た目を持つ注釈を載せた3ページ');
  const [page1, page2, page3] = doc.getPages();
  const box = (rect, fields, rgb = [1, 0, 0], width = 2, appearance = null) => addAnnot(doc, page1, { Rect: rect, C: rgb, BS: { W: width, S: 'S' }, ...fields },
    appearance === null ? strokeBox(rect, rgb, width || 1) : { bbox: rect, ...appearance });
  box([60, 700, 200, 780], { Subtype: 'Square', CA: 0.5 }, [1, 0, 0], 2, { content: `/GS0 gs ${strokeBox([60, 700, 200, 780], [1, 0, 0], 2).content}`, resources: HALF });
  box([220, 700, 360, 780], { Subtype: 'Circle', CA: 0.5 }, [0, 0, 1], 2, { content: `/GS0 gs 0 0 1 RG 2 w ${ellipsePath([220, 700, 360, 780], 1)} S`, resources: HALF });
  box([380, 700, 520, 780], { Subtype: 'PolyLine', CA: 0.5, Vertices: [380, 710, 520, 770] }, [0, 0.5, 0], 2,
    { content: '/GS0 gs 0 0.5 0 RG 2 w 1 J 380 710 m 520 770 l S', resources: HALF });
  addNote(doc, page1, { rect: [540, 760, 560, 780], contents: '半透明のノート', author: 'other', color: [1, 1, 0], withAp: true });
  box([60, 580, 200, 660], { Subtype: 'Square', IC: [1, 1, 0] }, [1, 0, 0], 2, { content: '1 0 0 RG 1 1 0 rg 2 w 61 581 138 78 re B' });
  box([220, 580, 360, 660], { Subtype: 'Square', IC: [0, 1, 0], BS: { W: 0 } }, [0, 0, 0], 0, { content: '0 1 0 rg 220 580 140 80 re f' });
  box([380, 580, 520, 660], { Subtype: 'Square', BS: { W: 2, S: 'D', D: [3, 2] } }, [0, 0, 1], 2, { content: '0 0 1 RG 2 w [3 2] 0 d 381 581 138 78 re S' });
  const cloudCircle = cloudPathOf({ kind: 'circle', box: [60, 460, 200, 540], intensity: 1, lineWidth: 1 });
  box([60, 460, 200, 540], { Subtype: 'Circle', BE: { S: 'C', I: 1 } }, [1, 0, 0], 1, { content: `1 0 0 RG 1 w 1 j\n${cloudCircle.ops}\nS` });
  addAnnot(doc, page1, { Subtype: 'Square', Rect: [220, 460, 360, 540], C: [1, 0, 0], BS: { W: 1, S: 'S' }, RD: [5, 5, 5, 5] },
    { content: strokeBox([225, 465, 355, 535], [1, 0, 0], 1).content, bbox: [220, 460, 360, 540] });
  box([380, 494, 520, 506], { Subtype: 'PolyLine', Vertices: [380, 500, 520, 500] }, [0, 0, 0], 12);
  // 2 ページ目。
  const cloud = cloudPathOf({ kind: 'square', box: [60, 600, 260, 760], intensity: 2, lineWidth: 2 });
  addAnnot(doc, page2, { Subtype: 'Square', Rect: [60, 600, 260, 760], C: [1, 0, 0], BS: { W: 2, S: 'S' }, BE: { S: 'C', I: 2 }, RD: Array(4).fill(cloud.margin) },
    { content: `1 0 0 RG 2 w 1 j\n${cloud.ops}\nS`, bbox: [60, 600, 260, 760] });
  addAnnot(doc, page2, { Subtype: 'Square', Rect: [300, 600, 440, 700], C: [0, 0, 1], IC: [0, 0, 1, 0], BS: { W: 2, S: 'S' } },
    { content: '0 0 1 RG 1 1 0 rg 2 w 301 601 138 98 re B', bbox: [300, 600, 440, 700] });
  addAnnot(doc, page2, { Subtype: 'PolyLine', Rect: [59, 449, 261, 501], Vertices: [60, 500, 260, 450], C: [0, 0.5, 0], BS: { W: 2, S: 'D', D: [4, 2] } },
    { content: '0 0.5 0 RG 2 w [4 2] 0 d 60 500 m 260 450 l S', bbox: [59, 449, 261, 501] });
  addAnnot(doc, page2, { Subtype: 'Circle', Rect: [300, 450, 440, 550], IC: [0.8], BS: { W: 0 } },
    { content: `0.8 g ${ellipsePath([300, 450, 440, 550], 0)} f`, bbox: [300, 450, 440, 550] });

  // ノートの /CA は addNote が 1 で書くので、半透明に書き換える。
  const note = doc.context.lookup(annotsOf(doc, page1).get(3));
  note.set(PDFName.of('CA'), doc.context.obj(0.5));

  const context = doc.context;
  const gen1 = PDFRef.of(context.nextRef().objectNumber, 1);
  context.assign(gen1, context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [60, 700, 200, 780], C: [0, 0, 1], CA: 0.6, BS: { W: 5, S: 'S' }, P: page3.ref, F: 4 }));
  annotsOf(doc, page3).push(gen1);
  annotsOf(doc, page3).push(context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [220, 700, 360, 780], C: [1, 0, 0], CA: 0.4, BS: { W: 3, S: 'S' }, F: 4 }));
  return doc.save({ addDefaultPage: false, useObjectStreams: false });
}

module.exports = { buildAnnotatedPdf, buildSigkAnnotatedPdf, buildStyledPdf };
