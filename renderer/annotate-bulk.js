(function (root) {
  'use strict';

  // 選んでいる書き込みをまとめて動かす・写す・見た目を変える（spec-4b-3a 確定事項F・G・I）。どれも 1 回だけ commit して 1 世代にし、選び直す。
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

  // 当てた欄の値を、当てた書き込みの種類ごとに「次に付ける値」としても覚える（確定事項I4。1 件のときと同じ決まり）。
  // テキストの書式（文字の大きさ・太字・斜体・塗り・枠線・枠線の太さ）は annotate-text-style.js が覚える（spec-4b-4a 確定事項H）。
  function rememberNext(field, value, kinds) {
    const next = root.SigK.annotateNextStyle;
    const style = root.SigK.shapeStyle;
    const boxed = kinds.some((kind) => style.isFillableKind(kind));
    if (field !== 'color' && field !== 'opacity') {
      for (const tool of ['text', 'callout'].filter((each) => kinds.includes(each)))
        root.SigK.annotateTextStyle.rememberFor(field, value, tool);
    }
    if (field === 'color') {
      kinds.forEach((kind) => next.rememberColor(kind, value));
      if (boxed)
        next.rememberShape('strokeNone', false);
    } else if (field === 'strokeNone') {
      next.rememberShape('strokeNone', true);
    } else if (field === 'fill' && boxed) {
      next.rememberShape('fills', value);
      if (value === null)
        next.rememberShape('strokeNone', false);
    } else if (field === 'lineStyle' && kinds.some((kind) => style.lineStylesOf(kind).length > 1)) {
      next.rememberShape('lineStyles', value);
    } else if (field === 'lineWidth' && kinds.some((kind) => kind === 'marker' || root.SigK.annotationEntry.isDrawnKind(kind))) {
      // マーカーの太さは別に覚える（spec-4b-5b 確定事項4）。
      if (kinds.includes('marker'))
        root.SigK.annotateShape.rememberLineWidth(value, 'marker');
      if (kinds.some((kind) => root.SigK.annotationEntry.isDrawnKind(kind)))
        root.SigK.annotateShape.rememberLineWidth(value);
    } else if (field === 'opacity') {
      kinds.forEach((kind) => root.SigK.annotateOpacity.rememberOpacity(kind, value));
    }
  }

  // 見た目の欄を、選んでいる書き込みのうちその欄を持てるもの全部に当てて 1 世代（確定事項I2）。持てるものが無ければ false。
  // 値が全部同じで変わらなくても、次に付ける値は覚える（1 件のときと同じ）。
  function applyField(field, value) {
    if (!isOpen())
      return false;
    const view = viewer();
    const patch = root.SigK.annotationStylePatch;
    const keys = annotate().getSelection();
    const targets = annotate().selectedEntries().filter((entry) => patch.appliesTo(field, entry, value));
    if (targets.length === 0)
      return false;
    const before = view.getAnnotations();
    const { annots, keys: renamed } = root.SigK.annotationBulk.updateEach(before, view.getImported(), keys, (entry) => patch.patchFor(field, value, entry));
    if (annots !== before) {
      const after = keys.map((key) => renamed.get(key) ?? key);
      // 線なしは線の色の行で選ぶので、線の色と同じ欄として続けた変更に畳む（確定事項J1）。
      const gesture = field === 'strokeNone' ? 'color' : field;
      root.SigK.pageEdit.commitAnnots(annots, { annot: { before: selection().annotKeys(keys), after: selection().annotKeys(after) }, gesture });
      annotate().selectKeys(after);
    }
    // 吹き出しは種類の鍵 callout で覚える（spec-4b-4b 確定事項A5）。
    rememberNext(field, value, [...new Set(targets.map((entry) => root.SigK.annotationPresets.kindOf(entry)))]);
    root.SigK.annotationProps?.refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateBulk = { movableKeys, moveSelected, copySelected, applyField };
})(typeof window !== 'undefined' ? window : globalThis);
