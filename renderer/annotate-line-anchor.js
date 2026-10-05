(function (root) {
  'use strict';

  // 線の始点合わせの流れ（spec-4b-5a 確定事項19）。直線・矢印の道具で、書き込みの端・角・頂点の近くをダブルクリックすると、その点を
  // 始点にしてマウスまでの線を下見し、次に左ボタンを離した所を終点にして置く（Shift で 45°。押してから動いた量は問わない）。
  //
  // ダブルクリックは annotate-pointer.js の onDoubleClick から tryStart、離しは onMouseUp から release（ほかの経路より先）、動きは move。
  // やめ方は描いている途中の多角形と同じ（Esc・右クリック・左＋右・Ctrl+Z／Ctrl+Y・道具やモード・タブを替える・保存や印刷の前）で、
  // 始点しか無いので確定はしない。吸い付く点は line-snap.js。

  // 終点が始点から近すぎれば置かない（表示の px）。
  const MIN_LENGTH = 3;

  // { index, src, viewport, kind, from, cursor }（from・cursor は紙の座標）
  let anchor = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function kindOfTool() {
    if (annotate()?.getTool() !== 'shape')
      return null;
    const kind = root.SigK.annotateShape?.getShapeKind();
    return kind === 'line' || kind === 'arrow' ? kind : null;
  }

  function viewportOf(index) {
    return root.SigK.freeTextEditor?.pageOf(index)?.viewport ?? viewer()?.getTextLayer(index)?.viewport ?? null;
  }

  function redraw() {
    viewer()?.redrawAnnotations();
    root.SigK.annotationProps?.refresh();
  }

  // 表示の点を、Shift なら始点から 45° 刻みにそろえて紙の座標にする。
  function endOf(viewport, point, shift) {
    const at = shift ? root.SigK.shapeGeometry.snapAngle(viewport.convertToViewportPoint(...anchor.from), point) : point;
    return root.SigK.shapeGeometry.roundPoint(viewport.convertToPdfPoint(at[0], at[1]));
  }

  // ダブルクリックした所の近くに吸い付く点があれば、始点にして始める。始めたら true。
  function tryStart(event) {
    const kind = kindOfTool();
    const page = kind === null ? null : root.SigK.annotatePress.pageAt(event);
    const viewport = page === null ? null : viewportOf(page.index);
    const src = page === null ? undefined : viewer()?.getPlan()[page.index]?.src;
    if (viewport === null || !Number.isInteger(src))
      return false;
    const entries = root.SigK.annotationState.annotsOnPage(viewer().getAnnotations(), viewer().getImported(), src);
    const snapped = root.SigK.lineSnap.nearest(entries, viewport, page.point);
    if (snapped === null)
      return false;
    // ほかの描き方と同じく小数 2 桁にそろえる（回した角・頂点は丸めない値で返るため）。
    const from = root.SigK.shapeGeometry.roundPoint(snapped);
    event?.preventDefault?.();
    annotate().select(null);
    anchor = { index: page.index, src, viewport, kind, from, cursor: null };
    redraw();
    return true;
  }

  function move(event) {
    if (anchor === null)
      return false;
    const page = root.SigK.annotatePress.pageAt(event);
    const viewport = page === null || page.index !== anchor.index ? null : viewportOf(page.index);
    anchor.cursor = viewport === null ? null : endOf(viewport, page.point, event.shiftKey === true);
    viewer()?.redrawAnnotations();
    return true;
  }

  // 線の書き込み（直線・矢印の道具の次に付ける値で。描いた直線・矢印と同じ見た目）。
  function entryOf(to) {
    const { kind, src, from } = anchor;
    const next = annotate().nextStyleOf(kind);
    const style = root.SigK.shapeStyle;
    const lineWidth = annotate().getLineWidth();
    const paths = [[[...from], to]];
    const entry = { src, kind, color: next.color ?? root.SigK.annotateNextStyle.colorOf(kind), opacity: annotate().getOpacity(kind), lineWidth, paths, ...root.SigK.shapeGeometry.rectOfShape({ kind, paths, lineWidth }) };
    return next.lineStyle !== 'solid' && style.lineStylesOf(kind).includes(next.lineStyle) ? style.restyle(entry, next.lineStyle) : entry;
  }

  // 始点を決めたあとの左ボタンの離し。そこを終点にして置く。ほかのページは無視する。始点から近すぎれば置かずに終える。始点が無ければ false。
  function release(event) {
    if (anchor === null)
      return false;
    const page = root.SigK.annotatePress.pageAt(event);
    const viewport = page === null || page.index !== anchor.index ? null : viewportOf(page.index);
    if (viewport === null)
      return true;
    const to = endOf(viewport, page.point, event.shiftKey === true);
    const [ax, ay] = viewport.convertToViewportPoint(...anchor.from);
    const [bx, by] = viewport.convertToViewportPoint(...to);
    if (Math.hypot(bx - ax, by - ay) < MIN_LENGTH) {
      cancel();
      return true;
    }
    const state = root.SigK.annotationState;
    const annots = viewer().getAnnotations();
    const next = state.addAnnot(annots, { ...entryOf(to), id: state.newId() });
    anchor = null;
    if (next.added.length === annots.added.length)
      redraw();
    else
      root.SigK.annotateShape.commit(next, { before: annotate().getSelected(), target: null });
    root.SigK.annotationProps?.refresh();
    return true;
  }

  function cancel() {
    if (anchor === null)
      return false;
    anchor = null;
    redraw();
    return true;
  }

  // 下書き（始点からマウスまでの線。確定後と同じ見た目）。
  function draftFor(index) {
    if (anchor === null || anchor.index !== index || anchor.cursor === null)
      return null;
    return entryOf(anchor.cursor);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateLineAnchor = { MIN_LENGTH, tryStart, move, release, cancel, draftFor, isActive: () => anchor !== null };
})(typeof window !== 'undefined' ? window : globalThis);
