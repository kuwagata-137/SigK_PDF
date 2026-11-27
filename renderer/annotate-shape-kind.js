(function (root) {
  'use strict';

  // 図形・ペンの線の太さと、図形の道具で描く種類（spec-4-3 確定事項7・19・27・29、spec-4b-1a 確定事項5・8、spec-4b-3a 確定事項I2・J、
  // spec-4b-4a 確定事項G4・G5）。
  //
  // 200 行を超えた annotate-shape.js から移した（spec-4b-5a a0。中身は変えていない）。annotate-shape.js は同じ名前の口
  // （getLineWidth・setLineWidth・getShapeKind・setShapeKind など）でここへ委ねる。マーカーの太さは図形・ペンとは別に覚える
  // （spec-4b-5b 確定事項3。kind が 'marker' のとき）。図形の線の太さは書き込みツール（四角・丸・直線・矢印・×印・多角形）ごとに
  // shape-tool-memory.js に記憶し、ペンの線の太さ（annotLineWidth）とも別にする（決定102 ⑨・質問 SH7 案B）。

  const state = { lineWidth: null, markerWidth: null, shapeKind: null };

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

  function memory() {
    return root.SigK.shapeToolMemory;
  }

  function getLineWidth(kind) {
    if (memory()?.isShapeKind(kind))
      return memory().get(kind, 'lineWidth');
    if (kind === 'marker')
      return state.markerWidth ?? presets().DEFAULT_MARKER_WIDTH;
    // マーキングの太さは別に記憶する（spec-7-9 確定事項F5。annotate-marking.js）。
    if (kind === 'marking')
      return root.SigK.annotateMarking.getLineWidth();
    return state.lineWidth ?? presets().DEFAULT_LINE_WIDTH;
  }

  function applyMarkerWidth(width) {
    if (presets().isLineWidth(width))
      state.markerWidth = width;
    root.SigK.annotationProps?.refresh();
    return getLineWidth('marker');
  }

  function applyLineWidth(width) {
    if (presets().isLineWidth(width))
      state.lineWidth = width;
    root.SigK.annotationProps?.refresh();
    return getLineWidth();
  }

  function rememberLineWidth(width, kind) {
    if (!presets().isLineWidth(width))
      return false;
    if (memory()?.isShapeKind(kind)) {
      memory().set(kind, 'lineWidth', width);
      return true;
    }
    if (kind === 'marking')
      return root.SigK.annotateMarking.rememberLineWidth(width);
    if (kind === 'marker') {
      state.markerWidth = width;
      root.SigK.shell?.persist?.({ annotMarkerWidth: width });
      return true;
    }
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
    // 選んでいる書き込みか、何も選ばずに持っている書き込みツールの種類の太さとして覚える（マーカー・マーキング・図形の種類ごと・ペン）。
    rememberLineWidth(width, entry === null ? root.SigK.annotateShape?.kindOfTool(annotate().drawingTool()) ?? annotate().drawingTool() : presets().kindOf(entry));
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
    if (kind !== state.shapeKind) {
      root.SigK.annotatePolygon?.commitPending();
      root.SigK.annotateLineAnchor?.cancel();
    }
    // 図形の書き込みツールを持ったまま種類を切り替えた時（四角 → 丸など）も、選択を解除する（決定102 ⑩）。
    if (kind !== getShapeKind() && annotate()?.getTool() === 'shape')
      annotate().select(null);
    state.shapeKind = kind;
    root.SigK.shell?.persist?.({ annotShapeKind: kind });
    syncBar();
    root.SigK.annotationProps?.refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateShapeKind = { getLineWidth, applyLineWidth, applyMarkerWidth, rememberLineWidth, setLineWidth, getShapeKind, applyShapeKind, setShapeKind };
})(typeof window !== 'undefined' ? window : globalThis);
