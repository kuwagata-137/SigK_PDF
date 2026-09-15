(function (root) {
  'use strict';

  // 選択範囲の矩形（CSS px）と PDF の QuadPoints（pt）を行き来する純粋層
  // （spec-4-1 確定事項11〜13・事前調査 D）。DOM には触れない。
  //
  // 四角は PDF の /QuadPoints と同じ 8 つの数 [x1 y1 x2 y2 x3 y3 x4 y4] で、
  // 順序は UL・UR・LL・LR（左上・右上・左下・右下）に揃える。他のビューアの
  // 読み方（左下＝3 点目、右上＝2 点目）に合わせるためである。

  // 縦の範囲をフォントから決められないときの既定（pdf.js の TextLayer と同じ値）。
  const DEFAULT_ASCENT = 0.8;
  const DEFAULT_DESCENT = -0.2;

  // 下線は四角の下辺の少し上、取り消し線は中央（上辺からの割合）。
  const LINE_POSITION = { underline: 0.93, strikeout: 0.5 };

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  // 4 点（どの順でもよい）を UL・UR・LL・LR の軸に沿った四角にする。
  // 回転したページでは CSS の左上が PDF の左上ではないので、min/max で組み直す。
  function normalizeQuad(points) {
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const minX = round(Math.min(...xs));
    const maxX = round(Math.max(...xs));
    const minY = round(Math.min(...ys));
    const maxY = round(Math.max(...ys));
    return [minX, maxY, maxX, maxY, minX, minY, maxX, minY];
  }

  // .pdf-page 基準の CSS px の矩形 { left, top, right, bottom } を pt の四角にする。
  function cssRectToQuad(rect, viewport) {
    const corners = [
      viewport.convertToPdfPoint(rect.left, rect.top),
      viewport.convertToPdfPoint(rect.right, rect.top),
      viewport.convertToPdfPoint(rect.left, rect.bottom),
      viewport.convertToPdfPoint(rect.right, rect.bottom),
    ];
    return normalizeQuad(corners);
  }

  // 文字の進む方向（横）は DOM の四角、縦はフォントの ascent／descent から作る
  // （確定事項12）。文字が回っている・縦書きのときは DOM の四角をそのまま返す。
  function quadFromItem(quad, item, style) {
    const transform = item?.transform;
    if (!Array.isArray(transform) || transform.length < 6 || style?.vertical === true)
      return quad;
    const [a, b, c, d, , baseline] = transform;
    const angle = Math.atan2(b, a);
    if (Math.abs(angle) > 1e-6)
      return quad;
    const fontSize = Math.hypot(c, d);
    if (!(fontSize > 0))
      return quad;
    const ascent = style?.ascent > 0 ? style.ascent : DEFAULT_ASCENT;
    const descent = style?.descent < 0 ? style.descent : DEFAULT_DESCENT;
    const top = round(baseline + fontSize * ascent);
    const bottom = round(baseline + fontSize * descent);
    const minX = Math.min(quad[0], quad[4]);
    const maxX = Math.max(quad[2], quad[6]);
    return [minX, top, maxX, top, minX, bottom, maxX, bottom];
  }

  // 四角群の外接 [x1 y1 x2 y2]（左下と右上）。
  function unionRect(quads) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const quad of quads) {
      for (let index = 0; index < 8; index += 2) {
        minX = Math.min(minX, quad[index]);
        maxX = Math.max(maxX, quad[index]);
        minY = Math.min(minY, quad[index + 1]);
        maxY = Math.max(maxY, quad[index + 1]);
      }
    }
    return [round(minX), round(minY), round(maxX), round(maxY)];
  }

  // pt の点が四角群のどれかに入るか（軸に沿った四角として見る）。
  function hitTest(quads, point) {
    const [x, y] = point;
    return quads.some((quad) => {
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      return x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys);
    });
  }

  // pt の四角を CSS px の 4 点（UL・UR・LL・LR の順）にする。回転したページでは
  // 点の並びが画面上の左上から始まらないが、多角形として描くぶんには困らない。
  function quadToViewport(quad, viewport) {
    const points = [];
    for (let index = 0; index < 8; index += 2)
      points.push(viewport.convertToViewportPoint(quad[index], quad[index + 1]));
    return points;
  }

  // 下線・取り消し線の両端（CSS px）。UL→LL の辺と UR→LR の辺を t で内分する。
  function lineEndpoints(points, kind) {
    const t = LINE_POSITION[kind] ?? LINE_POSITION.strikeout;
    const [ul, ur, ll, lr] = points;
    return [
      [ul[0] + (ll[0] - ul[0]) * t, ul[1] + (ll[1] - ul[1]) * t],
      [ur[0] + (lr[0] - ur[0]) * t, ur[1] + (lr[1] - ur[1]) * t],
    ];
  }

  // 線の太さ（CSS px）。四角の高さの 1/14、最低 1px。
  function lineWidth(points) {
    const [ul, , ll] = points;
    const height = Math.hypot(ll[0] - ul[0], ll[1] - ul[1]);
    return Math.max(1, height / 14);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.markupQuads = {
    DEFAULT_ASCENT,
    DEFAULT_DESCENT,
    LINE_POSITION,
    normalizeQuad,
    cssRectToQuad,
    quadFromItem,
    unionRect,
    hitTest,
    quadToViewport,
    lineEndpoints,
    lineWidth,
  };
})(typeof window !== 'undefined' ? window : globalThis);
