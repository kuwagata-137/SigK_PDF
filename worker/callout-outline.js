'use strict';

// 吹き出しの輪郭を外観の演算子にする純粋層（spec-4b-4b 確定事項E・H3）。pdf-lib を知らない。
//
// 式は renderer/callout-geometry.js と同じで、一致はテストで見張る（プロセスが違うので読み込み合わない）。座標は箱の表示の左上を
// 原点にし、表示の右と下を正にした向き（ローカル）。外観では、文字の向きの cm（free-text-appearance.js の frameOf）のあとの座標
// （箱の左上が first、y は上向き）へ直して描く。

const { num } = require('./annotation-appearance.js');

const CORNER_RATIO = 0.6;
const BASE_RATIO = 0.6;
const BASE_MIN = 2;
const KAPPA = 0.5522847498;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

// 先の向く辺。箱の中心から先への差で、|dy|/高さ ≥ |dx|/幅 なら上か下、そうでなければ左か右。
function edgeOf(width, height, [tx, ty]) {
  const dx = tx - width / 2;
  const dy = ty - height / 2;
  if (Math.abs(dy) / height >= Math.abs(dx) / width)
    return dy < 0 ? 'top' : 'bottom';
  return dx < 0 ? 'left' : 'right';
}

// 輪郭。戻り値は { segments（{ op, points }）, edge, base（しっぽの根元の中心） }（ローカル）。
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

// 箱と先を含む外接（ローカル）。先は線の太さの半分（無ければ 0.5）だけ外へ出る。
function boundsOf(width, height, [tx, ty], lineWidth = 0) {
  const pad = Math.max(lineWidth / 2, 0.5);
  return [Math.min(0, tx - pad), Math.min(0, ty - pad), Math.max(width, tx + pad), Math.max(height, ty + pad)];
}

// 輪郭の演算子。first は文字の向きの cm のあとの座標での箱の左上（ローカルの原点）。
function outlineOps(segments, first) {
  const at = ([right, down]) => `${num(first[0] + right)} ${num(first[1] - down)}`;
  return segments.map(({ op, points }) => {
    if (op === 'M')
      return `${at(points[0])} m`;
    if (op === 'L')
      return `${at(points[0])} l`;
    if (op === 'C')
      return `${points.map(at).join(' ')} c`;
    return 'h';
  });
}

// ローカル → 紙の座標（回す前。origin は表示の左上、rotation は文字の向き）。renderer の free-text-layout.js の shiftOrigin と同じ向き。
function paperOf(origin, rotation, [right, down]) {
  switch (rotation) {
    case 90: return [origin[0] + down, origin[1] + right];
    case 180: return [origin[0] - right, origin[1] + down];
    case 270: return [origin[0] - down, origin[1] - right];
    default: return [origin[0] + right, origin[1] - down];
  }
}

// 紙の座標 → ローカル（paperOf の逆）。
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

module.exports = { CORNER_RATIO, BASE_RATIO, BASE_MIN, KAPPA, edgeOf, outlineOf, boundsOf, outlineOps, paperOf, localOf };
