'use strict';

// 1つの文書を複数へ写す層（spec-2-2 確定事項33〜35）。
//
// 結合（op-merge.js）の裏返しで、part ごとに **新規文書へ copyPages する**。
// `/Rotate` は copyPages が運ぶので触らない。入力欄の抜け殻と内部リンクは
// cleanInsertedPage で落とす（結合と同じ）。しおりは新しい文書へ来ない。
//
// ページラベルは元文書から1回読み、part に入るページのぶんを writeLabels で
// 書く。元が持たなければ書かない（結合の確定事項30 と同じ規則）。
//
// 組み立てた文書は onPart(index, doc) へ渡して呼ぶ側が save / write する。
// 配列に溜めないのは、500本ぶんの文書を抱えないためである。onPart が
// { error } を返したらそこで止め、何本書けたかを添えて返す（確定事項26）。

const { readLabels, writeLabels } = require('./op-page-labels.js');
const { cleanInsertedPage } = require('./op-insert.js');

function validateParts(parts, pageCount) {
  if (!Array.isArray(parts) || parts.length === 0)
    return { error: '分割するページがありません。' };
  for (const part of parts) {
    if (!Array.isArray(part) || part.length === 0)
      return { error: '分割するページがありません。' };
    for (const page of part) {
      if (!Number.isInteger(page) || page < 0 || page >= pageCount)
        return { error: 'ページの指定がファイルと合いません。もう一度選び直してください。' };
    }
  }
  return { ok: true };
}

async function splitDocument(source, parts, tools, { onPart = async () => ({ ok: true }), onProgress = () => {} } = {}) {
  const { PDFDocument } = tools;
  const check = validateParts(parts, source.getPageCount());
  if (check.ok !== true)
    return check;

  const labels = readLabels(source);
  const pages = [];

  for (const [index, part] of parts.entries()) {
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(source, part);
    copied.forEach((page) => {
      cleanInsertedPage(page, tools);
      doc.addPage(page);
    });
    if (labels !== null)
      writeLabels(doc, part.map((page) => labels[page] ?? ''), tools);

    const handled = await onPart(index, doc);
    if (handled?.error !== undefined)
      return { error: handled.error, written: index };
    pages.push(part.length);
    onProgress(index + 1, parts.length);
  }

  return { ok: true, written: parts.length, pages, labeled: labels !== null };
}

module.exports = { validateParts, splitDocument };
