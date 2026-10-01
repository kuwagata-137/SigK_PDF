(function (root) {
  'use strict';

  // 範囲選択の箱と、箱に完全に収まる書き込み（spec-4b-3a 確定事項D3・D4）。純関数だけを持つ。座標はそのページの表示の座標（CSS px）。

  // 押した点と今の点から箱を作り、紙（幅 width・高さ height）の中に収める。
  function boxOf([x1, y1], [x2, y2], { width = Infinity, height = Infinity } = {}) {
    const clamp = (value, max) => Math.min(Math.max(value, 0), max);
    const left = clamp(Math.min(x1, x2), width);
    const top = clamp(Math.min(y1, y2), height);
    const right = clamp(Math.max(x1, x2), width);
    const bottom = clamp(Math.max(y1, y2), height);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function contains(box, bounds) {
    return bounds.x >= box.x && bounds.y >= box.y && bounds.x + bounds.width <= box.x + box.width && bounds.y + bounds.height <= box.y + box.height;
  }

  // 箱に完全に収まる書き込みの鍵（entries の順＝描く順）。表示のみは選ばない（決定39 ⑤）。boundsOf(entry) は外接（CSS px）。
  function enclosedKeys(entries, box, boundsOf) {
    return entries
      .filter((entry) => entry.readonly !== true && contains(box, boundsOf(entry)))
      .map((entry) => entry.ref ?? entry.id);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationMarquee = { boxOf, enclosedKeys };
})(typeof window !== 'undefined' ? window : globalThis);
