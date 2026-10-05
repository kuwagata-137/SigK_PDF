(function (root) {
  'use strict';

  // 描いている途中の多角形（spec-4b-5a 確定事項13〜15。見本 screenshots/phase4b-5a-shapes.png）。
  //
  // 頂点は紙の座標で持つ（表示倍率を変えても途中の形が変わらない）。近さ（閉じる・重なる）とずらし（Shift の 45°）は表示の px で見る。
  // 履歴にも選択にも触れず、確定した形（{ closed, vertices }）を返すだけ。書き込みにして積むのは annotate-polygon.js。
  // 下書きの絵（置いた辺と、頂点の白い丸・次の辺の点線・閉じられる範囲の輪）は svgOf が組み、annotation-layer.js が描く。

  // 始点に閉じる近さ・続けて同じ所に置いたとみなす近さ・置かない小ささ（表示の px）と、点の大きさ（px）。
  const CLOSE_RADIUS = 12;
  const DUPLICATE_RADIUS = 2;
  const MIN_EXTENT = 3;
  const VERTEX_RADIUS = 4.5;
  const FIRST_RADIUS = 6.5;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // { index, src, viewport, vertices, cursor }
  let draft = null;

  function geometry() {
    return root.SigK.shapeGeometry;
  }

  function toPaper(viewport, point) {
    return geometry().roundPoint(viewport.convertToPdfPoint(point[0], point[1]));
  }

  function toView(viewport, point) {
    return viewport.convertToViewportPoint(point[0], point[1]);
  }

  function near(a, b, radius) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]) <= radius;
  }

  // Shift なら直前の頂点から 45° 刻みの向きにそろえた点（表示の px。長さは保つ。確定事項14）。
  function aimed(point, shift) {
    if (!shift || draft === null)
      return point;
    return geometry().snapAngle(toView(draft.viewport, draft.vertices.at(-1)), point);
  }

  // 1 つ目の頂点を置いて描き始める。point は表示の px。
  function begin({ index, src, viewport, point }) {
    draft = { index, src, viewport, vertices: [toPaper(viewport, point)], cursor: null };
    return true;
  }

  // 頂点を置く（左ボタンを離した所。確定事項13・15）。戻り値は 'ignored'（ほかのページ）・'duplicate'（直前の頂点と重なる）・
  // 'close'（3 つ以上置いたあとで始点の近く）・'added'。
  function place({ index, viewport, point, shift = false }) {
    if (draft === null || index !== draft.index)
      return 'ignored';
    draft.viewport = viewport;
    const at = aimed(point, shift);
    if (draft.vertices.length >= 3 && near(toView(viewport, draft.vertices[0]), at, CLOSE_RADIUS))
      return 'close';
    if (near(toView(viewport, draft.vertices.at(-1)), at, DUPLICATE_RADIUS))
      return 'duplicate';
    draft.vertices.push(toPaper(viewport, at));
    draft.cursor = null;
    return 'added';
  }

  // マウスの位置（次の辺の下見）。ほかのページなら下見を消す。
  function hover({ index, viewport, point, shift = false }) {
    if (draft === null)
      return false;
    if (index !== draft.index) {
      draft.cursor = null;
      return true;
    }
    draft.viewport = viewport;
    draft.cursor = toPaper(viewport, aimed(point, shift));
    return true;
  }

  // 確定する形。閉じるなら 3 つ以上、開いたままなら 2 つ以上（2 つなら直線にするのは呼ぶ側）。外接が表示で MIN_EXTENT 未満なら null。
  // 描きかけは捨てる。
  function finish(closed) {
    const done = draft;
    draft = null;
    if (done === null || done.vertices.length < (closed ? 3 : 2))
      return null;
    const shown = done.vertices.map((point) => toView(done.viewport, point));
    const xs = shown.map((point) => point[0]);
    const ys = shown.map((point) => point[1]);
    if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < MIN_EXTENT)
      return null;
    return { index: done.index, src: done.src, closed, vertices: done.vertices.map((point) => [...point]) };
  }

  function cancel() {
    if (draft === null)
      return false;
    draft = null;
    return true;
  }

  // そのページの描きかけ（{ vertices, cursor }）。無ければ null。
  function previewOf(index) {
    if (draft === null || draft.index !== index)
      return null;
    return { vertices: draft.vertices.map((point) => [...point]), cursor: draft.cursor === null ? null : [...draft.cursor] };
  }

  function element(doc, tag, attributes) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes))
      node.setAttribute(name, String(value));
    return node;
  }

  // 下書きの印（確定事項13）。次の辺の点線（線の色・不透明度 0.7・太さの半分で最小 1px）、頂点の白い丸（始点は大きめ）、3 つ以上なら
  // 始点のまわりの閉じられる範囲の輪。look は { color, lineWidth }。
  function svgOf(doc, preview, viewport, look) {
    const group = element(doc, 'g', { class: 'annot-draft-marks' });
    const points = preview.vertices.map((point) => toView(viewport, point));
    if (preview.cursor !== null) {
      const [x1, y1] = points.at(-1);
      const [x2, y2] = toView(viewport, preview.cursor);
      const width = Math.max(1, (look.lineWidth * (viewport.scale ?? 1)) / 2);
      group.append(element(doc, 'line', { x1, y1, x2, y2, class: 'next', stroke: look.color, 'stroke-width': width, 'stroke-dasharray': '6 5', opacity: 0.7 }));
    }
    if (points.length >= 3)
      group.append(element(doc, 'circle', { cx: points[0][0], cy: points[0][1], r: CLOSE_RADIUS, class: 'ring' }));
    points.forEach(([cx, cy], at) => group.append(element(doc, 'circle', { cx, cy, r: at === 0 ? FIRST_RADIUS : VERTEX_RADIUS, class: 'vertex' })));
    return group;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.polygonDraft = {
    CLOSE_RADIUS,
    DUPLICATE_RADIUS,
    MIN_EXTENT,
    begin,
    place,
    hover,
    finish,
    cancel,
    previewOf,
    svgOf,
    isActive: () => draft !== null,
    indexOf: () => draft?.index ?? null,
  };
})(typeof window !== 'undefined' ? window : globalThis);
