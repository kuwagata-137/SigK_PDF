'use strict';

// 注釈の外観をページへ置く行列（spec-4-5 確定事項29）。pdf-lib を知らない純関数。

const { IDENTITY, multiply, transformPoint, normalizeRotation } = require('./pdf-matrix.js');

function isNumbers(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function normalizeRect(rect) {
  return [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
}

// ISO 32000-1 12.5.5（外観の描き方）の A。外観の /BBox を /Matrix で写した外接の箱が、注釈の /Rect に
// ちょうど重なる拡大と移動で、cm に置く（/Matrix は Do が掛ける）。箱の幅か高さが 0 ならその向きは
// 拡大しない。形が違えば null。
function placementMatrix(bbox, matrix, rect) {
  if (!isNumbers(bbox, 4) || !isNumbers(matrix, 6) || !isNumbers(rect, 4))
    return null;
  const corners = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]
    .map((point) => transformPoint(point, matrix));
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const [tx1, ty1, tx2, ty2] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const [rx1, ry1, rx2, ry2] = normalizeRect(rect);
  const sx = tx2 - tx1 === 0 ? 1 : (rx2 - rx1) / (tx2 - tx1);
  const sy = ty2 - ty1 === 0 ? 1 : (ry2 - ry1) / (ty2 - ty1);
  return [sx, 0, 0, sy, rx1 - tx1 * sx, ry1 - ty1 * sy];
}

// NoRotate（ISO 32000-1 12.5.3）の注釈は、ページが回っても上向きに見える。焼くときは /Rect の左上を
// 軸に、ページの /Rotate ぶん反時計回りに回す（表示ではページの回転と打ち消し合って上向きのまま）。
function noRotateMatrix(rect, rotate) {
  const rotation = normalizeRotation(rotate);
  if (rotation === 0)
    return [...IDENTITY];
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const [x1, , , y2] = normalizeRect(rect);
  return multiply(multiply([1, 0, 0, 1, -x1, -y2], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, x1, y2]);
}

// 焼き込みの行列。A（12.5.5）に、NoRotate のときだけ回転を重ねる。形が違えば null。
function bakeMatrix({ bbox, matrix = IDENTITY, rect, rotate = 0, noRotate = false }) {
  const placement = placementMatrix(bbox, matrix, rect);
  if (placement === null)
    return null;
  return noRotate ? multiply(placement, noRotateMatrix(rect, rotate)) : placement;
}

module.exports = { placementMatrix, noRotateMatrix, bakeMatrix };
