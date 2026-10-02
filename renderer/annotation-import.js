(function (root) {
  'use strict';

  // ファイルにある注釈のうち自前で描くものを集める層（spec-4-1 確定事項17・18、spec-4-2 確定事項13、
  // spec-4-3 確定事項13、spec-4-4 確定事項20、spec-4b-1a 確定事項25〜30）。
  //
  // pdf.js の getAnnotations() を全ページから集め、1 件ずつ imported-entry.js で自前の形にする。pdf.js が返さない
  // 欄（不透明度など）は、注釈の辞書を直に読む口（annotation-details.js）に 1 回だけ頼んで当てる。そのあとで、
  // 表示のみでないものに pdf.js には描かせない印（annotationStorage の noView。事前調査 B ①）を付けて映す。
  // 口を待つ間は pdf.js が描いたままで、一覧には出ず、選べない（確定事項28）。
  //
  // 集め終えたとき、その文書が別のタブへ退避していても結果は捨てず、そのタブへ届ける（確定事項29）。閉じられた
  // 文書のものだけを捨てる。集めたものは編集ではないので履歴には入らない。

  // 走っている読み込み（settled が待つ）。
  const running = new Set();

  function details() {
    return root.SigK.annotationDetails;
  }

  // 全ページから集める。views はページ番号（0 始まり）→ pdf.js の page.view（[x1 y1 x2 y2]。CropBox）。途中で文書が閉じられたら null。
  async function collect(doc, isAlive) {
    const imported = {};
    const views = {};
    for (let number = 1; number <= doc.numPages; number += 1) {
      let annotations;
      try {
        const page = await doc.getPage(number);
        views[number - 1] = page.view;
        annotations = typeof page.getAnnotations === 'function' ? await page.getAnnotations() : [];
      } catch {
        annotations = [];
      }
      if (!isAlive())
        return null;
      const entries = annotations.map((annotation) => root.SigK.importedEntry.importedEntry(annotation, number - 1)).filter((entry) => entry !== null);
      if (entries.length > 0)
        imported[number - 1] = entries;
    }
    return { imported, views };
  }

  // 文字の向き（置いたときの表示の回転）に沿った紙の長さ（pt。spec-4b-4a 確定事項C2）。分からなければ null。
  function lengthOf(view, rotation) {
    if (!Array.isArray(view) || view.length !== 4 || !view.every(Number.isFinite))
      return null;
    return rotation % 180 === 0 ? Math.abs(view[2] - view[0]) : Math.abs(view[3] - view[1]);
  }

  // 自前のテキストの読み戻しに渡す、字の送り幅と紙の長さ（spec-4b-4a 確定事項J3）。
  function textMeasureOf(views) {
    return {
      advanceOf: (unit, bold) => root.SigK.freeTextShape.advanceOf(root.document, unit, bold),
      pageLengthOf: (src, rotation) => lengthOf(views[src], rotation),
    };
  }

  function hasOwnText(imported) {
    return Object.values(imported).some((entries) => entries.some((entry) => entry.kind === 'text' && entry.readonly !== true));
  }

  // 口の答えを全部に当てる。answered は口が答えたか（答えなければ四角・丸と自前のテキストは表示のみ。spec-4b-2 確定事項36、
  // spec-4b-4a 確定事項J4）。
  function applyAll(imported, answers, answered, text) {
    const applied = {};
    for (const [page, entries] of Object.entries(imported))
      applied[page] = entries.map((entry) => details().applyDetails(entry, answers[entry.ref], { answered, text }));
    return applied;
  }

  // 表示のみでないものは自前で描くので、pdf.js には描かせない（事前調査 B ①）。
  function markNoView(doc, imported) {
    for (const entries of Object.values(imported)) {
      for (const entry of entries) {
        if (entry.readonly !== true)
          doc.annotationStorage?.setValue?.(entry.ref, { noView: true });
      }
    }
  }

  async function run(doc, file, isAlive) {
    if (doc === null || doc === undefined || typeof doc.getPage !== 'function')
      return null;
    const collected = await collect(doc, isAlive);
    if (collected === null)
      return null;
    const { imported, views } = collected;
    const refs = details().refsOf(imported);
    const answer = refs.length === 0 ? null : await details().requestDetails(file, refs);
    // 自前のテキストがあれば画面のフォントを先読みする（spec-4-2 確定事項33）。新しい形の幅を見分けるのに字を測るので、
    // 当てる前に待つ（spec-4b-4a 確定事項J3）。
    if (hasOwnText(imported))
      await root.SigK.freeTextShape?.ensureLoaded(root.document);
    if (!isAlive())
      return null;
    // 答えが無くても当てる（線も塗りも無いもの、口が答えなかった四角・丸と自前のテキストを表示のみにそろえる。spec-4b-1b 確定事項36、
    // spec-4b-2 確定事項36、spec-4b-4a 確定事項J4）。
    const answered = answer?.ok === true;
    const applied = applyAll(imported, answered ? answer.details : {}, answered, textMeasureOf(views));
    markNoView(doc, applied);
    root.SigK.viewer?.deliverImported(doc, applied, { rerender: Object.keys(applied).map(Number) });
    return applied;
  }

  // 文書の注釈を集めて映す。file は開いたファイルの控え（{ path, size, mtimeMs }。口に渡す）、isAlive は文書が
  // まだどこかで開かれているか（表示中か退避しているタブ）。1,000 ページで 0.1 秒（spec-4-1 事前調査 A）に、
  // 口の数百 ms が足される。
  async function importDocument(doc, { file = null, isAlive = () => true } = {}) {
    const job = run(doc, file, isAlive);
    running.add(job);
    try {
      return await job;
    } finally {
      running.delete(job);
    }
  }

  // 走っている読み込みが全部終わるのを待つ（起動確認とテスト。確定事項30）。
  function settled() {
    return Promise.all([...running]).then(() => true, () => true);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationImport = { importDocument, settled };
})(typeof window !== 'undefined' ? window : globalThis);
