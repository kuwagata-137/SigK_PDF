'use strict';

// 選んだページだけを別のファイルへ取り出す層（spec-1-6 確定事項47〜52）。
//
// 保存（op-pages.js）が removePage + insertPage で元の構造を保つのに対し、
// こちらは**新規文書へ copyPages する**。別ファイルとして書き出す以上、元文書の
// catalog を引き継ぐ道は無いためである。その代償として **しおり・AcroForm・
// 名前付き宛先は必ず消える**（実測）。取り返しはつく（元ファイルを変えない）ので、
// 画面側の確認ダイアログで明記したうえで進める（確定事項48）。
//
// 【実測でわかったこと】
//   ・`copyPages` は `/Rotate` を運ぶ。ページ木の親から**継承している場合も**
//     引き継がれる（pdf-lib が複製の前に継承属性を葉へ降ろすため）。
//     よって plan の相対角度は、複製したページの角度に**足す**。
//   ・同じ index を2回渡しても、複製されたページは**別の実体**になる。
//     op-pages.js が src の重複を弾くのは in-place で同じページ実体を2か所へ
//     挿すからであり、こちらにその制約は無い。

const { normalizeRotation } = require('./op-pages.js');

// 取り出す plan がこの文書に当てられる形かを見る。
function validateSelection(plan, pageCount) {
  if (!Array.isArray(plan) || plan.length === 0)
    return { error: '抽出するページが選ばれていません。' };

  for (const entry of plan) {
    const src = entry?.src;
    if (!Number.isInteger(src) || src < 0 || src >= pageCount)
      return { error: 'ページの指定が元の文書と合いません。もう一度開き直してください。' };
  }
  return { ok: true };
}

// plan の並びで新しい文書を組み立てる。source は変更しない。
async function extractPages(source, plan, { PDFDocument }) {
  const pageCount = source.getPageCount();
  const check = validateSelection(plan, pageCount);
  if (check.ok !== true)
    return check;

  const doc = await PDFDocument.create();
  const copied = await doc.copyPages(source, plan.map((entry) => entry.src));

  const angles = copied.map((page, index) =>
    normalizeRotation(page.getRotation().angle + normalizeRotation(plan[index]?.rotate)));

  copied.forEach((page, index) => {
    page.setRotation({ type: 'degrees', angle: angles[index] });
    doc.addPage(page);
  });

  return { ok: true, doc, pages: plan.length, angles };
}

module.exports = { validateSelection, extractPages };
