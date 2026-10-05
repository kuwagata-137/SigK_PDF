(function (root) {
  'use strict';

  // ×印の形の純粋層（spec-4b-5a 確定事項2・9・21・35・39）。DOM にも pdf.js にも触れない。
  //
  // ×印は回す前の箱 rect と角度 angle で持ち、対角線 2 本（紙の座標で 左上→右下、右上→左下）を引く。保存は /Ink の 2 本を、回した
  // 位置の紙の座標で書く（外観に /Matrix を使わない）。読み戻しは、その 2 本の形（同じ長さで真ん中で交わる）から箱と角度を求める
  // （決定61 ②。独自の欄を使わない）。保存の座標は小数 4 桁（2 桁だと、小さな ×印で角度の読み戻しが 0.01° を超えてずれるため）。

  // 2 本の長さの差の許し（長い方に対する割合）と、距離の許し（pt）。箱の辺の最小（pt。shape-geometry の MIN_SIDE と同じ）。
  const LENGTH_TOLERANCE = 0.005;
  const DISTANCE_TOLERANCE = 0.02;
  const MIN_SIDE = 1;

  function rotation() {
    return root.SigK.shapeRotation;
  }

  function round(value, digits = 2) {
    const scale = 10 ** digits;
    const rounded = Math.round(value * scale) / scale;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function distance(a, b) {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  function middle(a, b) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }

  // 回す前の箱の対角線 2 本（左上→右下、右上→左下。紙の座標は y が上なので、左上は (x1, y2)）。
  function localDiagonals([x1, y1, x2, y2]) {
    return [[[x1, y2], [x2, y1]], [[x2, y2], [x1, y1]]];
  }

  // 回した位置の対角線 2 本（保存の /InkList。小数 4 桁）。
  function diagonalsOf(rect, angle = 0) {
    const center = rotation().centerOf(rect);
    return localDiagonals(rect).map((line) => line.map((point) => rotation().rotatePoint(point, center, angle).map((value) => round(value, 4))));
  }

  // 保存の /Rect（と /BBox）。回した 4 隅の外接に線幅の半分（丸い端のはみ出し）を足す。
  function savedRectOf(rect, angle, lineWidth) {
    const pad = lineWidth / 2;
    const [x1, y1, x2, y2] = rotation().boundsOf(rect, angle);
    return [round(x1 - pad), round(y1 - pad), round(x2 + pad), round(y2 + pad)];
  }

  // /Ink の線の並びから ×印の箱と角度を読む（確定事項39）。線が 2 本・それぞれ 2 点・同じ長さ・中点が同じ・箱の 2 辺が MIN_SIDE 以上
  // なら { rect, angle }、違えば null。箱の向きは 1 本目の始点から 2 本目の始点への向き（箱の上の辺）。
  function crossOf(paths) {
    if (!Array.isArray(paths) || paths.length !== 2 || !paths.every((line) => Array.isArray(line) && line.length === 2))
      return null;
    const [[a, b], [c, d]] = paths;
    const first = distance(a, b);
    const second = distance(c, d);
    if (Math.abs(first - second) > Math.max(LENGTH_TOLERANCE * Math.max(first, second), DISTANCE_TOLERANCE))
      return null;
    const m1 = middle(a, b);
    const m2 = middle(c, d);
    if (distance(m1, m2) > DISTANCE_TOLERANCE)
      return null;
    const width = distance(a, c);
    const height = distance(a, d);
    if (width < MIN_SIDE || height < MIN_SIDE)
      return null;
    // 箱の +x の向き a→c は、画面で時計回りに angle 回すと紙の座標で (cos, −sin) になる（shape-rotation.js の rotatePoint）。
    const angle = rotation().normalizeAngle((Math.atan2(-(c[1] - a[1]), c[0] - a[0]) * 180) / Math.PI);
    const [cx, cy] = middle(m1, m2);
    const rect = [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2].map((value) => round(value));
    return { rect, angle };
  }

  // 点（紙の座標）から ×印の対角線までの近さ。回した ×印は点を回す前の座標へ戻して見る（確定事項21）。
  function distanceTo(entry, point) {
    const local = rotation().toLocal(point, entry.rect, rotation().angleOf(entry));
    const segment = root.SigK.shapeGeometry.distanceToSegment;
    return Math.min(...localDiagonals(entry.rect).map(([from, to]) => segment(local, from, to)));
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.crossGeometry = { LENGTH_TOLERANCE, DISTANCE_TOLERANCE, MIN_SIDE, localDiagonals, diagonalsOf, savedRectOf, crossOf, distanceTo };
})(typeof window !== 'undefined' ? window : globalThis);
