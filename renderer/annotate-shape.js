(function (root) {
  'use strict';

  // 図形・ペン注釈の指揮（spec-4-3 確定事項3・5・7・14〜19）。
  //
  // 描く（beginDraft → updateDraft → finishDraft）・動かす（move）・線の太さと図形の種類を
  // 変える（setLineWidth・setShapeKind）を、annotation-state.js の純粋な操作と
  // page-edit.commitAnnots（1 本の履歴）に結ぶ。下書きそのものは shape-draft.js、幾何は
  // shape-geometry.js、押し離しの振り分けは annotate-pointer.js、道具と選択は annotate.js が持つ。
  // annotate-text.js と同じ位置づけ。

  const state = { doc: null, lineWidth: null, shapeKind: null };

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function draft() {
    return root.SigK.shapeDraft;
  }

  function geometry() {
    return root.SigK.shapeGeometry;
  }

  function presets() {
    return root.SigK.annotationPresets;
  }

  function isOpen() {
    return viewer()?.getState().open === true;
  }

  function findEntry(key) {
    const view = viewer();
    return annotationState().findAnnot(view.getAnnotations(), view.getImported(), key);
  }

  function viewportOf(index) {
    return root.SigK.freeTextEditor?.pageOf(index)?.viewport ?? viewer()?.getTextLayer(index)?.viewport ?? null;
  }

  // 道具が描く種類。「図形」は右パネルで選んだ種類、「ペン」は ink。
  function kindOfTool(tool) {
    if (tool === 'pen')
      return 'ink';
    return tool === 'shape' ? getShapeKind() : null;
  }

  // 履歴に積んで選び直す（annotate-text.js と同じ約束）。
  function commit(next, { before, target }) {
    const after = target === null || target.ref !== undefined ? next.added.at(-1).id : before;
    root.SigK.pageEdit.commitAnnots(next, { annot: { before, after } });
    annotate().select(after);
    return true;
  }

  // ---- 描く（確定事項3） ----

  function beginDraft({ index, point, shift = false }) {
    const kind = kindOfTool(annotate().getTool());
    const viewport = viewportOf(index);
    const src = viewer()?.getPlan()[index]?.src;
    if (kind === null || !isOpen() || viewport === null || !Number.isInteger(src))
      return false;
    return draft().begin({ index, src, viewport, kind, point, shift, color: annotate().colorOf(kind), lineWidth: getLineWidth() });
  }

  function updateDraft(point, shift = false) {
    if (!draft().update(point, shift))
      return false;
    viewer().redrawAnnotations();
    return true;
  }

  // 離した。動いていなければ捨てる（押しただけ）。動いていれば注釈にして 1 世代積み、選ぶ。
  function finishDraft(point, shift = false) {
    const slop = root.SigK.annotatePointer?.CLICK_SLOP ?? 3;
    const entry = draft().finish(point, shift, slop);
    if (entry === null || !isOpen()) {
      viewer()?.redrawAnnotations();
      return false;
    }
    const annots = viewer().getAnnotations();
    const next = annotationState().addAnnot(annots, { ...entry, id: annotationState().newId() });
    if (next.added.length === annots.added.length) {
      viewer().redrawAnnotations();
      return false;
    }
    return commit(next, { before: annotate().getSelected(), target: null });
  }

  function cancelDraft() {
    if (!draft().cancel())
      return false;
    viewer()?.redrawAnnotations();
    return true;
  }

  // ---- 動かす（確定事項5） ----

  function shifted(entry, delta) {
    const round = (value) => Math.round(value * 100) / 100;
    const patch = {};
    if (entry.paths !== undefined)
      patch.paths = entry.paths.map((path) => path.map((point) => [round(point[0] + delta[0]), round(point[1] + delta[1])]));
    const rect = [round(entry.rect[0] + delta[0]), round(entry.rect[1] + delta[1]), round(entry.rect[2] + delta[0]), round(entry.rect[3] + delta[1])];
    return { ...patch, ...geometry().rectOfShape({ kind: entry.kind, rect, paths: patch.paths, lineWidth: entry.lineWidth }) };
  }

  // delta は紙の座標での差分（pt）。箱と点列をずらし、/Rect を作り直す。
  function move(key, delta) {
    if (!isOpen() || !Array.isArray(delta) || !delta.every(Number.isFinite))
      return false;
    const entry = findEntry(key);
    if (entry === null || !annotationState().isDrawnKind(entry.kind))
      return false;
    const next = annotationState().updateAnnot(viewer().getAnnotations(), entry, shifted(entry, delta));
    return commit(next, { before: key, target: entry });
  }

  // ---- 線の太さと図形の種類（確定事項7・19・27・29） ----

  function getLineWidth() {
    return state.lineWidth ?? presets().DEFAULT_LINE_WIDTH;
  }

  function applyLineWidth(width) {
    if (presets().isLineWidth(width))
      state.lineWidth = width;
    root.SigK.annotationProps?.refresh();
    return getLineWidth();
  }

  function rememberLineWidth(width) {
    if (!presets().isLineWidth(width))
      return false;
    state.lineWidth = width;
    root.SigK.shell?.persist?.({ annotLineWidth: width });
    return true;
  }

  // 選んでいる図形があればその注釈を変え（/Rect も作り直す）、次に描く太さとしても覚える。
  function setLineWidth(width) {
    if (!presets().isLineWidth(width))
      return false;
    const entry = annotate().selectedEntry();
    if (entry !== null && annotationState().isDrawnKind(entry.kind) && entry.lineWidth !== width) {
      const patch = { lineWidth: width, ...geometry().rectOfShape({ kind: entry.kind, rect: entry.rect, paths: entry.paths, lineWidth: width }) };
      commit(annotationState().updateAnnot(viewer().getAnnotations(), entry, patch), { before: annotate().getSelected(), target: entry });
    }
    rememberLineWidth(width);
    root.SigK.annotationProps?.refresh();
    return true;
  }

  function getShapeKind() {
    return state.shapeKind ?? presets().DEFAULT_SHAPE_KIND;
  }

  function applyShapeKind(kind) {
    if (presets().isShapeKind(kind))
      state.shapeKind = kind;
    root.SigK.annotationProps?.refresh();
    return getShapeKind();
  }

  // 次に描く種類。描いた図形の種類は変えない（確定事項7）。
  function setShapeKind(kind) {
    if (!presets().isShapeKind(kind))
      return false;
    state.shapeKind = kind;
    root.SigK.shell?.persist?.({ annotShapeKind: kind });
    root.SigK.annotationProps?.refresh();
    return true;
  }

  function init(doc, win) {
    if (win.__sigkAnnotateShapeReady === true)
      return false;
    win.__sigkAnnotateShapeReady = true;
    state.doc = doc;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateShape = {
    init,
    kindOfTool,
    beginDraft,
    updateDraft,
    finishDraft,
    cancelDraft,
    draftFor: (index) => draft().draftFor(index),
    isDrawing: () => draft().isDrawing(),
    move,
    getLineWidth,
    applyLineWidth,
    rememberLineWidth,
    setLineWidth,
    getShapeKind,
    applyShapeKind,
    setShapeKind,
  };
})(typeof window !== 'undefined' ? window : globalThis);
