(function (root) {
  'use strict';

  // 選んでいるテキスト・図形・ペン・ノートを掴んで動かす（spec-4-2 確定事項6、spec-4-3 確定事項5、spec-4-4 確定事項2）。
  //
  // annotate-pointer.js から移した（spec-4b-2。200 行の目安）。押したときに begin、動かすたびに move（書き込みの <g> と、
  // 枠とつまみの層を CSS で translate するだけで描き直さない。spec-4b-2 確定事項23）、離したときに end（紙の座標の差分に直して 1 世代）。

  // 掴んで動かしているもの { key, index, viewport, start(px), group }。無ければ null。
  let drag = null;

  function annotate() {
    return root.SigK.annotate;
  }

  // 種類ごとの動かす口。
  function moverFor(entry) {
    if (entry?.kind === 'text')
      return root.SigK.annotateText;
    return entry?.kind === 'note' ? root.SigK.annotateNote : root.SigK.annotateShape;
  }

  function moved(from, event) {
    const slop = root.SigK.annotatePointer?.CLICK_SLOP ?? 3;
    return Math.abs(event.clientX - from[0]) > slop || Math.abs(event.clientY - from[1]) > slop;
  }

  // 選んでいるテキスト・図形の上で押したらドラッグの準備。文字選択を始めさせない。
  function begin(event, page, key) {
    const entry = annotate().selectedEntry();
    if (entry === null || !root.SigK.annotationMoves.isMovable(entry) || root.SigK.annotationLayer.keyOf(entry) !== key)
      return false;
    const viewport = root.SigK.freeTextEditor?.pageOf(page.index)?.viewport ?? root.SigK.viewer.getTextLayer(page.index)?.viewport;
    if (viewport === undefined || viewport === null)
      return false;
    event.preventDefault();
    drag = {
      key, index: page.index, viewport,
      start: [event.clientX, event.clientY],
      group: page.node.querySelector(`.annot-layer g[data-annot="${key}"]`),
    };
    return true;
  }

  // 書き込みの <g> と、枠とつまみの層（spec-4b-2 確定事項23）を同じだけずらす。
  function move(event) {
    if (drag === null || drag.group === null)
      return;
    const dx = event.clientX - drag.start[0];
    const dy = event.clientY - drag.start[1];
    drag.group.style.transform = `translate(${dx}px, ${dy}px)`;
    root.SigK.annotationFrame?.translate(dx, dy);
  }

  // 離したら紙の座標での差分に直して 1 世代積む。動いていなければ何もしない（選んだまま）。
  function end(event) {
    const current = drag;
    drag = null;
    if (current === null)
      return false;
    if (current.group !== null)
      current.group.style.transform = '';
    root.SigK.annotationFrame?.translate(0, 0);
    if (!moved(current.start, event))
      return false;
    const from = current.viewport.convertToPdfPoint(current.start[0], current.start[1]);
    const to = current.viewport.convertToPdfPoint(event.clientX, event.clientY);
    const delta = [to[0] - from[0], to[1] - from[1]];
    moverFor(annotate().selectedEntry())?.move(current.key, delta);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateGrab = { begin, move, end, isGrabbing: () => drag !== null };
})(typeof window !== 'undefined' ? window : globalThis);
