(function (root) {
  'use strict';

  // 四角・丸・直線の輪郭の点列と、点列を SVG・canvas の path にする口（spec-4b-1b 確定事項30・32・41）。DOM には触れない
  // （canvas の path は渡された ctx に引くだけ）。
  //
  // 点列は保存の外観（worker/shape-appearance.js）と同じ始点・同じ向きで返す。四角は re と同じく左下から反時計回り、丸は右端から
  // 反時計回りのベジェ 4 本（κ = 0.5523）、直線は始点から終点。破線は path に沿って続けて引くので、始点と向きが保存とそろって
  // いないと画面と印刷で切れ目の位置がずれる（事前調査 H）。四角・丸の線は箱の内側に収め（描く線幅の半分だけ内へ）、描く線幅は
  // 短い辺の半分で頭打ちにする（確定事項30。線が箱より太くても、箱をすべて覆う）。
  //
  // 点列の形は { op: 'M' | 'L' | 'C' | 'Z', points: [[x, y], …] } の並び（紙の座標。cloud-geometry.js と同じ）。

  const KAPPA = 0.5523;

  // 四角・丸を描く線幅。短い辺の半分で頭打ちにする。
  function drawWidthOf(box, lineWidth) {
    const minSide = Math.min(box[2] - box[0], box[3] - box[1]);
    return Math.max(0, Math.min(lineWidth, minSide / 2));
  }

  // 箱を inset だけ内へ寄せる。つぶれるなら中心の線にする（負の幅にしない）。
  function insetBox([x1, y1, x2, y2], inset) {
    const left = x1 + inset;
    const bottom = y1 + inset;
    return [left, bottom, Math.max(left, x2 - inset), Math.max(bottom, y2 - inset)];
  }

  // 四角の輪郭（線の中心）。width は描く線幅（線なしの塗りは 0 で箱そのもの）。
  function rectOutline(box, width) {
    const [x1, y1, x2, y2] = insetBox(box, width / 2);
    return [{ op: 'M', points: [[x1, y1]] }, { op: 'L', points: [[x2, y1]] }, { op: 'L', points: [[x2, y2]] },
      { op: 'L', points: [[x1, y2]] }, { op: 'Z', points: [] }];
  }

  // 丸の輪郭（線の中心）。箱の中心を保ち、描く線幅の半分だけ内側の半径でベジェ 4 本。
  function ellipseOutline(box, width) {
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;
    const rx = Math.max(0, (box[2] - box[0] - width) / 2);
    const ry = Math.max(0, (box[3] - box[1] - width) / 2);
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    return [{ op: 'M', points: [[cx + rx, cy]] },
      { op: 'C', points: [[cx + rx, cy + ky], [cx + kx, cy + ry], [cx, cy + ry]] },
      { op: 'C', points: [[cx - kx, cy + ry], [cx - rx, cy + ky], [cx - rx, cy]] },
      { op: 'C', points: [[cx - rx, cy - ky], [cx - kx, cy - ry], [cx, cy - ry]] },
      { op: 'C', points: [[cx + kx, cy - ry], [cx + rx, cy - ky], [cx + rx, cy]] },
      { op: 'Z', points: [] }];
  }

  // 折れ線（直線は 2 点、矢じりは翼 → 終点 → 翼）。
  function polylineOutline(points) {
    return points.map((point, index) => ({ op: index === 0 ? 'M' : 'L', points: [[point[0], point[1]]] }));
  }

  // 属性に書く数。小数 2 桁で十分で、浮動小数のごみを残さない（shape-graphics.js と同じ）。
  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  // SVG の d。toView で紙の点を表示の px にする（回転した紙でも同じ点になる）。
  function svgPathOf(segments, toView) {
    return segments.map(({ op, points }) => {
      if (op === 'Z')
        return 'Z';
      const view = points.map(toView);
      return `${op}${view.map((point) => `${fmt(point[0])},${fmt(point[1])}`).join(' ')}`;
    }).join(' ');
  }

  // canvas 2D の ctx に同じ path を引く（印刷）。beginPath から始め、塗りや線は呼ぶ側が当てる。
  function tracePath(ctx, segments, toView) {
    ctx.beginPath();
    for (const { op, points } of segments) {
      const view = points.map(toView);
      if (op === 'M')
        ctx.moveTo(view[0][0], view[0][1]);
      else if (op === 'L')
        ctx.lineTo(view[0][0], view[0][1]);
      else if (op === 'C')
        ctx.bezierCurveTo(view[0][0], view[0][1], view[1][0], view[1][1], view[2][0], view[2][1]);
      else
        ctx.closePath();
    }
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeOutline = { KAPPA, drawWidthOf, rectOutline, ellipseOutline, polylineOutline, svgPathOf, tracePath };
})(typeof window !== 'undefined' ? window : globalThis);
