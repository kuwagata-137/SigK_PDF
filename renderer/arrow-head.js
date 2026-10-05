(function (root) {
  'use strict';

  // 矢印の先の形の純粋層（spec-4-3 確定事項10、spec-4b-5a 確定事項4・7・8・25）。DOM にも pdf.js にも触れない。
  //
  // 先は 2 つ。開いた矢じり（head: 'open'。今まで保存した矢印と、他のアプリの OpenArrow）と、塗った三角（head を持たない新しい矢印。
  // 決定61 ①）。紙の座標（pt）で点を返す。保存の外観は worker/arrow-head.js が同じ式を持ち、一致はテストで見張る
  // （プロセスが違うので import できない）。
  //   開いた矢じり … 翼の長さ max(ARROW_MIN_LENGTH, 線幅 × ARROW_LENGTH_RATIO)、線からの開き ARROW_ANGLE
  //   塗った三角   … 長さ max(CLOSED_MIN_LENGTH, 線幅 × CLOSED_LENGTH_RATIO)、開き CLOSED_ANGLE。軸は三角の底の中点 base で止める

  const ARROW_MIN_LENGTH = 9;
  const ARROW_LENGTH_RATIO = 6;
  const ARROW_ANGLE = Math.PI / 6;
  const CLOSED_MIN_LENGTH = 12;
  const CLOSED_LENGTH_RATIO = 4;
  const CLOSED_ANGLE = Math.PI / 7;

  // 塗った三角か（矢印で head が 'open' でないもの）。
  function isClosed(entry) {
    return entry?.kind === 'arrow' && entry.head !== 'open';
  }

  function wings(from, to, length, opening) {
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const wing = (turn) => [to[0] + Math.cos(angle + turn) * length, to[1] + Math.sin(angle + turn) * length];
    return [wing(Math.PI - opening), wing(-(Math.PI - opening))];
  }

  // 開いた矢じりの翼 2 点（終点 to から線の逆向きへ開く）。
  function arrowHead(from, to, lineWidth) {
    return wings(from, to, Math.max(ARROW_MIN_LENGTH, lineWidth * ARROW_LENGTH_RATIO), ARROW_ANGLE);
  }

  // 塗った三角。left・right は底の 2 角、base は軸を止める底の中点（先から長さ × cos(開き) 戻した所）。
  function closedHead(from, to, lineWidth) {
    const length = Math.max(CLOSED_MIN_LENGTH, lineWidth * CLOSED_LENGTH_RATIO);
    const [left, right] = wings(from, to, length, CLOSED_ANGLE);
    const back = length * Math.cos(CLOSED_ANGLE);
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    return { left, right, base: [to[0] - Math.cos(angle) * back, to[1] - Math.sin(angle) * back] };
  }

  // 先の輪郭の点列（当たりと外接に使う）。開いた矢じりは 翼 → 終点 → 翼、塗った三角は閉じた 3 角。
  function outlineOf(from, to, lineWidth, closed) {
    if (!closed) {
      const [left, right] = arrowHead(from, to, lineWidth);
      return [left, to, right];
    }
    const { left, right } = closedHead(from, to, lineWidth);
    return [left, to, right, left];
  }

  // 点が三角 a・b・c の中（辺の上を含む）か。
  function inTriangle(point, a, b, c) {
    const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = cross(a, b, point);
    const d2 = cross(b, c, point);
    const d3 = cross(c, a, point);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }

  // 塗った三角の中に点があるか。
  function insideHead(point, from, to, lineWidth) {
    const { left, right } = closedHead(from, to, lineWidth);
    return inTriangle(point, left, to, right);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.arrowHead = {
    ARROW_MIN_LENGTH,
    ARROW_LENGTH_RATIO,
    ARROW_ANGLE,
    CLOSED_MIN_LENGTH,
    CLOSED_LENGTH_RATIO,
    CLOSED_ANGLE,
    isClosed,
    arrowHead,
    closedHead,
    outlineOf,
    inTriangle,
    insideHead,
  };
})(typeof window !== 'undefined' ? window : globalThis);
