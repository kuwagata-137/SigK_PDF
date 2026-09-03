'use strict';

// 複数の文書を1つへ複製する層（spec-2-1 確定事項29〜34）。
//
// 抽出（op-extract.js）と同じく **新規文書へ copyPages する**。入力ごとに
// load → copyPages（選んだページ）→ 抜け殻の掃除 → addPage を繰り返す。
// `/Rotate` は copyPages が運ぶので触らない（op-extract.js の実測）。
//
// ページラベルは入力ごとに読み、取り込んだページのぶんを連結して書く
// （ユーザー確定④・事前調査 B）。1本でもラベルを持てば書き、持たない入力の
// ページは空ラベルにする。すべて持たなければ書かない。
//
// しおり・入力欄・名前付き宛先は複製に付いてこない（抽出と同じ）。画面側の
// 注記で明記する。同じファイルを2回入れても壊れない（copyPages は呼ぶたびに
// 別の実体を作る。事前調査 A）。
//
// 入力を1本ずつ load して複製し終えたら手放す。すべて同時に抱えると、
// 10MB×2本で RSS 141MB だったものが入力の数だけ積み上がる。

const { readLabels, writeLabels } = require('./op-page-labels.js');
const { cleanInsertedPage } = require('./op-insert.js');

// 選んだページ番号（0 始まり）がその文書に収まっているか。null は全ページ。
function resolvePages(pages, pageCount) {
  if (pages === null || pages === undefined)
    return { pages: Array.from({ length: pageCount }, (_value, index) => index) };
  if (!Array.isArray(pages))
    return { error: 'ページの指定を読み取れません。' };
  for (const page of pages) {
    if (!Number.isInteger(page) || page < 0 || page >= pageCount)
      return { error: 'ページの指定がファイルと合いません。もう一度足し直してください。' };
  }
  return { pages };
}

function withName(name, message) {
  return typeof name === 'string' && name !== '' ? `「${name}」${message}` : message;
}

// entries: [{ name, pages, load }]。load() は入力を PDFDocument として返す。
// 失敗（壊れている・暗号化）は describeLoadFailure で文言にし、ファイル名を添えて
// 全体を止める（確定事項31）。onProgress(done, total) は1本複製し終えるごとに呼ぶ。
async function mergeDocuments(entries, tools, { describeLoadFailure = () => '読めません。', onProgress = () => {} } = {}) {
  const { PDFDocument } = tools;
  if (!Array.isArray(entries) || entries.length === 0)
    return { error: '結合するファイルがありません。' };

  const doc = await PDFDocument.create();
  const labels = [];
  let anyLabels = false;
  let total = 0;

  for (const [index, entry] of entries.entries()) {
    let source;
    try {
      source = await entry.load();
    } catch (error) {
      return { error: withName(entry.name, describeLoadFailure(error)) };
    }

    const selected = resolvePages(entry.pages, source.getPageCount());
    if (selected.error !== undefined)
      return { error: withName(entry.name, selected.error) };

    const sourceLabels = readLabels(source);
    if (sourceLabels !== null)
      anyLabels = true;

    const copied = await doc.copyPages(source, selected.pages);
    copied.forEach((page, at) => {
      cleanInsertedPage(page, tools);
      doc.addPage(page);
      labels.push(sourceLabels?.[selected.pages[at]] ?? '');
    });
    total += copied.length;
    onProgress(index + 1, entries.length);
  }

  if (total === 0)
    return { error: '結合するページがありません。' };
  if (anyLabels)
    writeLabels(doc, labels, tools);
  return { ok: true, doc, pages: total, labeled: anyLabels };
}

module.exports = { resolvePages, mergeDocuments };
