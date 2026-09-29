'use strict';

// 雲形の外観の path を組む純粋層（spec-4b-1b 確定事項33。事前調査 H）。pdf-lib を知らない。
//
// renderer/cloud-geometry.js と同じ式で同じ点列を作り、content stream の path（m・c・h）にする。一致はテストで見張る
// （プロセスが違うので読み込み合わない。矢じりと同じ扱い）。計算の順序も画面側とそろえてあり、同じ入力なら同じ数になる。
//
// 雲は箱の内側に収める。弧の中心は、箱を余白 m（弧の半径 r ＋ 描く線幅の半分）だけ内へ寄せた輪郭に並べ、隣り合う円の
// 外側の交点から交点までを外へふくらむ弧で結ぶ。弧の頭は前の弧の内側へ 22° 延ばしてから戻る（しっぽ。決定47 ⑮）。
// 弧の半径は 強さ × 4（丸は 4.75）＋ 描く線幅 / 2 で、中心どうしの間隔は 2r·cos 34° 以下。他のツール（PDFBox）の雲形と
// 同じ慣習の値で、コードは写していない（docs/06）。

const { num } = require('./annotation-appearance.js');

const DEG = Math.PI / 180;
const OVERLAP = 34 * DEG;
const TAIL = 22 * DEG;
const PIECE = 90 * DEG;
const MIN_RADIUS = 1;
const ELLIPSE_SAMPLES = 1440;

function radiusOf(kind, intensity, width) {
  return (kind === 'circle' ? 4.75 : 4) * intensity + width / 2;
}

function rectCenters([x1, y1, x2, y2], step) {
  const corners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  const centers = [];
  corners.forEach((from, index) => {
    const to = corners[(index + 1) % 4];
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
    for (let j = 0; j < n; j += 1)
      centers.push([from[0] + ((to[0] - from[0]) * j) / n, from[1] + ((to[1] - from[1]) * j) / n]);
  });
  return centers;
}

function ellipseCenters([x1, y1, x2, y2], step) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const a = (x2 - x1) / 2;
  const b = (y2 - y1) / 2;
  const at = (t) => [cx + a * Math.cos(t), cy + b * Math.sin(t)];
  const lengths = [0];
  let previous = at(0);
  for (let i = 1; i <= ELLIPSE_SAMPLES; i += 1) {
    const next = at((2 * Math.PI * i) / ELLIPSE_SAMPLES);
    lengths.push(lengths[i - 1] + Math.hypot(next[0] - previous[0], next[1] - previous[1]));
    previous = next;
  }
  const total = lengths[ELLIPSE_SAMPLES];
  const n = Math.max(4, 2 * Math.ceil(total / (2 * step)));
  const centers = [];
  let k = 0;
  for (let j = 0; j < n; j += 1) {
    const s = (total * j) / n;
    while (k < ELLIPSE_SAMPLES - 1 && lengths[k + 1] < s)
      k += 1;
    const f = (s - lengths[k]) / (lengths[k + 1] - lengths[k] || 1);
    centers.push(at(((k + f) * 2 * Math.PI) / ELLIPSE_SAMPLES));
  }
  return centers;
}

function distinct(points) {
  return points.filter((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.hypot(next[0] - point[0], next[1] - point[1]) > 1e-6;
  });
}

function crossing(p, q, r) {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const d = Math.hypot(dx, dy);
  const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
  return [(p[0] + q[0]) / 2 + (h * dy) / d, (p[1] + q[1]) / 2 - (h * dx) / d];
}

// 円弧を 90° 以下に割ったベジェの c 演算子の並びにする。制御点は半径 × 4/3 × tan(角 / 4)。
function arcOps(out, c, r, from, to) {
  const pieces = Math.max(1, Math.ceil(Math.abs(to - from) / PIECE - 1e-9));
  const delta = (to - from) / pieces;
  const k = (4 / 3) * Math.tan(delta / 4);
  for (let i = 0; i < pieces; i += 1) {
    const a0 = from + delta * i;
    const a1 = a0 + delta;
    const p0 = [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)];
    const p3 = [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)];
    const points = [
      p0[0] - k * r * Math.sin(a0), p0[1] + k * r * Math.cos(a0),
      p3[0] + k * r * Math.sin(a1), p3[1] - k * r * Math.cos(a1),
      p3[0], p3[1],
    ];
    out.push(`${points.map(num).join(' ')} c`);
  }
}

function curlOps(centers, r) {
  const n = centers.length;
  const ops = [];
  for (let i = 0; i < n; i += 1) {
    const c = centers[i];
    const before = crossing(centers[(i - 1 + n) % n], c, r);
    const after = crossing(c, centers[(i + 1) % n], r);
    const start = Math.atan2(before[1] - c[1], before[0] - c[0]);
    let end = Math.atan2(after[1] - c[1], after[0] - c[0]);
    while (end <= start)
      end += 2 * Math.PI;
    if (i === 0)
      ops.push(`${num(before[0])} ${num(before[1])} m`);
    arcOps(ops, c, r, start, start - TAIL);
    arcOps(ops, c, r, start - TAIL, end);
  }
  ops.push('h');
  return ops.join('\n');
}

// 雲形の path。戻り値は { ops, radius, margin, drawWidth }。弧が小さくなりすぎる箱は null（普通の四角・丸で描く）。
// 描く線幅は短い辺の半分で頭打ちにし、弧の半径は (短い辺 − 描く線幅) / 4 を超えない。線なしでも lineWidth には書き込みの
// 太さを渡す。/RD には margin を 4 つ書く（確定事項33）。
function cloudPathOf({ kind, box, intensity, lineWidth }) {
  const [x1, y1, x2, y2] = box;
  const minSide = Math.min(x2 - x1, y2 - y1);
  const drawWidth = Math.min(lineWidth, minSide / 2);
  const radius = Math.min(radiusOf(kind, intensity, drawWidth), (minSide - drawWidth) / 4);
  if (!(radius >= MIN_RADIUS))
    return null;
  const margin = radius + drawWidth / 2;
  const inner = [x1 + margin, y1 + margin, x2 - margin, y2 - margin];
  const step = 2 * radius * Math.cos(OVERLAP);
  const centers = distinct(kind === 'circle' ? ellipseCenters(inner, step) : rectCenters(inner, step));
  return { ops: curlOps(centers, radius), radius, margin, drawWidth };
}

module.exports = { OVERLAP, TAIL, MIN_RADIUS, radiusOf, cloudPathOf };
