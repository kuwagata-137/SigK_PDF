'use strict';

// 保存側の吹き出しの輪郭と欄（spec-4b-4b 確定事項E・G2・G3）。純粋層。画面の renderer/callout-shape.js と同じ式で、一致はテストで見張る
// （プロセスが違うので読み込み合わない）。
//
// 回す前の箱 [x1 y1 x2 y2]（紙の座標）と、回す前の座標へ戻したしっぽの先で輪郭を組む（出る辺・付け根・角丸の決め方は callout-shape.js）。
// 枠線は箱の内側に描くので、線の太さの半分だけ内へ寄せた箱で組む。欄は次のとおり。
//   /BBox … 箱と先を囲む範囲を、線の太さの半分＋1pt だけ広げたもの（回す前の座標。線と丸い結びが切れないように）
//   /RD   … 回す前の箱と /BBox の差 [左 下 右 上]（回していても /BBox に対する差で書く。事前調査 O の O2）
//   /CL   … [先x 先y 付け根x 付け根y]。紙の上の実際の点（付け根は回して紙へ戻す）。しっぽが無ければ付け根も先と同じ点

const { num, colorOps } = require('./annotation-appearance.js');

const RADIUS_MAX = 10;
const HALF_MIN = 10;
const HALF_RATIO = 0.6;
// 付け根の半幅の下限（pt。renderer/callout-shape.js と同じ）。
const HALF_FLOOR = 3;
const KAPPA = 0.5523;
// /BBox を線の半分より広げる分（pt）。
const BBOX_MARGIN = 1;

function round(value) {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function centerOf([x1, y1, x2, y2]) {
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

function inside([x1, y1, x2, y2], [x, y]) {
  return x >= x1 && x <= x2 && y >= y1 && y <= y2;
}

// 紙の座標の点を center まわりに、画面で時計回りに angle 度回す（renderer/shape-rotation.js の rotatePoint と同じ式）。
function rotatePoint([x, y], [cx, cy], angle) {
  const t = (angle * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];
}

function sideOf(box, [tx, ty]) {
  const [cx, cy] = centerOf(box);
  const dx = (tx - cx) / (box[2] - box[0]);
  const dy = (ty - cy) / (box[3] - box[1]);
  if (Math.abs(dy) >= Math.abs(dx))
    return dy > 0 ? 'top' : 'bottom';
  return dx > 0 ? 'right' : 'left';
}

function tailOf(box, tip, fontSize) {
  if (inside(box, tip))
    return null;
  const [x1, y1, x2, y2] = box;
  const side = sideOf(box, tip);
  const across = side === 'top' || side === 'bottom';
  const [lo, hi] = across ? [x1, x2] : [y1, y2];
  // 角丸を先に決め、半幅を辺の長さ/2−角丸で抑える。半幅が HALF_FLOOR に満たないときだけ、角丸を減らして半幅を HALF_FLOOR にする。
  const wanted = Math.max(HALF_MIN, fontSize * HALF_RATIO);
  const room = (hi - lo) / 2;
  const corner = Math.max(0, Math.min(RADIUS_MAX, (x2 - x1) / 2, (y2 - y1) / 2));
  const half = Math.min(wanted, Math.max(room - corner, Math.min(HALF_FLOOR, room)));
  const radius = Math.max(0, Math.min(corner, room - half));
  const along = Math.min(hi - radius - half, Math.max(lo + radius + half, across ? tip[0] : tip[1]));
  const edge = { top: y2, bottom: y1, right: x2, left: x1 }[side];
  return { side, half, radius, base: across ? [along, edge] : [edge, along] };
}

// 輪郭の点の並び [{ op, points }]（回す前の紙の座標。callout-shape.js の outlineOf と同じ）。
function outlineOf(box, tip, { fontSize, inset = 0 }) {
  const shrunk = [box[0] + inset, box[1] + inset, box[2] - inset, box[3] - inset];
  const tail = tailOf(box, tip, fontSize) === null ? null : tailOf(shrunk, tip, fontSize);
  const [x1, y1, x2, y2] = shrunk;
  const r = tail === null ? Math.max(0, Math.min(RADIUS_MAX, (x2 - x1) / 2, (y2 - y1) / 2)) : tail.radius;
  const k = KAPPA * r;
  const segments = [{ op: 'M', points: [[x1 + r, y2]] }];
  const line = (x, y) => segments.push({ op: 'L', points: [[x, y]] });
  const curve = (a, b, c) => segments.push({ op: 'C', points: [a, b, c] });
  const insertTail = (side, sign) => {
    if (tail === null || tail.side !== side)
      return;
    const [bx, by] = tail.base;
    const across = side === 'top' || side === 'bottom';
    const at = (offset) => (across ? [bx + offset, by] : [bx, by + offset]);
    line(...at(-sign * tail.half));
    line(tip[0], tip[1]);
    line(...at(sign * tail.half));
  };
  insertTail('top', 1);
  line(x2 - r, y2);
  curve([x2 - r + k, y2], [x2, y2 - r + k], [x2, y2 - r]);
  insertTail('right', -1);
  line(x2, y1 + r);
  curve([x2, y1 + r - k], [x2 - r + k, y1], [x2 - r, y1]);
  insertTail('bottom', -1);
  line(x1 + r, y1);
  curve([x1 + r - k, y1], [x1, y1 + r - k], [x1, y1 + r]);
  insertTail('left', 1);
  line(x1, y2 - r);
  curve([x1, y2 - r + k], [x1 + r - k, y2], [x1 + r, y2]);
  segments.push({ op: 'Z', points: [] });
  return segments;
}

function angleOf(entry) {
  return Number.isFinite(entry.angle) ? entry.angle : 0;
}

// 吹き出しの輪郭の点の並び・/BBox・/RD・/CL。entry は { rect（回す前の箱）, angle?, fontSize, borderWidth（枠線が無ければ 0）, callout: { tip } }。
function calloutGeometryOf(entry) {
  const box = entry.rect;
  const angle = angleOf(entry);
  const center = centerOf(box);
  const localTip = angle === 0 ? [...entry.callout.tip] : rotatePoint(entry.callout.tip, center, -angle);
  const inset = entry.borderWidth > 0 ? entry.borderWidth / 2 : 0;
  const segments = outlineOf(box, localTip, { fontSize: entry.fontSize, inset });
  const margin = inset + BBOX_MARGIN;
  const extent = inside(box, localTip) ? [...box] : [Math.min(box[0], localTip[0]), Math.min(box[1], localTip[1]), Math.max(box[2], localTip[0]), Math.max(box[3], localTip[1])];
  const floor = (value) => Math.floor(value * 100 + 1e-6) / 100;
  const ceil = (value) => Math.ceil(value * 100 - 1e-6) / 100;
  const bbox = [floor(extent[0] - margin), floor(extent[1] - margin), ceil(extent[2] + margin), ceil(extent[3] + margin)];
  const rd = [box[0] - bbox[0], box[1] - bbox[1], bbox[2] - box[2], bbox[3] - box[3]].map(round);
  const shrunk = [box[0] + inset, box[1] + inset, box[2] - inset, box[3] - inset];
  const tail = inside(box, localTip) ? null : tailOf(shrunk, localTip, entry.fontSize);
  const knee = tail === null ? localTip : tail.base;
  const paperKnee = angle === 0 ? knee : rotatePoint(knee, center, angle);
  return { segments, bbox, rd, cl: [...entry.callout.tip, ...paperKnee].map(round) };
}

// 輪郭を描く演算子（q … Q）。fill・border は RGB（0〜1）か null。どちらも無ければ空。
function outlineOps(segments, { fill, border, borderWidth }) {
  if (fill === null && border === null)
    return [];
  const ops = ['q'];
  if (fill !== null)
    ops.push(`${colorOps(fill)} rg`);
  if (border !== null)
    ops.push(`${colorOps(border)} RG`, `${num(borderWidth)} w`, '1 j');
  for (const { op, points } of segments) {
    const coords = points.flat().map(num).join(' ');
    ops.push(op === 'M' ? `${coords} m` : op === 'L' ? `${coords} l` : op === 'C' ? `${coords} c` : 'h');
  }
  ops.push(fill !== null && border !== null ? 'B' : fill !== null ? 'f' : 'S', 'Q');
  return ops;
}

module.exports = { BBOX_MARGIN, outlineOf, calloutGeometryOf, outlineOps };
