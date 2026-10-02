'use strict';

// FreeText の辞書の欄を組む純粋層（spec-4-2 確定事項25、spec-4b-4a 確定事項I5・I6）。annotation-fields.js から移した。
// pdf-lib のクラスは tools で受け、外観（content stream）と /DA・/DS の文字列は free-text-appearance.js・free-text-wrapped.js が組む。
//
//   /Contents … 本文
//   /DA       … 既定の外観（他のビューアが文字を直すときに使う）
//   /DS       … 既定の文字の書式（新しい形だけ。大きさ・太字・斜体・文字の色）
//   /BS       … 枠線の太さ。枠線が無ければ /W 0 を書く（BS も Border も無いと、外観を作り直すビューアは 1pt の枠を描く。表166）
//   /Rotate   … 置いたときの表示の回転（規格外。pdf.js の FreeText エディタと同じ）
// /C は書かない（箱の背景色に使うビューアがある。塗りを持つまで）。/RC と /IC も書かない。

function freeTextFields(entry, appearance, { PDFString, PDFHexString }) {
  const fields = {
    Contents: PDFHexString.fromText(entry.text),
    DA: PDFString.of(appearance.da),
    Border: [0, 0, 0],
    BS: { W: 0, S: 'S' },
  };
  if (typeof appearance.ds === 'string')
    fields.DS = PDFString.of(appearance.ds);
  if (entry.rotation !== 0)
    fields.Rotate = entry.rotation;
  return fields;
}

module.exports = { freeTextFields };
