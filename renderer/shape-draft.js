(function (root) {
  'use strict';

  // 図形・ペンの下書き（spec-4-3 確定事項3・4・6・9・10）。
  //
  // 押してから離すまでの状態を表示の座標（.pdf-page 基準の CSS px）で持ち、描くたびに
  // 紙の座標の entry へ直して annotation-layer に描かせる（draftFor）。離したときの entry を
  // 注釈にして履歴に積むのは annotate-shape.js の仕事で、ここは履歴も選択も知らない。
  // 幾何は shape-geometry.js。正方形・正円・45° の判定は表示の座標で行う（90° 単位の回転なので
  // 紙でも同じ形になる。確定事項4）。

  // { index, src, viewport, kind, start, current, points, shift, color, lineWidth }
  let draft = null;

  function geometry() {
    return root.SigK.shapeGeometry;
  }

  function begin({ index, src, viewport, kind, point, shift = false, color, lineWidth }) {
    draft = {
      index, src, viewport, kind, shift, color, lineWidth,
      start: [point[0], point[1]],
      current: [point[0], point[1]],
      points: [[point[0], point[1]]],
    };
    return true;
  }

  // 動かした。ペンは直前に残した点から MIN_STEP 以上離れた点だけを足す（確定事項6）。
  function update(point, shift = false) {
    if (draft === null)
      return false;
    draft.shift = shift;
    draft.current = [point[0], point[1]];
    if (draft.kind === 'ink' && geometry().farEnough(draft.points.at(-1), point, geometry().MIN_STEP))
      draft.points.push([point[0], point[1]]);
    return true;
  }

  function toPdf(point) {
    return geometry().roundPoint(draft.viewport.convertToPdfPoint(point[0], point[1]));
  }

  // 下書きを紙の座標の entry にする。points は表示の px の点列（ペンはここまでに間引いたもの）。
  function entryOf(points) {
    const base = { src: draft.src, kind: draft.kind, color: draft.color, opacity: 1, lineWidth: draft.lineWidth };
    if (draft.kind === 'square' || draft.kind === 'circle') {
      const box = geometry().boxOf(draft.start, draft.current, { square: draft.shift });
      const rect = geometry().boxOf(toPdf([box[0], box[1]]), toPdf([box[2], box[3]]));
      return { ...base, ...geometry().rectOfShape({ kind: draft.kind, rect }) };
    }
    let paths;
    if (draft.kind === 'ink') {
      paths = [points.map(toPdf)];
    } else {
      const end = draft.shift ? geometry().snapAngle(draft.start, draft.current) : draft.current;
      paths = [[toPdf(draft.start), toPdf(end)]];
    }
    return { ...base, paths, ...geometry().rectOfShape({ kind: draft.kind, paths, lineWidth: draft.lineWidth }) };
  }

  // annotation-layer が描く下書き（そのページのぶんだけ）。
  function draftFor(index) {
    if (draft === null || draft.index !== index)
      return null;
    return entryOf(draft.points);
  }

  // 押した点から slop を超えて動いたか（ペンは途中の点も見る）。
  function moved(point, slop) {
    const far = (at) => Math.abs(at[0] - draft.start[0]) > slop || Math.abs(at[1] - draft.start[1]) > slop;
    return far(point) || draft.points.some(far);
  }

  // 離した。動いていなければ null（押しただけ）。動いていれば注釈にする entry（ペンは間引いてから）。
  function finish(point, shift, slop) {
    if (draft === null)
      return null;
    update(point, shift);
    const done = draft;
    let entry = null;
    if (moved(point, slop)) {
      const points = done.kind === 'ink' ? geometry().simplifyPath(done.points, geometry().SIMPLIFY_TOLERANCE) : done.points;
      entry = entryOf(points);
    }
    draft = null;
    return entry;
  }

  function cancel() {
    if (draft === null)
      return false;
    draft = null;
    return true;
  }

  function isDrawing() {
    return draft !== null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeDraft = { begin, update, finish, cancel, draftFor, isDrawing };
})(typeof window !== 'undefined' ? window : globalThis);
