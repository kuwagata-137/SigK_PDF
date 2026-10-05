(function (root) {
  'use strict';

  // 多角形の道具の押し離し（spec-4b-5a 確定事項13〜18）。
  //
  // 書き込みの無い所の押し離しで描き始め（annotate-press.js の up から start）、描いている間は左ボタンを離すたびに頂点を置き
  // （annotate-pointer.js が、ほかの経路より先に release へ回す）、始点の近くで離すと閉じて、ダブルクリックで開いたまま確定する。
  // Esc・右クリック・左＋右・Ctrl+Z／Ctrl+Y はやめ（cancel）、道具・モード・タブを替える・保存や印刷の前は置ける形なら開いたまま確定する
  // （commitPending。テキストの入力欄と同じ）。描きかけの状態と絵は polygon-draft.js、書き込みにして 1 世代積むのはここ。

  function annotate() {
    return root.SigK.annotate;
  }

  function draft() {
    return root.SigK.polygonDraft;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function isPolygonTool() {
    return annotate()?.getTool() === 'shape' && root.SigK.annotateShape?.getShapeKind() === 'polygon';
  }

  function viewportOf(index) {
    return root.SigK.freeTextEditor?.pageOf(index)?.viewport ?? viewer()?.getTextLayer(index)?.viewport ?? null;
  }

  function pageAt(event) {
    return root.SigK.annotatePress.pageAt(event);
  }

  function redraw() {
    viewer()?.redrawAnnotations();
  }

  function refreshProps() {
    root.SigK.annotationProps?.refresh();
  }

  // 書き込みの無い所の押し離しで、1 つ目の頂点を置いて描き始める（確定事項17）。
  function start(page) {
    if (!isPolygonTool() || draft().isActive())
      return false;
    const viewport = viewportOf(page.index);
    const src = viewer()?.getPlan()[page.index]?.src;
    if (viewport === null || !Number.isInteger(src))
      return false;
    annotate().select(null);
    draft().begin({ index: page.index, src, viewport, point: page.point });
    redraw();
    refreshProps();
    return true;
  }

  // 描いている途中の左ボタンの離し（確定事項13・15）。ほかのページと紙の外は無視する。描いていなければ false。
  function release(event) {
    if (!draft().isActive())
      return false;
    const page = pageAt(event);
    const viewport = page === null ? null : viewportOf(page.index);
    if (viewport !== null && draft().place({ index: page.index, viewport, point: page.point, shift: event.shiftKey === true }) === 'close')
      return commit(true);
    redraw();
    return true;
  }

  // マウスの動き（次の辺の下見）。描いていなければ false。
  function move(event) {
    if (!draft().isActive())
      return false;
    const page = pageAt(event);
    const viewport = page === null ? null : viewportOf(page.index);
    draft().hover(viewport === null ? { index: -1 } : { index: page.index, viewport, point: page.point, shift: event.shiftKey === true });
    redraw();
    return true;
  }

  // ダブルクリックで開いたまま確定する（確定事項15）。描いていなければ false。
  function doubleClick(event) {
    if (!draft().isActive())
      return false;
    event?.preventDefault?.();
    return commit(false);
  }

  // 確定した形を書き込みにする。開いたままの 2 つの頂点は直線（確定事項15）。見た目は図形の次に付ける値で、塗りと線なしは閉じた
  // 多角形にだけ当てる（確定事項30）。
  function entryOf(shape) {
    const next = annotate().nextStyleOf('polygon');
    const style = root.SigK.shapeStyle;
    const geometry = root.SigK.shapeGeometry;
    const kind = !shape.closed && shape.vertices.length === 2 ? 'line' : 'polygon';
    const lineWidth = annotate().getLineWidth();
    const paths = [shape.vertices];
    const filled = kind === 'polygon' && shape.closed && next.fill !== null;
    let entry = {
      src: shape.src, kind, opacity: annotate().getOpacity('polygon'), lineWidth,
      color: filled ? next.color : root.SigK.annotateNextStyle.colorOf('polygon'),
      paths, ...geometry.rectOfShape({ kind, paths, lineWidth }),
    };
    if (kind === 'polygon')
      entry.closed = shape.closed;
    if (filled)
      entry.fill = next.fill;
    if (next.lineStyle !== 'solid' && style.lineStylesOf(kind).includes(next.lineStyle))
      entry = style.restyle(entry, next.lineStyle);
    return entry;
  }

  // 確定する（閉じる・開いたまま）。置けない形なら何も積まない。どちらでも描きかけは終わるので true。
  function commit(closed) {
    const shape = draft().finish(closed);
    if (shape === null || viewer()?.getState().open !== true) {
      redraw();
      refreshProps();
      return true;
    }
    const state = root.SigK.annotationState;
    const annots = viewer().getAnnotations();
    const next = state.addAnnot(annots, { ...entryOf(shape), id: state.newId() });
    if (next.added.length === annots.added.length)
      redraw();
    else
      root.SigK.annotateShape.commit(next, { before: annotate().getSelected(), target: null });
    refreshProps();
    return true;
  }

  // 描きかけを捨てる（Esc・右クリック・左＋右・Ctrl+Z／Ctrl+Y。確定事項16）。描いていなければ false。
  function cancel() {
    if (!draft().cancel())
      return false;
    redraw();
    refreshProps();
    return true;
  }

  // 置ける形なら開いたまま確定する（道具・モード・タブを替える、保存・印刷の前。確定事項16）。描いていなければ false。
  function commitPending() {
    return draft().isActive() ? commit(false) : false;
  }

  // 下書きの絵（annotation-layer.js が描く）。置いた辺は確定後と同じ見た目の開いた多角形、印は頂点・次の辺・輪。
  function lookOf() {
    const next = annotate().nextStyleOf('polygon');
    return { color: root.SigK.annotateNextStyle.colorOf('polygon'), lineWidth: annotate().getLineWidth(), lineStyle: next.lineStyle, opacity: annotate().getOpacity('polygon') };
  }

  function draftFor(index) {
    const preview = draft().previewOf(index);
    if (preview === null || preview.vertices.length < 2)
      return null;
    const look = lookOf();
    return { kind: 'polygon', closed: false, paths: [preview.vertices], ...look, ...(look.lineStyle === 'solid' ? {} : { lineStyle: look.lineStyle }) };
  }

  function marksFor(index) {
    const preview = draft().previewOf(index);
    return preview === null ? null : { preview, look: lookOf() };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotatePolygon = {
    start,
    release,
    move,
    doubleClick,
    cancel,
    commitPending,
    draftFor,
    marksFor,
    isDrawing: () => draft().isActive(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
