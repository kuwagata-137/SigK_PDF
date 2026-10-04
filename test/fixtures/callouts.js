'use strict';

// 他のアプリの吹き出しと回した FreeText を載せた検体（spec-4b-4b 確定事項I4・完了の判定9）。他のアプリの書き方は合成で作る
// （製品名は書かない）。どちらも SigK の書体名ではない /DA なので、読み込んでも表示のみのまま、pdf.js が外観どおりに描く。
//
//   1 ページ目: OC 線と矢印のしっぽの吹き出し（/IT /FreeTextCallout・/CL 6 つの数・/LE /OpenArrow・/RD・/BS 1pt。外観は
//              四角の枠・線・矢じり・文字）、OR /Matrix で 30° 回した FreeText（/BBox は箱、/Rect は回した外接）
// 2・3 ページ目は three-pages.pdf のまま。

const { PDFDocument, PDFName, PDFString } = require('pdf-lib');

const r4 = (value) => {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

// 箱の中心まわりに、画面で時計回りに angle 度。
function turnMatrix(box, angle) {
  const t = (angle * Math.PI) / 180;
  const cos = r4(Math.cos(t));
  const sin = r4(Math.sin(t));
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  return [cos, r4(-sin), sin, cos, r4(cx - (cos * cx + sin * cy)), r4(cy - (-sin * cx + cos * cy))];
}

function outerOf(box, matrix) {
  const corners = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]]
    .map(([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((value) => Math.round(value * 100) / 100);
}

async function buildCalloutsPdf(base) {
  const doc = await PDFDocument.load(base);
  const context = doc.context;
  const page = doc.getPages()[0];
  const font = context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' });
  const fontRef = context.register(font);
  const form = (content, bbox, extra = {}) => context.register(context.stream(content, {
    Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: { Font: { Helv: fontRef } }, ...extra,
  }));

  // OC: 線と矢印のしっぽ。箱 [200 600 320 640]、先 (120, 520)、膝 (160, 560)、線の端 (200, 620)。
  const calloutRect = [110, 510, 320, 640];
  const calloutAp = form([
    '0.8 0 0 RG 1 w',
    '200.5 600.5 119 39 re S',
    '200 620 m 160 560 l 120 520 l S',
    '120 520 m 126 531 l S 120 520 m 131 526 l S',
    'BT /Helv 12 Tf 0 0 0 rg 206 615 Td (Other callout) Tj ET',
  ].join('\n'), calloutRect);
  const callout = context.obj({
    Type: 'Annot', Subtype: 'FreeText', Rect: calloutRect, Contents: PDFString.of('Other callout'),
    DA: PDFString.of('/Helv 12 Tf 0.8 0 0 rg'), IT: 'FreeTextCallout', CL: [120, 520, 160, 560, 200, 620], LE: 'OpenArrow',
    RD: [90, 90, 0, 0], BS: { W: 1, S: 'S' }, F: 4, NM: PDFString.of('other-callout'), AP: { N: calloutAp },
  });

  // OR: /Matrix で 30° 回した FreeText。
  const box = [300, 400, 440, 430];
  const matrix = turnMatrix(box, 30);
  const turnedAp = form('0 0 0.8 RG 1 w 300.5 400.5 139 29 re S\nBT /Helv 12 Tf 0 0 0 rg 306 410 Td (Turned text) Tj ET', box, { Matrix: matrix });
  const turned = context.obj({
    Type: 'Annot', Subtype: 'FreeText', Rect: outerOf(box, matrix), Contents: PDFString.of('Turned text'),
    DA: PDFString.of('/Helv 12 Tf 0 0 0 rg'), F: 4, NM: PDFString.of('other-turned'), AP: { N: turnedAp },
  });

  page.node.set(PDFName.of('Annots'), context.obj([context.register(callout), context.register(turned)]));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

module.exports = { buildCalloutsPdf };
