(function (root) {
  'use strict';

  // 選んだ四角・丸・直線・矢印の枠とつまみの位置（spec-4b-2 確定事項10・11・13・15・24）。DOM に触れない純粋層。
  //
  // 位置は表示の座標（.pdf-page 基準の CSS px）。四角・丸は、回す前の箱の紙の +x・+y（上）の向きを表示へ直した単位ベクトル
  // ux・uy を作り、箱の中心 C から「ux × 横 ＋ uy × 縦」で置く（回転とページの回転を一度に扱える。余白とつまみの離れは px）。
  // つまみの id は紙の向きで付ける: 角は x1y1（左下）・x2y1・x1y2・x2y2（右上）、辺の中点は x1・x2・y1（下）・y2（上）、回転は rotate、
  // 直線・矢印の端は start・end。回転のつまみは上の辺の外で、見える範囲から出るときだけ下の辺の外。テキストの左右の幅のつまみ
  // （left・right。種類は width）は free-text-handles.js が置く（spec-4b-4a 確定事項F）。

  // 枠の余白（px。今の選択の枠と同じ）・つまみの半径・回転のつまみの半径と枠からの離れ・当たりの半径・辺のつまみを隠す長さ。
  const FRAME_PADDING = 3;
  const HANDLE_RADIUS = 5;
  const ROTATE_RADIUS = 8;
  const ROTATE_GAP = 26;
  const HIT_RADIUS = 7;
  const EDGE_HANDLE_MIN = 24;

  const CORNERS = Object.freeze({ x1y1: [-1, -1], x2y1: [1, -1], x1y2: [-1, 1], x2y2: [1, 1] });
  const EDGES = Object.freeze({ x1: [-1, 0], x2: [1, 0], y1: [0, -1], y2: [0, 1] });
  // 重なるときに先に当てる順（確定事項15）。
  // 吹き出しのしっぽの先（tip。spec-4b-4b 確定事項F4）と多角形の頂点（vertex。spec-4b-5a 確定事項22）は角のつまみと同じ順。
  const PRIORITY = Object.freeze({ rotate: 0, corner: 1, tip: 1, vertex: 1, edge: 2, width: 2, end: 3 });
  const RESIZE_CURSORS = Object.freeze(['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']);

  function rotation() {
    return root.SigK.shapeRotation;
  }

  // 箱で持つ図形（四角・丸・×印。×印は spec-4b-5a 確定事項20）。
  function isBoxed(entry) {
    return entry?.kind === 'square' || entry?.kind === 'circle' || entry?.kind === 'cross';
  }

  function isLine(entry) {
    return entry?.kind === 'line' || entry?.kind === 'arrow';
  }

  function isText(entry) {
    return entry?.kind === 'text' && root.SigK.freeTextHandles !== undefined;
  }

  function isPolygon(entry) {
    return entry?.kind === 'polygon' && Array.isArray(entry.paths) && root.SigK.polygonHandles !== undefined;
  }

  // つまみを出す書き込みか（四角・丸・×印・直線・矢印・テキスト・多角形で、表示のみでないもの）。
  function hasHandles(entry) {
    return entry?.readonly !== true && (isBoxed(entry) || isText(entry) || isPolygon(entry) || (isLine(entry) && Array.isArray(entry.paths)));
  }

  function unit([x, y]) {
    const length = Math.hypot(x, y);
    return length > 0 ? [x / length, y / length] : [0, 0];
  }

  // 回した箱の、表示の座標での中心と軸（紙の +x・+y の向き）と半分の大きさ（px）。
  function boxFrameOf(entry, viewport) {
    const [x1, y1, x2, y2] = entry.rect;
    const center = rotation().centerOf(entry.rect);
    const angle = rotation().angleOf(entry);
    const toView = (point) => viewport.convertToViewportPoint(...rotation().rotatePoint(point, center, angle));
    const c = toView(center);
    const along = (point) => {
      const [x, y] = toView(point);
      return unit([x - c[0], y - c[1]]);
    };
    const scale = viewport.scale ?? 1;
    return {
      c,
      ux: along([center[0] + 1, center[1]]),
      uy: along([center[0], center[1] + 1]),
      halfWidth: ((x2 - x1) / 2) * scale,
      halfHeight: ((y2 - y1) / 2) * scale,
    };
  }

  function place({ c, ux, uy }, lx, ly) {
    return [c[0] + ux[0] * lx + uy[0] * ly, c[1] + ux[1] * lx + uy[1] * ly];
  }

  // 表示の向き d に合う大きさ変えのカーソル（左右・斜め・上下・斜めの 4 つ。確定事項24）。
  function resizeCursorOf([dx, dy]) {
    const degrees = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 180;
    return RESIZE_CURSORS[Math.round(degrees / 45) % 4];
  }

  // 中心 at・半径 r の丸が、見える範囲 room（{ left, top, right, bottom }。表示の座標）に収まるか。room が無ければ収まるとみなす。
  function fits(at, room, r) {
    return room === null || (at[0] - r >= room.left && at[1] - r >= room.top && at[0] + r <= room.right && at[1] + r <= room.bottom);
  }

  // 回した箱の破線の枠と、回転のつまみとその枝（四角・丸と多角形で同じ。spec-4b-2 確定事項10、spec-4b-5a 確定事項22）。
  // 回転のつまみは回す前の箱の上の辺の外で、そこが見える範囲から出て、下の辺の外なら収まるときだけ下の辺の外に出す
  // （1 ページ目の上端の近くの図形でも見えて押せるように。回し方は押した点の向きの変化なので、どちらでも同じに回る）。
  function turnedFrameOf(entry, viewport, room) {
    const frame = boxFrameOf(entry, viewport);
    const w = frame.halfWidth + FRAME_PADDING;
    const h = frame.halfHeight + FRAME_PADDING;
    const side = !fits(place(frame, 0, h + ROTATE_GAP), room, ROTATE_RADIUS) && fits(place(frame, 0, -(h + ROTATE_GAP)), room, ROTATE_RADIUS) ? -1 : 1;
    return {
      box: { frame, w, h },
      frame: { type: 'polygon', points: [[-w, h], [w, h], [w, -h], [-w, -h]].map(([lx, ly]) => place(frame, lx, ly)) },
      stem: { from: place(frame, 0, side * h), to: place(frame, 0, side * (h + ROTATE_GAP - ROTATE_RADIUS)) },
      rotate: { id: 'rotate', kind: 'rotate', at: place(frame, 0, side * (h + ROTATE_GAP)), cursor: 'rotate' },
    };
  }

  function boxHandles(entry, viewport, room) {
    const turned = turnedFrameOf(entry, viewport, room);
    const { frame, w, h } = turned.box;
    const handle = (id, kind, [sx, sy]) => {
      const direction = [frame.ux[0] * sx + frame.uy[0] * sy, frame.ux[1] * sx + frame.uy[1] * sy];
      return { id, kind, at: place(frame, sx * w, sy * h), cursor: resizeCursorOf(direction) };
    };
    const handles = Object.entries(CORNERS).map(([id, sign]) => handle(id, 'corner', sign));
    for (const [id, sign] of Object.entries(EDGES)) {
      const across = sign[0] === 0 ? frame.halfWidth * 2 : frame.halfHeight * 2;
      if (across >= EDGE_HANDLE_MIN)
        handles.push(handle(id, 'edge', sign));
    }
    handles.push(turned.rotate);
    return { frame: turned.frame, stem: turned.stem, handles };
  }

  function lineHandles(entry, viewport) {
    const [from, to] = entry.paths[0].map((point) => viewport.convertToViewportPoint(point[0], point[1]));
    return {
      frame: { type: 'line', from, to },
      stem: null,
      handles: [{ id: 'start', kind: 'end', at: from, cursor: 'move' }, { id: 'end', kind: 'end', at: to, cursor: 'move' }],
    };
  }

  // 枠とつまみ。つまみを出さない書き込みは null（annotation-frame.js が今の四角の枠を描く）。room はつまみが見える範囲
  // （表示の座標。annotation-frame.js が表示域から求める。null ならどこでも見えるとみなす）。
  function handlesOf(entry, viewport, room = null) {
    if (!hasHandles(entry))
      return null;
    if (isText(entry))
      return root.SigK.freeTextHandles.handlesOf(entry, viewport, room);
    if (isPolygon(entry))
      return root.SigK.polygonHandles.handlesOf(entry, viewport, room);
    return isBoxed(entry) ? boxHandles(entry, viewport, room) : lineHandles(entry, viewport);
  }

  // 点（表示の座標）に当たるつまみ。半径 HIT_RADIUS 以内で、回転 → 角 → 辺 → 端 の順、同じ順なら近いもの。
  function handleAt(handles, point, radius = HIT_RADIUS) {
    let best = null;
    for (const handle of handles ?? []) {
      const distance = Math.hypot(handle.at[0] - point[0], handle.at[1] - point[1]);
      if (distance > radius)
        continue;
      const rank = PRIORITY[handle.kind];
      if (best === null || rank < best.rank || (rank === best.rank && distance < best.distance))
        best = { handle, rank, distance };
    }
    return best === null ? null : best.handle;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeHandles = {
    FRAME_PADDING,
    HANDLE_RADIUS,
    ROTATE_RADIUS,
    ROTATE_GAP,
    HIT_RADIUS,
    EDGE_HANDLE_MIN,
    hasHandles,
    handlesOf,
    turnedFrameOf,
    handleAt,
    resizeCursorOf,
    fits,
  };
})(typeof window !== 'undefined' ? window : globalThis);
