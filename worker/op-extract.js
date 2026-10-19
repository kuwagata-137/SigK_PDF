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

const { normalizeRotation, isInsert } = require('./op-pages.js');
const { applyCrop } = require('./page-box-rules.js');

// 取り出す plan がこの文書に当てられる形かを見る。inserted は差し込んだページの実体（insert 番号で引く。写し〔spec-2-5 I5〕のときだけ渡る）。
function validateSelection(plan, pageCount, inserted = []) {
  if (!Array.isArray(plan) || plan.length === 0)
    return { error: '抽出するページが選ばれていません。' };

  for (const entry of plan) {
    if (isInsert(entry) && inserted[entry.insert] !== undefined)
      continue;
    const src = entry?.src;
    if (!Number.isInteger(src) || src < 0 || src >= pageCount)
      return { error: 'ページの指定が元の文書と合わないので、もう一度開き直してください。' };
  }
  return { ok: true };
}

// plan の並びで新しい文書を組み立てる。source は変更しない。PDFName を渡せば、plan の crop を /CropBox に当てる
// （spec-4b-6a 確定事項23。copyPages は受け継いだ箱をページへ写してから複製する）。
//
// inserted を渡せば、plan の { insert } も複製する（帯のページの写し。spec-2-5 確定事項I5）。差し込んだページはページ木に無い実体なので、
// 複製のあいだだけ source の末尾に足して番号で引き、終わったら外す（source のページ数は変えない）。
async function extractPages(source, plan, { PDFDocument, PDFName, inserted = [] }) {
  const pageCount = source.getPageCount();
  const check = validateSelection(plan, pageCount, inserted);
  if (check.ok !== true)
    return check;

  const indices = plan.map((entry) => {
    if (!isInsert(entry))
      return entry.src;
    source.addPage(inserted[entry.insert]);
    return source.getPageCount() - 1;
  });
  const doc = await PDFDocument.create();
  let copied;
  try {
    copied = await doc.copyPages(source, indices);
  } finally {
    while (source.getPageCount() > pageCount)
      source.removePage(source.getPageCount() - 1);
  }

  const angles = copied.map((page, index) =>
    normalizeRotation(page.getRotation().angle + normalizeRotation(plan[index]?.rotate)));

  copied.forEach((page, index) => {
    page.setRotation({ type: 'degrees', angle: angles[index] });
    doc.addPage(page);
  });

  for (const [index, entry] of plan.entries()) {
    if (entry?.crop === undefined)
      continue;
    const cropped = PDFName === undefined ? { error: 'ページの切り方を保存できません。' } : applyCrop(copied[index], entry.crop, { PDFName });
    if (cropped.ok !== true)
      return cropped;
  }

  return { ok: true, doc, pages: plan.length, angles };
}

module.exports = { validateSelection, extractPages };
