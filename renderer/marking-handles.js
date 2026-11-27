(function (root) {
  'use strict';

  // 選択したマーキングの枠とハンドル、ハンドルをドラッグした時の大きさ（spec-7-9 確定事項F4）。DOM に触れない純粋層。
  //
  // 位置は表示の座標（.pdf-page 基準の CSS px）。枠は rect に余白を加えた破線の四角。ハンドルは、外の円の上下左右の四角いハンドル 4 つ
  // （種類 outer。外の円が正円のまま、中心を保って大きさが変わる。中の円・十字線・文字サイズも同じ比で変わる〔決定102・質問 MK3 案A〕。
  // 注意マークは枠の辺の中点）と、中の円の右の丸いハンドル 1 つ
  // （種類 inner。点付き丸・二重丸は中の円、照準は十字線の右端で長さ、番号付き丸は番号の右端で文字サイズ）。注意マークは外側の 4 つだけ。
  // 中の円のハンドルは、中の円の右端からハンドルの半径だけ右に置く（中心を押した時にハンドルを掴まず、書き込みを移動できるように。Claude の判断）。
  // マーキングは回転しないので、回転のハンドルは表示しない。上下左右は紙の +y・+x の向き（ページを回転した表示でも円の上下左右に来る）。

  const OUTER = Object.freeze({ x1: [-1, 0], x2: [1, 0], y1: [0, -1], y2: [0, 1] });

  function geometry() {
    return root.SigK.markingGeometry;
  }

  function handles() {
    return root.SigK.shapeHandles;
  }

  function unit([x, y]) {
    const length = Math.hypot(x, y);
    return length > 0 ? [x / length, y / length] : [0, 0];
  }

  // 中心と、紙の +x・+y の向きの表示の単位ベクトル。
  function axesOf(entry, viewport) {
    const center = geometry().centerOf(entry.rect);
    const c = viewport.convertToViewportPoint(center[0], center[1]);
    const along = (dx, dy) => {
      const [x, y] = viewport.convertToViewportPoint(center[0] + dx, center[1] + dy);
      return unit([x - c[0], y - c[1]]);
    };
    return { c, ux: along(1, 0), uy: along(0, 1), scale: viewport.scale ?? 1 };
  }

  function place({ c, ux, uy }, lx, ly) {
    return [c[0] + ux[0] * lx + uy[0] * ly, c[1] + ux[1] * lx + uy[1] * ly];
  }

  // 外側のハンドルまでの距離（pt。横と縦）。円の形は外の円の半径、注意マークは三角形の幅と高さの半分。
  function outerReachOf(marking) {
    if (marking.shape === 'caution')
      return [marking.outer / 2, (marking.outer * geometry().SQRT3_HALF) / 2];
    return [marking.outer / 2, marking.outer / 2];
  }

  // 中の円のハンドルまでの距離（pt）。点付き丸・二重丸は中の円の半径、照準は十字線の半分、番号付き丸は番号の幅の半分。
  function innerReachOf(marking) {
    switch (marking.shape) {
      case 'target': return marking.dot / 2;
      case 'double': return marking.ring / 2;
      case 'crosshair': return marking.cross / 2;
      case 'number': return root.SigK.markingGlyphs.boxOf(marking.number, marking.fontSize).width / 2;
      default: return null;
    }
  }

  function frameOf(entry, axes) {
    const [x1, y1, x2, y2] = entry.rect;
    const pad = handles().FRAME_PADDING;
    const w = ((x2 - x1) / 2) * axes.scale + pad;
    const h = ((y2 - y1) / 2) * axes.scale + pad;
    return { type: 'polygon', points: [[-w, h], [w, h], [w, -h], [-w, -h]].map(([lx, ly]) => place(axes, lx, ly)) };
  }

  // 枠とハンドル（shape-handles.js の handlesOf の形）。
  function handlesOf(entry, viewport) {
    const axes = axesOf(entry, viewport);
    const [rx, ry] = outerReachOf(entry.marking);
    const list = Object.entries(OUTER).map(([id, [sx, sy]]) => {
      const dir = unit([axes.ux[0] * sx + axes.uy[0] * sy, axes.ux[1] * sx + axes.uy[1] * sy]);
      return { id: `outer-${id}`, kind: 'outer', shape: 'square', at: place(axes, sx * rx * axes.scale, sy * ry * axes.scale), dir, cursor: handles().resizeCursorOf(dir) };
    });
    const reach = innerReachOf(entry.marking);
    if (reach !== null)
      list.push({ id: 'inner', kind: 'inner', at: place(axes, reach * axes.scale + handles().HANDLE_RADIUS, 0), dir: axes.ux, cursor: handles().resizeCursorOf(axes.ux) });
    return { frame: frameOf(entry, axes), stem: null, handles: list };
  }

  // ハンドルをドラッグした時の patch（{ marking, rect, quads }）。press・point は表示の座標。ハンドルの外向きに動いた量の 2 倍だけ
  // 直径（十字線の長さ）を変える。番号付き丸の文字サイズは、番号の右端がマウスに付いて動くように比で変える。範囲の端で止める。
  function resized(entry, handle, press, point, viewport) {
    const { marking } = entry;
    const scale = viewport.scale ?? 1;
    const moved = ((point[0] - press[0]) * handle.dir[0] + (point[1] - press[1]) * handle.dir[1]) / scale;
    let field = 'outer';
    let value = marking.outer + 2 * moved;
    if (handle.kind === 'outer' && marking.shape === 'caution' && (handle.id === 'outer-y1' || handle.id === 'outer-y2'))
      value = marking.outer + (2 * moved) / geometry().SQRT3_HALF;
    if (handle.kind === 'inner') {
      field = root.SigK.markingRules.innerFieldOf(marking.shape);
      const reach = innerReachOf(marking);
      value = field === 'fontSize' ? marking.fontSize * Math.max(0.01, (reach + moved) / reach) : marking[field] + 2 * moved;
    }
    const next = root.SigK.markingRules.clampedSize(marking, field, value);
    const center = geometry().centerOf(entry.rect).map((each) => Math.round(each * 100) / 100);
    return { marking: next, ...geometry().frameOf(next, center) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.markingHandles = { handlesOf, resized };
})(typeof window !== 'undefined' ? window : globalThis);
