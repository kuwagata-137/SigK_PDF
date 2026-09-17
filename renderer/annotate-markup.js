(function (root) {
  'use strict';

  // 文字の選択からテキストマークアップを作る（spec-4-1 確定事項10〜14）。
  //
  // annotate.js から切り出した（塊②でテキストの操作が加わり 200 行を超えたため）。
  // 選択範囲の四角は markup-selection.js が集め、ここは注釈にして履歴に積む。
  // 道具と色は annotate.js が持つ。

  const state = {
    doc: null,
    win: null,
    // 矩形を測る口。jsdom のテストが差し替える（配置しないので span の位置から作る）。
    rectsOf: (range) => range.getClientRects(),
  };

  function viewer() {
    return root.SigK.viewer;
  }

  function annotate() {
    return root.SigK.annotate;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function renderedPages() {
    const view = viewer();
    if (view === undefined || state.doc === null)
      return [];
    const plan = view.getPlan();
    return view.getState().rendered.map((index) => ({
      index,
      src: plan[index]?.src,
      node: state.doc.querySelector(`.pdf-page[data-page="${index + 1}"]`),
      handle: view.getTextLayer(index),
    })).filter((page) => page.node !== null && page.handle !== null && page.handle !== undefined);
  }

  function clearSelection() {
    state.win?.getSelection?.()?.removeAllRanges?.();
  }

  // いまの文字の選択から注釈を作る。ページごとに 1 つ（確定事項11）。差し込んだ
  // ページ（src が無い）には付けない（既知の限界）。作れたら true。
  function createFromSelection(kind) {
    const view = viewer();
    if (view === undefined || view.getState().open !== true || !annotate().isMarkupTool(kind))
      return false;
    const found = root.SigK.markupSelection.collect({
      doc: state.doc,
      selection: state.win?.getSelection?.() ?? null,
      pages: renderedPages(),
      rectsOf: state.rectsOf,
    }).filter((page) => Number.isInteger(page.src));
    if (found.length === 0)
      return false;

    let annots = view.getAnnotations();
    const ids = [];
    for (const page of found) {
      const id = annotationState().newId();
      ids.push(id);
      annots = annotationState().addAnnot(annots, {
        id, src: page.src, kind, color: annotate().colorOf(kind), opacity: 1, quads: page.quads, rect: page.rect, text: page.text,
      });
    }
    clearSelection();
    root.SigK.pageEdit.commitAnnots(annots, { annot: { before: null, after: ids[0] } });
    annotate().select(ids[0]);
    return true;
  }

  function init(doc, win) {
    if (win.__sigkAnnotateMarkupReady === true)
      return false;
    win.__sigkAnnotateMarkupReady = true;
    state.doc = doc;
    state.win = win;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateMarkup = {
    init,
    createFromSelection,
    renderedPages,
    setRectsOf: (fn) => { state.rectsOf = fn; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
