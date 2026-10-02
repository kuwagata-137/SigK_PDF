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

  // 道具が描く種類。「図形」は道具の段で選んだ種類、「ペン」は ink。ほかの道具は null。
  function kindOfTool(tool) {
    if (tool === 'pen')
      return 'ink';
    return tool === 'shape' ? getShapeKind() : null;
  }

  // 履歴に積んで選び直す（annotate-text.js と同じ約束）。形が崩れて updateAnnot が断った（annots のまま）なら何もしない。
  function commit(next, { before, target, annots = null, gesture = null }) {
    if (next === annots)
      return false;
    const after = target === null || target.ref !== undefined ? next.added.at(-1).id : before;
    root.SigK.pageEdit.commitAnnots(next, { annot: { before, after }, gesture });
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
    // 色・塗り・線種は次に付ける値（線なしなら色は null。spec-4b-1b 確定事項42）。
    const look = annotate().nextStyleOf(kind);
    return draft().begin({ index, src, viewport, kind, point, shift, ...look, lineWidth: getLineWidth(), opacity: annotate().getOpacity(kind) });
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

  // delta は紙の座標での差分（pt）。箱と点列をずらし、/Rect を作り直す（値は annotation-moves.js が作る）。
  function move(key, delta) {
    if (!isOpen() || !Array.isArray(delta) || !delta.every(Number.isFinite))
      return false;
    const entry = findEntry(key);
    if (entry === null || !annotationState().isDrawnKind(entry.kind))
      return false;
    const annots = viewer().getAnnotations();
    return commit(annotationState().updateAnnot(annots, entry, root.SigK.annotationMoves.movedPatch(entry, delta)), { before: key, target: entry, annots });
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
    // 2 件以上を選んでいれば、図形・ペン全部（とテキストの枠線）に当てる（spec-4b-3a 確定事項I2、spec-4b-4a 確定事項G5）。
    if (annotate().getSelection().length > 1)
      return root.SigK.annotateBulk.applyField('lineWidth', width);
    const entry = annotate().selectedEntry();
    // テキストの太さの行は枠線の太さ（spec-4b-4a 確定事項G4）。テキストを選んでいるか、テキストの道具を持っているとき。
    if (entry?.kind === 'text' || (entry === null && annotate().drawingTool() === 'text'))
      return root.SigK.annotateTextStyle.setBorderWidth(width);
    if (entry !== null && entry.readonly !== true && annotationState().isDrawnKind(entry.kind) && entry.lineWidth !== width) {
      const patch = { lineWidth: width, ...geometry().rectOfShape({ kind: entry.kind, rect: entry.rect, paths: entry.paths, lineWidth: width, angle: entry.angle }) };
      const annots = viewer().getAnnotations();
      // 続けて変えたら 1 世代に畳む（spec-4b-3a 確定事項J）。
      commit(annotationState().updateAnnot(annots, entry, patch), { before: annotate().getSelected(), target: entry, annots, gesture: 'lineWidth' });
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
    syncBar();
    root.SigK.annotationProps?.refresh();
    return getShapeKind();
  }

  // 道具の段の図形のボタンの印を、いまの種類に揃える（spec-4b-1a 確定事項5）。
  function syncBar() {
    root.SigK.editBar?.sync(annotate()?.getTool() ?? null, getShapeKind());
  }

  // 次に描く種類。道具の段の図形のボタンが決める。描いた図形の種類は変えない（確定事項7）。
  function setShapeKind(kind) {
    if (!presets().isShapeKind(kind))
      return false;
    state.shapeKind = kind;
    root.SigK.shell?.persist?.({ annotShapeKind: kind });
    syncBar();
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
