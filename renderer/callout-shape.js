(function (root) {
  'use strict';

  // 吹き出しの輪郭の純粋層（spec-4b-4b 確定事項E・D4・C4）。DOM に触れない。保存側の worker/callout-outline.js も同じ式で、
  // 一致はテストで見張る（プロセスが違うので読み込み合わない）。
  //
  // 回す前の箱 [x1 y1 x2 y2]（紙の座標。y が上）と、回す前の座標へ戻したしっぽの先 t で決める。置いた向きの 4 方向には左右されない。
  //   出る辺   … 箱の中心から t への (dx/幅, dy/高さ) の絶対値の大きい方（等しければ上下）。CheckListMaker と同じ
  //   角丸     … min(10, 幅/2, 高さ/2)
  //   付け根   … 半幅は max(10, 大きさ×0.6) を辺の長さ/2−角丸で抑えたもの。それが 3pt（HALF_FLOOR）に満たない短い辺だけ、角丸を減らして
  //              半幅を 3pt にする（しっぽが線のように細くならないように）。中心は t をその辺に下ろした点を、角丸と半幅の内側に収める
  //   t が箱の中（辺の上を含む）なら、しっぽを描かない
  // 輪郭は上の辺の左から時計回りの 1 本（角は 4 分の 1 円のベジェ。しっぽの辺で付け根→先→付け根を挟む）。枠線は箱の内側に描くので、
  // 線の太さの半分（inset）だけ内へ寄せた箱で組む（先は動かさない）。

  const RADIUS_MAX = 10;
  const HALF_MIN = 10;
  const HALF_RATIO = 0.6;
  // 付け根の半幅の下限（pt）。角丸を先に決めると短い辺のしっぽが細くなりすぎるので、ここまでは角丸を減らして半幅を保つ。
  const HALF_FLOOR = 3;
  // 4 分の 1 円をベジェで描くときの制御点の離れ（半径に掛ける）。
  const KAPPA = 0.5523;
  // 置いた直後の先（確定事項D4）: 箱の左上から右へ min(幅×0.25, 40)、下へ 高さ＋大きさ×1.6。
  const TIP_RIGHT_RATIO = 0.25;
  const TIP_RIGHT_MAX = 40;
  const TIP_DOWN_RATIO = 1.6;

  function centerOf([x1, y1, x2, y2]) {
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }

  function inside([x1, y1, x2, y2], [x, y]) {
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  }

  function sideOf(box, [tx, ty]) {
    const [cx, cy] = centerOf(box);
    const dx = (tx - cx) / (box[2] - box[0]);
    const dy = (ty - cy) / (box[3] - box[1]);
    if (Math.abs(dy) >= Math.abs(dx))
      return dy > 0 ? 'top' : 'bottom';
    return dx > 0 ? 'right' : 'left';
  }

  // しっぽ { side, half, radius, base }。t が箱の中なら null。
  function tailOf(box, tip, fontSize) {
    if (inside(box, tip))
      return null;
    const [x1, y1, x2, y2] = box;
    const side = sideOf(box, tip);
    const across = side === 'top' || side === 'bottom';
    const [lo, hi] = across ? [x1, x2] : [y1, y2];
    // 角丸を先に決め、半幅を辺の長さ/2−角丸で抑える。半幅が HALF_FLOOR に満たないときだけ、角丸を減らして半幅を HALF_FLOOR にする。
    const wanted = Math.max(HALF_MIN, fontSize * HALF_RATIO);
    const room = (hi - lo) / 2;
    const corner = Math.max(0, Math.min(RADIUS_MAX, (x2 - x1) / 2, (y2 - y1) / 2));
    const half = Math.min(wanted, Math.max(room - corner, Math.min(HALF_FLOOR, room)));
    const radius = Math.max(0, Math.min(corner, room - half));
    const along = Math.min(hi - radius - half, Math.max(lo + radius + half, across ? tip[0] : tip[1]));
    const edge = { top: y2, bottom: y1, right: x2, left: x1 }[side];
    return { side, half, radius, base: across ? [along, edge] : [edge, along] };
  }

  // 輪郭の点の並び [{ op: 'M'|'L'|'C'|'Z', points }]（回す前の紙の座標）。
  function outlineOf(box, tip, { fontSize, inset = 0 }) {
    const shrunk = [box[0] + inset, box[1] + inset, box[2] - inset, box[3] - inset];
    const tail = tailOf(box, tip, fontSize) === null ? null : tailOf(shrunk, tip, fontSize);
    const [x1, y1, x2, y2] = shrunk;
    const r = tail === null ? Math.max(0, Math.min(RADIUS_MAX, (x2 - x1) / 2, (y2 - y1) / 2)) : tail.radius;
    const k = KAPPA * r;
    const segments = [{ op: 'M', points: [[x1 + r, y2]] }];
    const line = (x, y) => segments.push({ op: 'L', points: [[x, y]] });
    const curve = (a, b, c) => segments.push({ op: 'C', points: [a, b, c] });
    // side の辺でしっぽを挟む。sign は輪郭の進む向き（辺に沿って +1 か −1）。
    const insertTail = (side, sign) => {
      if (tail === null || tail.side !== side)
        return;
      const [bx, by] = tail.base;
      const across = side === 'top' || side === 'bottom';
      const at = (offset) => (across ? [bx + offset, by] : [bx, by + offset]);
      line(...at(-sign * tail.half));
      line(tip[0], tip[1]);
      line(...at(sign * tail.half));
    };
    insertTail('top', 1);
    line(x2 - r, y2);
    curve([x2 - r + k, y2], [x2, y2 - r + k], [x2, y2 - r]);
    insertTail('right', -1);
    line(x2, y1 + r);
    curve([x2, y1 + r - k], [x2 - r + k, y1], [x2 - r, y1]);
    insertTail('bottom', -1);
    line(x1 + r, y1);
    curve([x1 + r - k, y1], [x1, y1 + r - k], [x1, y1 + r]);
    insertTail('left', 1);
    line(x1, y2 - r);
    curve([x1, y2 - r + k], [x1 + r - k, y2], [x1 + r, y2]);
    segments.push({ op: 'Z', points: [] });
    return segments;
  }

  // 回した吹き出しの先を、箱の中心のまわりに回す前の座標へ戻す。
  function localTipOf(entry) {
    const angle = Number.isFinite(entry.angle) ? entry.angle : 0;
    return angle === 0 ? [...entry.callout.tip] : root.SigK.shapeRotation.rotatePoint(entry.callout.tip, centerOf(entry.rect), -angle);
  }

  // 置いた直後の先（紙の座標）。origin は箱の左上（置いた向きでの左上）、size は表示の向きの大きさ。
  function defaultTipOf(origin, { width, height }, rotation, fontSize) {
    const right = Math.min(width * TIP_RIGHT_RATIO, TIP_RIGHT_MAX);
    return root.SigK.freeTextLayout.shiftOrigin(origin, rotation, [right, height + fontSize * TIP_DOWN_RATIO]);
  }

  // 点 p が三角 a・b・c の中（辺の上を含む）か。
  function inTriangle(p, a, b, c) {
    const cross = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    const d1 = cross(p, a, b);
    const d2 = cross(p, b, c);
    const d3 = cross(p, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }

  // しっぽの三角に点（紙の座標）が当たるか（確定事項C4）。tolerance（pt）を渡すと、しっぽの 2 辺から tolerance 以内の点にも当たる
  // （先へ細る所も押せるように。annotation-hit.js が線と同じ余裕を渡す。決定59 の直し）。
  function hitsTail(entry, point, tolerance = 0) {
    const tip = localTipOf(entry);
    const tail = tailOf(entry.rect, tip, entry.fontSize);
    if (tail === null)
      return false;
    const angle = Number.isFinite(entry.angle) ? entry.angle : 0;
    const local = angle === 0 ? point : root.SigK.shapeRotation.rotatePoint(point, centerOf(entry.rect), -angle);
    const across = tail.side === 'top' || tail.side === 'bottom';
    const [bx, by] = tail.base;
    const a = across ? [bx - tail.half, by] : [bx, by - tail.half];
    const b = across ? [bx + tail.half, by] : [bx, by + tail.half];
    if (inTriangle(local, a, b, tip))
      return true;
    const distance = root.SigK.shapeGeometry.distanceToSegment;
    return tolerance > 0 && (distance(local, a, tip) <= tolerance || distance(local, b, tip) <= tolerance);
  }

  // 箱と先を囲む範囲（回す前の座標）。先が箱の中なら箱。
  function extentOf(box, tip) {
    if (inside(box, tip))
      return [...box];
    return [Math.min(box[0], tip[0]), Math.min(box[1], tip[1]), Math.max(box[2], tip[0]), Math.max(box[3], tip[1])];
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.calloutShape = { RADIUS_MAX, HALF_MIN, HALF_RATIO, HALF_FLOOR, KAPPA, sideOf, tailOf, outlineOf, localTipOf, defaultTipOf, hitsTail, extentOf };
})(typeof window !== 'undefined' ? window : globalThis);
