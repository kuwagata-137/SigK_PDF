(function (root) {
  'use strict';

  // マーキングをドラッグで描く下書き（docs/spec-7-10-shape-tools.md。決定102 ⑦）。
  //
  // 丸と同じく、押した点と今の点を対角とする正方形（|dx|・|dy| の大きい方を辺にし、引いた向きへ伸ばす。shape-geometry.js の boxOf）に
  // 外接させて、外の円の直径と中心を決める。ドラッグしている間は下書きを表示し（page-render.js が annotate-shape.js の draftFor から引く）、
  // 離すと配置して選択する（annotate-marking.js の placeAt）。押した点から動いていなければ（クリック）何もせず false を返し、
  // annotate-press.js の押し離しの経路（既定の大きさで配置する。選択中なら選択の解除だけ）へ回す。
  // 押し離しの振り分けは annotate-draw.js と annotate-shape.js（beginDraft・updateDraft・finishDraft・cancelDraft）が持つ。

  // { index, src, viewport, start, current }（start・current は .pdf-page 基準の CSS px）。
  let draft = null;

  function marking() {
    return root.SigK.annotateMarking;
  }

  function slop() {
    return root.SigK.annotatePointer?.CLICK_SLOP ?? 3;
  }

  function begin({ index, src, viewport, point }) {
    if (viewport === null || !Number.isInteger(src))
      return false;
    draft = { index, src, viewport, start: [point[0], point[1]], current: [point[0], point[1]] };
    return true;
  }

  function update(point) {
    if (draft === null)
      return false;
    draft.current = [point[0], point[1]];
    return true;
  }

  function moved(at) {
    return Math.abs(at.current[0] - at.start[0]) > slop() || Math.abs(at.current[1] - at.start[1]) > slop();
  }

  // 外の円の直径（pt）と中心（pt）。表示の座標の正方形の角を紙の座標へ直す（ページの回転は 90° 単位なので、紙でも正方形）。
  function frameOf(at) {
    const box = root.SigK.shapeGeometry.boxOf(at.start, at.current, { square: true });
    const a = at.viewport.convertToPdfPoint(box[0], box[1]);
    const b = at.viewport.convertToPdfPoint(box[2], box[3]);
    return { outer: Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])), center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  }

  // 描いている途中の下書き（そのページのぶんだけ）。動いていない間は描かない（押しただけで既定の大きさが見えないように）。
  function draftFor(index) {
    if (draft === null || draft.index !== index || !moved(draft))
      return null;
    const { outer, center } = frameOf(draft);
    return marking().entryOf({ src: draft.src, center, marking: marking().drawnMarking(outer) });
  }

  // 離した。動いていれば配置して true、動いていなければ false。
  function finish(point) {
    if (!update(point))
      return false;
    const done = draft;
    draft = null;
    if (!moved(done))
      return false;
    const { outer, center } = frameOf(done);
    return marking().placeAt({ src: done.src, center, marking: marking().drawnMarking(outer) });
  }

  function cancel() {
    if (draft === null)
      return false;
    draft = null;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.markingDraft = { begin, update, finish, cancel, draftFor, isDrawing: () => draft !== null };
})(typeof window !== 'undefined' ? window : globalThis);
