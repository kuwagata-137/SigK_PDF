'use strict';

// ページの向きと箱の違う検体（spec-4-5 確定事項48。透かしの起動確認）。
//
//   1〜4 ページ目: /Rotate 0・90・180・270（どれも A4 縦の紙）
//   5 ページ目   : CropBox を MediaBox より内側に取ったページ
//   全ページが 1 つの Resources を共有する（透かしの名前が積み上がらないことを見る）
//
// 紙の中身は紙の座標で描くので、表示ではページごとに文字の向きが変わる。透かしは表示の向きで
// 上向きに入るので、画面写真で見比べられる。標準 14 書体は WinAnsi しか扱えないため ASCII に限る。

const { PDFDocument, PDFName, StandardFonts } = require('pdf-lib');

const A4 = { width: 595.28, height: 841.89 };
const CROP = [60, 80, 535, 760];

function contentFor(number, caption) {
  return [
    'BT /F1 96 Tf 250 380 Td', `(${number}) Tj ET`,
    'BT /F1 14 Tf 48 778 Td', `(${caption}) Tj ET`,
    // 紙の上の辺を示す太い線（表示で紙がどちらを向いているかの目印）。
    '0.2 0.4 0.8 RG 6 w 40 820 m 555 820 l S',
  ].join('\n');
}

async function buildPageBoxesPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('向きと箱の違う 5 ページ（Resources を共有）');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const resources = doc.context.register(doc.context.obj({ Font: { F1: font.ref } }));
  const pages = [
    { rotate: 0, caption: 'rotate 0' },
    { rotate: 90, caption: 'rotate 90' },
    { rotate: 180, caption: 'rotate 180' },
    { rotate: 270, caption: 'rotate 270' },
    { rotate: 0, caption: 'cropbox inset', crop: CROP },
  ];
  pages.forEach((spec, index) => {
    const page = doc.addPage([A4.width, A4.height]);
    page.node.set(PDFName.of('Resources'), resources);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(contentFor(index + 1, spec.caption))));
    if (spec.rotate !== 0)
      page.node.set(PDFName.of('Rotate'), doc.context.obj(spec.rotate));
    if (spec.crop !== undefined)
      page.node.set(PDFName.of('CropBox'), doc.context.obj(spec.crop));
  });
  return doc.save({ addDefaultPage: false, useObjectStreams: false });
}

module.exports = { CROP, buildPageBoxesPdf };
