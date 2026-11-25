'use strict';

// ハッチングの線の幾何の純粋層（spec-7-9 確定事項C1〜C4）。pdf-lib を知らない。renderer/hatch-geometry.js と同じ式で、一致はテストで
// 見張る（プロセスが違うので読み込み合わない）。
//
// 図形の回す前の箱（[x1 y1 x2 y2]）を覆う平行線を、種類ごとの向きで返す。線は箱の中心を通る 1 本を基準に、ハッチング間隔ごとに並べ、
// はみ出した分は外観の中で図形の形で切り抜く（W n）。向きは紙の座標（y が上）で、斜線は右上がり 45°、逆斜線は左上がり 45°。

const S = Math.SQRT1_2;
const DIRECTIONS = Object.freeze({
  diagonal: [[S, S]],
  reverse: [[S, -S]],
  cross: [[S, S], [S, -S]],
  horizontal: [[1, 0]],
  vertical: [[0, 1]],
  grid: [[1, 0], [0, 1]],
});
// 1 方向の線の本数の上限（大きな図形に細かい間隔を付けても、外観が際限なく大きくならないように間隔を広げる）。
const LINES_MAX = 2000;

function cornersOf([x1, y1, x2, y2]) {
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

function rangeOf(values) {
  return [Math.min(...values), Math.max(...values)];
}

function familyOf(box, direction, gap) {
  const [dx, dy] = direction;
  const center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  const local = cornersOf(box).map(([x, y]) => [x - center[0], y - center[1]]);
  const [sMin, sMax] = rangeOf(local.map(([x, y]) => x * -dy + y * dx));
  const [tMin, tMax] = rangeOf(local.map(([x, y]) => x * dx + y * dy));
  const step = Math.max(gap, (sMax - sMin) / LINES_MAX);
  const lines = [];
  for (let k = Math.ceil(sMin / step); k <= Math.floor(sMax / step); k += 1) {
    const s = k * step;
    const base = [center[0] - dy * s, center[1] + dx * s];
    lines.push([[base[0] + dx * tMin, base[1] + dy * tMin], [base[0] + dx * tMax, base[1] + dy * tMax]]);
  }
  return lines;
}

// ハッチングの線（[[始点, 終点], …]）。種類が分からないか箱がつぶれていれば空。
function linesOf(box, hatch) {
  const directions = DIRECTIONS[hatch?.pattern];
  if (directions === undefined || !(box[2] > box[0]) || !(box[3] > box[1]))
    return [];
  return directions.flatMap((direction) => familyOf(box, direction, hatch.gap));
}

// 書き込みのハッチングの基準の箱（回す前）。四角・丸は rect、多角形は回す前の頂点の外接。
function boxOf(entry) {
  if (entry.kind !== 'polygon')
    return entry.rect;
  const xs = entry.paths[0].map((point) => point[0]);
  const ys = entry.paths[0].map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

module.exports = { LINES_MAX, linesOf, boxOf };
