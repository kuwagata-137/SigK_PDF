(function (root) {
  'use strict';

  // 線の始点合わせの点（spec-4b-5a 確定事項19。CheckListMaker の始点スナップ）。DOM に触れない純粋層。
  //
  // 対象は直せる書き込みの端・角・頂点: 直線・矢印の両端、四角・×印の 4 隅（回した位置）、多角形の頂点（回した位置）。丸・テキスト・
  // 吹き出し・ペン・ノート・マークアップ・表示のみは対象外。近さは表示の px で見る（11px 以内）。

  const SNAP_RADIUS = 11;

  function rotation() {
    return root.SigK.shapeRotation;
  }

  // 書き込み 1 件の吸い付く点（紙の座標）。対象外なら空。
  function pointsOf(entry) {
    if (entry === null || entry === undefined || entry.readonly === true)
      return [];
    switch (entry.kind) {
      case 'line':
      case 'arrow': return Array.isArray(entry.paths) ? entry.paths[0].map((point) => [...point]) : [];
      case 'square':
      case 'cross': return rotation().cornersOf(entry.rect, rotation().angleOf(entry));
      case 'polygon': return root.SigK.polygonGeometry.worldVertices(entry, 4);
      default: return [];
    }
  }

  // 表示の点 point にいちばん近い吸い付く点（紙の座標）。radius（表示の px）以内に無ければ null。
  function nearest(entries, viewport, point, radius = SNAP_RADIUS) {
    let best = null;
    let bestDistance = Infinity;
    for (const entry of entries ?? []) {
      for (const target of pointsOf(entry)) {
        const [x, y] = viewport.convertToViewportPoint(target[0], target[1]);
        const distance = Math.hypot(x - point[0], y - point[1]);
        if (distance <= radius && distance < bestDistance) {
          best = [...target];
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.lineSnap = { SNAP_RADIUS, pointsOf, nearest };
})(typeof window !== 'undefined' ? window : globalThis);
