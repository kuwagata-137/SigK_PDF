(function (root) {
  'use strict';

  // トリミングの枠を画面の px で動かす純関数（spec-4b-6a 確定事項12・13）。DOM に触れない。
  //
  // 枠は { x1, y1, x2, y2 }。そのページの .pdf-page の左上からの CSS px（y は下向き）で、x1 < x2・y1 < y2。bounds はそのページの
  // 今の見える範囲の大きさ { width, height }（描いた viewport の幅と高さ）で、枠はいつもこの中に収める。min は幅と高さの下限（px）。
  // 紙の座標（回す前・pt）の箱との行き来は、描いた viewport の convertToViewportPoint・convertToPdfPoint で行う。

  // つまみの一辺（px。見本 screenshots/phase4b-6-trim-frame.png）。
  const HANDLE = 10;
  // つまみを掴める広さ（中心からの px）。一辺の半分に 2px の遊びを足す。
  const REACH = HANDLE / 2 + 2;

  // つまみの名前と、枠の上での位置（左端 0・真ん中 0.5・右端 1 の割合。上下も同じ）。
  const HANDLES = Object.freeze([
    { name: 'nw', fx: 0, fy: 0 }, { name: 'n', fx: 0.5, fy: 0 }, { name: 'ne', fx: 1, fy: 0 }, { name: 'e', fx: 1, fy: 0.5 },
    { name: 'se', fx: 1, fy: 1 }, { name: 's', fx: 0.5, fy: 1 }, { name: 'sw', fx: 0, fy: 1 }, { name: 'w', fx: 0, fy: 0.5 },
  ]);

  // 掴めるものの上のカーソル（shell.css の html[data-trim-cursor]。確定事項13）。
  const CURSORS = Object.freeze({ nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew', inside: 'move' });

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  // 下限は見える範囲より大きくしない（10pt より小さい紙でも引けるように）。
  function limitOf(min, size) {
    return Math.min(Math.max(0, min), size);
  }

  // 1 つの軸で、押した点 a から今の点 b までの区間。0〜size に収め、min に足りなければ b の向きへ広げる（端に当たれば逆へ）。
  function span(a, b, size, min) {
    const anchor = clamp(a, 0, size);
    const reach = clamp(b, 0, size);
    const low = Math.min(anchor, reach);
    const high = Math.max(anchor, reach);
    if (high - low >= min)
      return [low, high];
    if (reach >= anchor) {
      const end = Math.min(size, low + min);
      return [end - min, end];
    }
    const start = Math.max(0, high - min);
    return [start, start + min];
  }

  // 押した点 start から今の点 end までで引いた枠。
  function rectFrom(start, end, bounds, min = 0) {
    const [x1, x2] = span(start[0], end[0], bounds.width, limitOf(min, bounds.width));
    const [y1, y2] = span(start[1], end[1], bounds.height, limitOf(min, bounds.height));
    return { x1, y1, x2, y2 };
  }

  // 8 点のつまみの中心。
  function handlesOf(rect) {
    return HANDLES.map(({ name, fx, fy }) => ({ name, x: rect.x1 + (rect.x2 - rect.x1) * fx, y: rect.y1 + (rect.y2 - rect.y1) * fy }));
  }

  // 点 point の下にあるもの。つまみの名前（'nw' など）を枠の中（'inside'）より先に見る。どちらでもなければ null。
  function hitOf(rect, point) {
    if (rect === null || rect === undefined)
      return null;
    const [x, y] = point;
    const handle = handlesOf(rect).find((at) => Math.abs(at.x - x) <= REACH && Math.abs(at.y - y) <= REACH);
    if (handle !== undefined)
      return handle.name;
    return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2 ? 'inside' : null;
  }

  // 掴んだもの hit（つまみの名前か 'inside'）を delta だけ動かした枠。origin は掴んだときの枠。中を掴んだら大きさを保って動かし、
  // つまみなら掴んだ辺だけを動かす（反対の辺から min より近づけない）。
  function dragRect(origin, hit, delta, bounds, min = 0) {
    const [dx, dy] = delta;
    if (hit === 'inside') {
      const mx = clamp(dx, -origin.x1, bounds.width - origin.x2);
      const my = clamp(dy, -origin.y1, bounds.height - origin.y2);
      return { x1: origin.x1 + mx, y1: origin.y1 + my, x2: origin.x2 + mx, y2: origin.y2 + my };
    }
    const minX = limitOf(min, bounds.width);
    const minY = limitOf(min, bounds.height);
    const rect = { ...origin };
    if (hit.includes('w'))
      rect.x1 = clamp(origin.x1 + dx, 0, origin.x2 - minX);
    if (hit.includes('e'))
      rect.x2 = clamp(origin.x2 + dx, origin.x1 + minX, bounds.width);
    if (hit.includes('n'))
      rect.y1 = clamp(origin.y1 + dy, 0, origin.y2 - minY);
    if (hit.includes('s'))
      rect.y2 = clamp(origin.y2 + dy, origin.y1 + minY, bounds.height);
    return rect;
  }

  function cursorOf(hit) {
    return CURSORS[hit] ?? null;
  }

  // ---- 紙の座標（回す前・pt）との行き来。viewport はそのページを描いた pdf.js の viewport ----

  function rectOf(box, viewport) {
    const [ax, ay] = viewport.convertToViewportPoint(box[0], box[1]);
    const [bx, by] = viewport.convertToViewportPoint(box[2], box[3]);
    return { x1: Math.min(ax, bx), y1: Math.min(ay, by), x2: Math.max(ax, bx), y2: Math.max(ay, by) };
  }

  // 枠の箱（並べ直して小数 2 桁に丸める）。幅か高さが 0 なら null。
  function boxOf(rect, viewport) {
    const [ax, ay] = viewport.convertToPdfPoint(rect.x1, rect.y1);
    const [bx, by] = viewport.convertToPdfPoint(rect.x2, rect.y2);
    return root.SigK.pageCrop.normalizeBox([ax, ay, bx, by]);
  }

  // 下限（各辺 10pt。spec-4b-6a 確定事項13）を、その viewport の px にする。
  function minOf(viewport) {
    return root.SigK.pageCrop.MIN_SIZE * viewport.scale * (viewport.userUnit ?? 1);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.trimDrag = { HANDLE, REACH, rectFrom, handlesOf, hitOf, dragRect, cursorOf, rectOf, boxOf, minOf };
})(typeof window !== 'undefined' ? window : globalThis);
