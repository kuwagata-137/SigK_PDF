'use strict';

// 保存と抽出の apply の段（spec-1-6 確定事項47、spec-4-1 確定事項21・23）。
//
// 200 行に達した pdf-task.js から移した（spec-4b-6b m0。中身は変えていない）。pdf-task.js は同じ名前で書き出し続ける。

const { applyPlan } = require('./op-pages.js');
const { extractPages } = require('./op-extract.js');
const { prepareInserts } = require('./op-insert.js');
const { readLabels, rebuildLabels } = require('./op-page-labels.js');
const { pruneDestinations } = require('./op-outline.js');
const { applyAnnotations } = require('./op-annotate.js');
const { createFontSource } = require('./font-embed.js');
const { applyMosaics, unpaintedSources } = require('./op-mosaic.js');
const { PDFDocument, TOOLS, insertReader } = require('./pdf-io.js');

// テキスト注釈の同梱フォント（spec-4-2 確定事項22・23）。読むのはテキストのある保存の
// 初回だけで、ワーカーは保存ごとに fork される新プロセスなので 1 回きりである。
const fontSource = createFontSource();

// apply の段。開いた文書をその場で並べ替える（上書き・名前を付けて保存）。
//
// ページラベルは applyPlan の**前**に読む。当てたあとでは元の対応が失われる。
// 作り直しは applyPlan の**あと**で、ページ数が合っていないと最後のラベルが
// 引き延ばされる。この前後関係は入れ替えられない。
//
// 注釈も applyPlan の**前**に当てる（spec-4-1 確定事項23）。src は読んだ文書の
// ページ番号であり、並べ替えたあとでは指す先が変わる。当てた注釈はページ実体に
// 付いて一緒に動くので、順序はこれで足りる。
//
// モザイク（spec-4b-6b 確定事項20・21）も applyPlan の前に、ページの中身を画像に差し替える。src が元のページ番号のうちに当てるためで、
// 書き込みとは別のオブジェクトなので、注釈との前後は問わない。mosaics の数を返す（保存の直前に辿れない中身を消すかどうか。pdf-task.js）。
// plan にモザイクがあるのに画像が来ていないページがあれば、何もせずに断る（元の中身のまま書かない）。
const UNPAINTED = 'モザイクを入れたページの画像がそろっていないので、取りやめました。もう一度やり直してください。';

async function applyForSave(doc, pages, inserts, fsLike, annotations, mosaics = []) {
  if (unpaintedSources(pages, mosaics).length > 0)
    return { error: UNPAINTED };
  const labelsBefore = readLabels(doc);
  // 差し込むページを先に組み立てる。
  const prepared = await prepareInserts(doc, doc.getPages(), pages, inserts, TOOLS, insertReader(fsLike));
  if (prepared.ok !== true)
    return prepared;

  const annotated = await applyAnnotations(doc, annotations, TOOLS, { fontSource });
  if (annotated.ok !== true)
    return annotated;
  const mosaicked = await applyMosaics(doc, mosaics, TOOLS);
  if (mosaicked.ok !== true)
    return mosaicked;

  const applied = applyPlan(doc, pages, { inserted: prepared.pages, tools: TOOLS });
  if (applied.ok !== true)
    return applied;
  rebuildLabels(doc, pages, labelsBefore, TOOLS);
  // 削除で飛び先を失ったしおりから /Dest と /A を落とす（見出しは残す）。
  return { ok: true, doc, pages: applied.pages, pruned: pruneDestinations(doc, TOOLS), mosaics: mosaicked.count };
}

// apply の段。新規文書へ複製する（抽出。確定事項47）。
//
// ページラベルは保存と同じ規則で引き継ぐ（確定事項45）。しおりも名前付き宛先も
// 新しい文書へは来ないので、掃除するものが無い。モザイクは、複製する前の元の文書のページを画像に差し替える（spec-4b-6b 確定事項25。
// 決定66 ②）。複製は差し替えたページから辿れるものだけを写すので、古い中身は新しい文書へ来ない。
async function applyForExtract(doc, pages, annotations, mosaics = []) {
  if (unpaintedSources(pages, mosaics).length > 0)
    return { error: UNPAINTED };
  const labelsBefore = readLabels(doc);
  // 注釈を当ててから複製する。抽出先にも付いていく（spec-4-1 確定事項21）。
  const annotated = await applyAnnotations(doc, annotations, TOOLS, { fontSource });
  if (annotated.ok !== true)
    return annotated;
  const mosaicked = await applyMosaics(doc, mosaics, TOOLS);
  if (mosaicked.ok !== true)
    return mosaicked;
  const extracted = await extractPages(doc, pages, { PDFDocument, PDFName: TOOLS.PDFName });
  if (extracted.ok !== true)
    return extracted;
  rebuildLabels(extracted.doc, pages, labelsBefore, TOOLS);
  return { ok: true, doc: extracted.doc, pages: extracted.pages, pruned: { outlines: 0, names: 0 }, mosaics: mosaicked.count };
}

module.exports = { applyForSave, applyForExtract };
