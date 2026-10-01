(function (root) {
  'use strict';

  // 編集モードで「選んでいる書き込み」を持ち、選ぶ・当てる・消す（spec-4-1 確定事項6・7、spec-4-4 確定事項31、spec-4b-1b 確定事項8、
  // spec-4b-2 確定事項21）。
  //
  // 300 行に近づいた annotate.js から移した（spec-4b-3a。中身は変えていない）。annotate.js は同じ名前の口でここへ委ねる。

  const state = {
    selected: null,
  };

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function props() {
    return root.SigK.annotationProps;
  }

  function isOpen() {
    return viewer()?.getState().open === true;
  }

  function getSelected() {
    return state.selected;
  }

  function selectedEntry() {
    if (state.selected === null || !isOpen())
      return null;
    return annotationState().findAnnot(viewer().getAnnotations(), viewer().getImported(), state.selected);
  }

  // 選ぶ。一覧の行も揃える（spec-4-4 確定事項31）。スライダーの下見とつまみのドラッグは捨てる（spec-4b-1b 確定事項8、
  // spec-4b-2 確定事項21）。
  function select(key) {
    root.SigK.annotateTransform?.cancel();
    root.SigK.annotatePreview?.cancel();
    state.selected = key ?? null;
    if (state.selected !== null && selectedEntry() === null)
      state.selected = null;
    viewer()?.redrawAnnotations();
    props()?.refresh();
    root.SigK.annotationList?.syncSelected(state.selected);
    return state.selected;
  }

  // 点（.pdf-page 基準の CSS px）に当たる注釈（annotation-hit.js。上に描いたものが優先）。
  function hitTest(index, point) {
    return root.SigK.annotationHit.hitTest(index, point);
  }

  function remove() {
    // つまみのドラッグ中なら先に取りやめる（spec-4b-2 確定事項21）。
    root.SigK.annotateTransform?.cancel();
    const entry = selectedEntry();
    if (entry === null)
      return false;
    const key = state.selected;
    const annots = annotationState().removeAnnot(viewer().getAnnotations(), entry);
    state.selected = null;
    root.SigK.pageEdit.commitAnnots(annots, { annot: { before: key, after: null } });
    props()?.refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateSelect = {
    getSelected,
    selectedEntry,
    select,
    hitTest,
    remove,
  };
})(typeof window !== 'undefined' ? window : globalThis);
