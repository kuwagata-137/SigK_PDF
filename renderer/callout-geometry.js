(function (root) {
  'use strict';

  // 吹き出しの形の純粋層（spec-4b-4b 確定事項E・D3・H2）。DOM に触れない。
  //
  // 座標は箱の表示の左上を原点にし、表示の右と下を正にした向き（文字の向き。「ローカル」と呼ぶ）。箱は [0, 0, 幅, 高さ]、しっぽの先も
  // 同じ向きで表した点。輪郭は角の丸い箱としっぽの三角を 1 本で描く閉じた線で、CheckListMaker の calloutPath と同じ決め方
  // （事前調査 F）。角は 3 次のベジェで近似する（画面・印刷・保存で同じ点列を描く）。保存の側（worker/callout-outline.js）も同じ式で、
  // 一致はテストで見張る（プロセスが違うので読み込み合わない）。

  // 角の丸みとしっぽの根元の半幅は大きさの 0.6 倍（確定事項E2・E3）。根元の半幅の下限（pt）。
  const CORNER_RATIO = 0.6;
  const BASE_RATIO = 0.6;
  const BASE_MIN = 2;
  // 4 分の 1 の円をベジェで描く係数。
  const KAPPA = 0.5522847498;
  // 置いた直後の先（確定事項D3）: 箱の左上から右へ min(幅×0.25, 30pt)、下へ 高さ＋大きさ×1.6。
  const TIP_RIGHT_RATIO = 0.25;
  const TIP_RIGHT_MAX = 30;
  const TIP_DOWN_RATIO = 1.6;

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  // 先の向く辺（確定事項E2）。箱の中心から先への差で、|dy|/高さ ≥ |dx|/幅 なら上か下、そうでなければ左か右。
  function edgeOf(width, height, [tx, ty]) {
    const dx = tx - width / 2;
    const dy = ty - height / 2;
    if (Math.abs(dy) / height >= Math.abs(dx) / width)
      return dy < 0 ? 'top' : 'bottom';
    return dx < 0 ? 'left' : 'right';
  }

  // 輪郭（確定事項E）。width・height は箱、tip は先、fontSize は文字の大きさ、inset は輪郭を箱の内側へ入れる量（枠線の太さの半分）。
  // 戻り値は { segments, edge, base }。segments は { op: 'M'|'L'|'C'|'Z', points } の並び（ローカル）、base はしっぽの根元の中心。
  function outlineOf({ width, height, tip, fontSize, inset = 0 }) {
    const x1 = inset;
    const y1 = inset;
    const x2 = width - inset;
    const y2 = height - inset;
    const r = Math.max(0, Math.min(fontSize * CORNER_RATIO, (x2 - x1) / 2, (y2 - y1) / 2));
    const k = r * KAPPA;
    const half = (side) => Math.max(BASE_MIN, Math.min(fontSize * BASE_RATIO, (side - 2 * r) / 2 - 0.5));
    const hx = half(x2 - x1);
    const hy = half(y2 - y1);
    const edge = edgeOf(width, height, tip);
    const segments = [];
    const M = (x, y) => segments.push({ op: 'M', points: [[x, y]] });
    const L = (x, y) => segments.push({ op: 'L', points: [[x, y]] });
    const C = (a, b, c) => segments.push({ op: 'C', points: [a, b, c] });
    const along = (value, low, high) => (low <= high ? clamp(value, low, high) : (low + high) / 2);
    let base = null;
    M(x1 + r, y1);
    if (edge === 'top') {
      const bc = along(tip[0], x1 + r + hx, x2 - r - hx);
      L(bc - hx, y1); L(tip[0], tip[1]); L(bc + hx, y1);
      base = [bc, y1];
    }
    L(x2 - r, y1);
    C([x2 - r + k, y1], [x2, y1 + r - k], [x2, y1 + r]);
    if (edge === 'right') {
      const bc = along(tip[1], y1 + r + hy, y2 - r - hy);
      L(x2, bc - hy); L(tip[0], tip[1]); L(x2, bc + hy);
      base = [x2, bc];
    }
    L(x2, y2 - r);
    C([x2, y2 - r + k], [x2 - r + k, y2], [x2 - r, y2]);
    if (edge === 'bottom') {
      const bc = along(tip[0], x1 + r + hx, x2 - r - hx);
      L(bc + hx, y2); L(tip[0], tip[1]); L(bc - hx, y2);
      base = [bc, y2];
    }
    L(x1 + r, y2);
    C([x1 + r - k, y2], [x1, y2 - r + k], [x1, y2 - r]);
    if (edge === 'left') {
      const bc = along(tip[1], y1 + r + hy, y2 - r - hy);
      L(x1, bc + hy); L(tip[0], tip[1]); L(x1, bc - hy);
      base = [x1, bc];
    }
    L(x1, y1 + r);
    C([x1, y1 + r - k], [x1 + r - k, y1], [x1 + r, y1]);
    segments.push({ op: 'Z', points: [] });
    return { segments, edge, base };
  }

  // 箱と先を含む外接（ローカル）。先は角を丸く結ぶので、線の太さの半分だけ外へ出る（事前調査 D）。箱の外周は枠線が内側なので広げない。
  function boundsOf(width, height, [tx, ty], lineWidth = 0) {
    const pad = Math.max(lineWidth / 2, 0.5);
    return [Math.min(0, tx - pad), Math.min(0, ty - pad), Math.max(width, tx + pad), Math.max(height, ty + pad)];
  }

  // 置いた直後の先（ローカル。確定事項D3）。
  function defaultTipOf(width, height, fontSize) {
    return [Math.min(width * TIP_RIGHT_RATIO, TIP_RIGHT_MAX), height + fontSize * TIP_DOWN_RATIO];
  }

  // 紙の座標の点 → ローカル（回す前。origin は表示の左上、rotation は文字の向き）。free-text-layout.js の shiftOrigin の逆。
  function localOf(origin, rotation, [x, y]) {
    const vx = x - origin[0];
    const vy = y - origin[1];
    switch (rotation) {
      case 90: return [vy, vx];
      case 180: return [-vx, vy];
      case 270: return [-vy, -vx];
      default: return [vx, -vy];
    }
  }

  // ローカル → 紙の座標（回す前）。
  function paperOf(origin, rotation, [right, down]) {
    switch (rotation) {
      case 90: return [origin[0] + down, origin[1] + right];
      case 180: return [origin[0] - right, origin[1] + down];
      case 270: return [origin[0] - down, origin[1] - right];
      default: return [origin[0] + right, origin[1] - down];
    }
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.calloutGeometry = {
    CORNER_RATIO, BASE_RATIO, BASE_MIN, KAPPA, TIP_RIGHT_RATIO, TIP_RIGHT_MAX, TIP_DOWN_RATIO,
    edgeOf, outlineOf, boundsOf, defaultTipOf, localOf, paperOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
