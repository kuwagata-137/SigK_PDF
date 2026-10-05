(function (root) {
  'use strict';

  // 図形・ペンの線の太さと、図形の道具で描く種類（spec-4-3 確定事項7・19・27・29、spec-4b-1a 確定事項5・8、spec-4b-3a 確定事項I2・J、
  // spec-4b-4a 確定事項G4・G5）。
  //
  // 200 行を超えた annotate-shape.js から移した（spec-4b-5a a0。中身は変えていない）。annotate-shape.js は同じ名前の口
  // （getLineWidth・setLineWidth・getShapeKind・setShapeKind など）でここへ委ねる。

  const state = { lineWidth: null, shapeKind: null };

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function presets() {
    return root.SigK.annotationPresets;
  }

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
    if (entry?.kind === 'text' || (entry === null && ['text', 'callout'].includes(annotate().drawingTool())))
      return root.SigK.annotateTextStyle.setBorderWidth(width);
    if (entry !== null && entry.readonly !== true && annotationState().isDrawnKind(entry.kind) && entry.lineWidth !== width) {
      const patch = { lineWidth: width, ...root.SigK.shapeGeometry.rectOfEntry(entry, { lineWidth: width }) };
      const annots = viewer().getAnnotations();
      // 続けて変えたら 1 世代に畳む（spec-4b-3a 確定事項J）。
      root.SigK.annotateShape.commit(annotationState().updateAnnot(annots, entry, patch), { before: annotate().getSelected(), target: entry, annots, gesture: 'lineWidth' });
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
    // 描いている途中の多角形は、図形の種類を替える前に開いたまま確定する（spec-4b-5a 確定事項16）。
    if (kind !== state.shapeKind)
      root.SigK.annotatePolygon?.commitPending();
    state.shapeKind = kind;
    root.SigK.shell?.persist?.({ annotShapeKind: kind });
    syncBar();
    root.SigK.annotationProps?.refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateShapeKind = { getLineWidth, applyLineWidth, rememberLineWidth, setLineWidth, getShapeKind, applyShapeKind, setShapeKind };
})(typeof window !== 'undefined' ? window : globalThis);
