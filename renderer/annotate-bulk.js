(function (root) {
  'use strict';

  // 選んでいる書き込みをまとめて動かす・写す（spec-4b-3a 確定事項F・G）。どれも 1 回だけ commit して 1 世代にし、選び直す。
  // 当てる値は annotation-moves.js、1 件ずつ当てるのは annotation-bulk.js。

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function selection() {
    return root.SigK.annotationSelection;
  }

  function isOpen() {
    return viewer()?.getState().open === true;
  }

  // 選んでいる書き込みのうち、動かせるもの（図形・ペン・テキスト・ノート）の鍵。
  function movableKeys() {
    const view = viewer();
    return annotate().getSelection().filter((key) => {
      const entry = root.SigK.annotationState.findAnnot(view.getAnnotations(), view.getImported(), key);
      return entry !== null && entry.readonly !== true && root.SigK.annotationMoves.isMovable(entry);
    });
  }

  // 紙の座標で delta（pt）だけ動かす。動かせないものはその場に残る（確定事項F1）。動かせたら true。
  function moveSelected(delta) {
    if (!isOpen() || !Array.isArray(delta) || !delta.every(Number.isFinite))
      return false;
    const view = viewer();
    const keys = annotate().getSelection();
    const before = view.getAnnotations();
    const { annots, keys: renamed } = root.SigK.annotationBulk.updateEach(before, view.getImported(), movableKeys(), (entry) => root.SigK.annotationMoves.movedPatch(entry, delta));
    if (annots === before)
      return false;
    const after = keys.map((key) => renamed.get(key) ?? key);
    root.SigK.pageEdit.commitAnnots(annots, { annot: { before: selection().annotKeys(keys), after: selection().annotKeys(after) } });
    annotate().selectKeys(after);
    return true;
  }

  // 写しを delta（pt）だけずらして最前面に足す（確定事項G3）。選択は写しに替わる。写せたら true。
  function copySelected(delta) {
    if (!isOpen() || !Array.isArray(delta) || !delta.every(Number.isFinite))
      return false;
    const view = viewer();
    const keys = annotate().getSelection();
    const before = view.getAnnotations();
    const { annots, keys: copies } = root.SigK.annotationBulk.copyEach(before, view.getImported(), movableKeys(), delta);
    if (copies.length === 0)
      return false;
    root.SigK.pageEdit.commitAnnots(annots, { annot: { before: selection().annotKeys(keys), after: selection().annotKeys(copies) } });
    annotate().selectKeys(copies);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateBulk = { movableKeys, moveSelected, copySelected };
})(typeof window !== 'undefined' ? window : globalThis);
