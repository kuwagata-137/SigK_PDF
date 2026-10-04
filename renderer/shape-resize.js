(function (root) {
  'use strict';

  // つまみを引いたときの新しい形の純粋層（spec-4b-2 確定事項16〜19）。DOM に触れない。
  //
  // どれも「押したとき」からの動きで決める（押した点がつまみの中心から少しずれていても、つまみが指に付いてくる）。
  //   resized … 四角・丸の大きさ。押した点と今の点を回す前の座標へ戻し、掴んだ辺だけを動きの分だけ動かす（反対側は動かない）。
  //             辺は最小 MIN_SIDE で、反対側を越えて裏返さない。角＋Shift は押したときの縦と横の比を保つ。新しい箱の中心を
  //             回して戻すので、回した図形でも反対側が紙の上で動かない。
  //   endpointMoved … 直線・矢印の端。表示の座標で動きを足し、Shift なら小さい方の向き（横か縦。等しいときは横を残す）を 0 にする。
  //             2 つの端が MIN_LENGTH より近づくなら null（直前のまま）。
  //   rotatedBy … 回転のつまみ。中心から見た向きの変化ぶんだけ回す（表示で時計回りが正）。Shift で 15° 刻み。
  // 戻り値は updateAnnot に渡す patch（形が決まらなければ null）。

  const SHIFT_STEP = 15;
  // 直線・矢印の 2 つの端の最小の距離（pt）。矢じりの向きが決まらなくなるのを防ぐ。
  const MIN_LENGTH = 0.5;

  const CORNER_SIGNS = Object.freeze({ x1y1: [-1, -1], x2y1: [1, -1], x1y2: [-1, 1], x2y2: [1, 1] });
  const EDGE_SIGNS = Object.freeze({ x1: [-1, 0], x2: [1, 0], y1: [0, -1], y2: [0, 1] });

  function rotation() {
    return root.SigK.shapeRotation;
  }

  function geometry() {
    return root.SigK.shapeGeometry;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  // 片方の向きの新しい端（min・max）。sign は -1（小さい側を動かす）・1（大きい側）・0（動かさない）。
  function sideOf(min, max, sign, delta, minSide) {
    if (sign < 0)
      return [Math.min(min + delta, max - minSide), max];
    if (sign > 0)
      return [min, Math.max(max + delta, min + minSide)];
    return [min, max];
  }

  // 角＋Shift: 押したときの比を保ち、大きく変わった向きに合わせる。動かさない角（反対側）を据え置く。
  function keepRatio([x1, y1, x2, y2], [nx1, ny1, nx2, ny2], [sx, sy]) {
    const scale = Math.max((nx2 - nx1) / (x2 - x1), (ny2 - ny1) / (y2 - y1));
    const width = (x2 - x1) * scale;
    const height = (y2 - y1) * scale;
    return [sx < 0 ? x2 - width : x1, sy < 0 ? y2 - height : y1, sx < 0 ? x2 : x1 + width, sy < 0 ? y2 : y1 + height];
  }

  // 四角・丸の大きさ（確定事項16・17）。from・to は紙の座標の押した点と今の点。
  function resized(entry, handleId, from, to, { shift = false } = {}) {
    const signs = CORNER_SIGNS[handleId] ?? EDGE_SIGNS[handleId];
    if (signs === undefined)
      return null;
    const angle = rotation().angleOf(entry);
    const box = entry.rect;
    const start = rotation().toLocal(from, box, angle);
    const end = rotation().toLocal(to, box, angle);
    const minSide = geometry().MIN_SIDE;
    const [nx1, nx2] = sideOf(box[0], box[2], signs[0], end[0] - start[0], minSide);
    const [ny1, ny2] = sideOf(box[1], box[3], signs[1], end[1] - start[1], minSide);
    const local = shift && handleId in CORNER_SIGNS ? keepRatio(box, [nx1, ny1, nx2, ny2], signs) : [nx1, ny1, nx2, ny2];
    // 回す前の座標の新しい箱の中心を、元の中心まわりに回して紙へ戻す（反対側が紙の上で動かない）。
    const rect = rotation().recentered(box, local, angle).map(round);
    return geometry().rectOfShape({ kind: entry.kind, rect, lineWidth: entry.lineWidth, angle });
  }

  // Shift のときの動き: 小さい方の向きを 0（ちょうど等しいときは横を残す）。
  function lockAxis([dx, dy]) {
    return Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];
  }

  // 直線・矢印の端（確定事項18）。press・pointer は表示の座標、toPaper は表示 → 紙の変換。
  function endpointMoved(entry, end, press, pointer, viewport, { shift = false } = {}) {
    const index = end === 'start' ? 0 : 1;
    const [from, to] = entry.paths[0];
    const moving = index === 0 ? from : to;
    const fixed = index === 0 ? to : from;
    const startView = viewport.convertToViewportPoint(moving[0], moving[1]);
    const delta = [pointer[0] - press[0], pointer[1] - press[1]];
    const [dx, dy] = shift ? lockAxis(delta) : delta;
    const point = viewport.convertToPdfPoint(startView[0] + dx, startView[1] + dy).map(round);
    if (Math.hypot(point[0] - fixed[0], point[1] - fixed[1]) < MIN_LENGTH)
      return null;
    const path = index === 0 ? [point, [...fixed]] : [[...fixed], point];
    return { paths: [path], ...geometry().rectOfShape({ kind: entry.kind, paths: [path], lineWidth: entry.lineWidth }) };
  }

  // 回転のつまみ（確定事項19）。press・pointer・center は表示の座標。
  function rotatedBy(entry, press, pointer, center, { shift = false } = {}) {
    const turn = (Math.atan2(pointer[1] - center[1], pointer[0] - center[0]) - Math.atan2(press[1] - center[1], press[0] - center[0])) * 180 / Math.PI;
    const raw = rotation().angleOf(entry) + turn;
    const angle = shift ? rotation().snapAngle(raw, SHIFT_STEP) : rotation().normalizeAngle(Math.round(raw));
    // テキストは free-text-turn.js（今までの形は新しい形へ移す。spec-4b-4b 確定事項A2）。
    if (entry.kind === 'text')
      return root.SigK.freeTextTurn.anglePatch(entry, angle);
    return { angle, ...geometry().rectOfShape({ kind: entry.kind, rect: entry.rect, lineWidth: entry.lineWidth, angle }) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeResize = { SHIFT_STEP, MIN_LENGTH, resized, endpointMoved, rotatedBy, lockAxis };
})(typeof window !== 'undefined' ? window : globalThis);
