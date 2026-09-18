(function (root) {
  'use strict';

  // 不透明度の指揮（spec-4-4 確定事項5・21・38）。
  //
  // 右パネルの「不透明度」の値を、選んでいる注釈（テキスト・図形・ペン・ノート）に当てて 1 世代積むか、
  // 選んでいなければ道具ごとに「次に付ける値」として覚える（色と同じ流儀。settings.json の ui.annotOpacity）。
  // 対象外の種類（ハイライト・下線・取り消し線・表示のみ）は断る。annotate.js から委譲で公開する。

  const { OPACITIES, OPACITY_TOOLS, DEFAULT_OPACITIES, isOpacity, isOpacityKind, paletteOf } = root.SigK.annotationPresets;

  const state = { opacities: { ...DEFAULT_OPACITIES } };

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function props() {
    return root.SigK.annotationProps;
  }

  // 道具（か種類）の次に付ける不透明度。対象外なら 1。
  function opacityOf(kind) {
    const palette = paletteOf(kind);
    return OPACITY_TOOLS.includes(palette) ? state.opacities[palette] : 1;
  }

  function getOpacities() {
    return { ...state.opacities };
  }

  // 起動時に settings.json から戻す。プリセット外は捨てる。
  function applyOpacities(opacities) {
    for (const tool of OPACITY_TOOLS) {
      if (isOpacity(opacities?.[tool]))
        state.opacities[tool] = opacities[tool];
    }
    props()?.refresh();
    return getOpacities();
  }

  function rememberOpacity(kind, value) {
    const palette = paletteOf(kind);
    if (!OPACITY_TOOLS.includes(palette) || !isOpacity(value))
      return false;
    state.opacities[palette] = value;
    root.SigK.shell?.persist?.({ annotOpacity: { [palette]: value } });
    return true;
  }

  // 選んでいる注釈の不透明度を変えて 1 世代積む。読み込んだものは写しに変わり、選択はその写しへ移す。
  function updateSelected(entry, value) {
    const before = annotate().getSelected();
    const annots = annotationState().updateAnnot(viewer().getAnnotations(), entry, { opacity: value });
    const after = entry.ref !== undefined ? annots.added.at(-1).id : before;
    root.SigK.pageEdit.commitAnnots(annots, { annot: { before, after } });
    annotate().select(after);
  }

  // 「不透明度」の行から。選んでいればその注釈、無ければ道具の値（次に付ける値）。
  function setOpacity(value) {
    if (!isOpacity(value))
      return false;
    const entry = annotate().selectedEntry();
    if (entry === null) {
      const tool = annotate().getTool();
      if (tool === null || !rememberOpacity(tool, value))
        return false;
      props()?.refresh();
      return true;
    }
    if (entry.readonly === true || !isOpacityKind(entry.kind))
      return false;
    if (entry.opacity !== value)
      updateSelected(entry, value);
    rememberOpacity(entry.kind, value);
    props()?.refresh();
    return true;
  }

  function init(doc, win) {
    if (win.__sigkAnnotateOpacityReady === true)
      return false;
    win.__sigkAnnotateOpacityReady = true;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateOpacity = { OPACITIES, init, opacityOf, getOpacities, applyOpacities, rememberOpacity, setOpacity, isOpacityKind };
})(typeof window !== 'undefined' ? window : globalThis);
