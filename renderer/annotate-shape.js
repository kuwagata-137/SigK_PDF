(function (root) {
  'use strict';

  // 図形・ペン注釈の指揮（spec-4-3 確定事項3・5・7・14〜19）。
  //
  // 描く（beginDraft → updateDraft → finishDraft）・動かす（move）・線の太さと図形の種類を
  // 変える（setLineWidth・setShapeKind）を、annotation-state.js の純粋な操作と
  // page-edit.commitAnnots（1 本の履歴）に結ぶ。下書きそのものは shape-draft.js、幾何は
  // shape-geometry.js、押し離しの振り分けは annotate-pointer.js、道具と選択は annotate.js が持つ。線の太さと図形の種類は
  // annotate-shape-kind.js（同じ名前の口で委ねる）。annotate-text.js と同じ位置づけ。

  const state = { doc: null };

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

  // 道具が描く種類。「図形」は道具の段で選んだ種類、「ペン」は ink、「マーカー」は道具の値を引く鍵の marker（描くのは乗算の
  // ink。spec-4b-5b 確定事項2）。ほかの道具は null。
  function kindOfTool(tool) {
    if (tool === 'pen')
      return 'ink';
    if (tool === 'marker')
      return 'marker';
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
    // 多角形はドラッグでは描かない（クリックで頂点を置く。spec-4b-5a 確定事項13）。
    if (kind === null || kind === 'polygon' || !isOpen() || viewport === null || !Number.isInteger(src))
      return false;
    // 色・塗り・線種は次に付ける値（線なしなら色は null。spec-4b-1b 確定事項42）。マーカーは乗算のペンとして描く。
    const look = annotate().nextStyleOf(kind);
    const drawn = kind === 'marker' ? { kind: 'ink', blend: 'multiply' } : { kind };
    return draft().begin({ index, src, viewport, ...drawn, point, shift, ...look, lineWidth: getLineWidth(kind), opacity: annotate().getOpacity(kind) });
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

  // ---- 線の太さと図形の種類（確定事項7・19・27・29。annotate-shape-kind.js へ移した） ----

  function kindModule() {
    return root.SigK.annotateShapeKind;
  }

  function getLineWidth(kind) {
    return kindModule().getLineWidth(kind);
  }

  function getShapeKind() {
    return kindModule().getShapeKind();
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
    commit,
    getLineWidth,
    applyLineWidth: (width) => kindModule().applyLineWidth(width),
    rememberLineWidth: (width, kind) => kindModule().rememberLineWidth(width, kind),
    applyMarkerWidth: (width) => kindModule().applyMarkerWidth(width),
    setLineWidth: (width) => kindModule().setLineWidth(width),
    getShapeKind,
    applyShapeKind: (kind) => kindModule().applyShapeKind(kind),
    setShapeKind: (kind) => kindModule().setShapeKind(kind),
  };
})(typeof window !== 'undefined' ? window : globalThis);
