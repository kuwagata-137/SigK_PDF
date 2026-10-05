'use strict';

// 四角・丸の回転を、保存では外観の /Matrix と外接の /Rect に、読み戻しでは外観の /BBox・/Matrix と /Rect から
// 角度と回す前の箱に直す純粋層（spec-4b-2 確定事項29・32・34）。pdf-lib を知らない。
//
// 角度は画面で時計回りの度、回転の中心は箱の中心。/Matrix の式は renderer/shape-rotation.js の matrixOf と同じで、
// 一致はテストで見張る（プロセスが違うので読み込み合わない）。

const { IDENTITY, multiply, transformPoint } = require('./pdf-matrix.js');
const { placementMatrix } = require('./flatten-geometry.js');

// 「同じ大きさの拡大＋回転」とみなす差（拡大の大きさに対する割合。確定事項34）。小さな図形では /Rect の小数 2 桁の丸め
// （辺ごとに 0.005pt、幅で 0.01pt）だけで縦横の拡大がこれ以上ずれるので、その分（RECT_ROUNDING ÷ 外接の幅・高さ）も許す。
const SIMILARITY_TOLERANCE = 0.001;
const RECT_ROUNDING = 0.011;
// 読み込んだ角度を整数とみなす差。
const INTEGER_TOLERANCE = 0.01;

function round(value, digits = 2) {
  const scale = 10 ** digits;
  const rounded = Math.round(value * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function isNumbers(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

// 0 以上 360 未満の小数 2 桁（整数との差が 0.01 未満なら整数）。
function normalizeAngle(angle) {
  const value = round(((angle % 360) + 360) % 360);
  const nearest = Math.round(value);
  const snapped = Math.abs(value - nearest) < INTEGER_TOLERANCE ? nearest : value;
  return snapped >= 360 ? 0 : snapped;
}

function centerOf([x1, y1, x2, y2]) {
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

// 紙の座標の点を center まわりに、画面で時計回りに angle 度回す（renderer/shape-rotation.js の rotatePoint と同じ式）。cos・sin は丸めない
// （多角形の /Vertices を回すのに使う。/Matrix の 4 桁の丸めで回すと、開き直すたびに頂点がずれるため。spec-4b-5a 確定事項36）。
function rotatePoint([x, y], [cx, cy], angle) {
  const t = (angle * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];
}

// 外観の /Matrix（確定事項29）。箱の中心まわりに、画面で時計回りに angle 度。cos・sin と移動は小数 4 桁。
function matrixOf(box, angle) {
  const t = (angle * Math.PI) / 180;
  const cos = round(Math.cos(t), 4);
  const sin = round(Math.sin(t), 4);
  const [cx, cy] = centerOf(box);
  const [a, b, c, d] = [cos, round(-sin, 4), sin, cos];
  return [a, b, c, d, round(cx - (a * cx + c * cy), 4), round(cy - (b * cx + d * cy), 4)];
}

// /BBox の 4 隅を行列で写した外接。
function boundsOf(box, matrix) {
  const corners = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]].map((point) => transformPoint(point, matrix));
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// 注釈の /Rect（確定事項29）。/BBox を書く /Matrix で写した外接（小数 2 桁）。
function rectOf(box, angle) {
  return boundsOf(box, matrixOf(box, angle)).map((value) => round(value));
}

// /Rect を外接と比べた拡大の差の許し（割合）。0.1% か、/Rect の丸めが生む差の大きい方。
function toleranceOf(rect) {
  const width = Math.abs(rect[2] - rect[0]);
  const height = Math.abs(rect[3] - rect[1]);
  const rounding = (side) => (side > 0 ? RECT_ROUNDING / side : 0);
  return Math.max(SIMILARITY_TOLERANCE, rounding(width) + rounding(height));
}

// 行列の [a b c d] が「同じ大きさの拡大＋回転」か。
function isSimilarity([a, b, c, d], tolerance) {
  const scale = Math.hypot(a, b);
  return scale > 0 && Math.abs(a - d) <= scale * tolerance && Math.abs(b + c) <= scale * tolerance;
}

// 軸に沿った正の拡大だけ（縦と横で違ってよい）か。
function isAxisAligned([a, b, c, d], tolerance) {
  return a > 0 && d > 0 && Math.abs(b) <= a * tolerance && Math.abs(c) <= d * tolerance;
}

// 外観から角度と回す前の箱を読む（確定事項34）。戻り値は { box, angle }（回っている）、null（回っていない・読めない）、
// 'skewed'（回転とゆがみが混ざる・裏返し）。
//
// 外観を紙へ置く写しは 12.5.5 の T（/Matrix のあと、写した外接を /Rect へ合わせる拡大と移動 A）。A の拡大が縦横で同じなら、
// 角度と縦横の比は /Matrix そのものから求め（/Rect の丸めを持ち込まない）、箱の中心は /Rect の中心にする（回した四角は中心に
// 対して点対称なので、外接の中心が箱の中心の写る先になる）。A の拡大が縦横で違えば、回った外観はゆがむ。
function rotationOf({ rect, bbox, matrix = IDENTITY }) {
  if (!isNumbers(rect, 4) || !isNumbers(bbox, 4) || !isNumbers(matrix, 6) || bbox[0] === bbox[2] || bbox[1] === bbox[3])
    return null;
  const placement = placementMatrix(bbox, matrix, rect);
  if (placement === null || !(Math.hypot(matrix[0], matrix[1]) > 0))
    return null;
  const [sx, , , sy] = placement;
  const tolerance = toleranceOf(rect);
  const uniform = sx > 0 && sy > 0 && Math.abs(sx - sy) <= Math.max(sx, sy) * tolerance;
  if (!uniform || !isSimilarity(matrix, SIMILARITY_TOLERANCE)) {
    // 回っていない外観の伸び縮み（今までどおり /Rect を箱にする）と、読めない形（ゆがみ・裏返し）を分ける。
    return isAxisAligned(multiply(matrix, placement), tolerance) ? null : 'skewed';
  }
  const angle = normalizeAngle((Math.atan2(-matrix[1], matrix[0]) * 180) / Math.PI);
  if (angle === 0)
    return null;
  const placementScale = Math.abs(sx - 1) <= tolerance && Math.abs(sy - 1) <= tolerance ? 1 : (sx + sy) / 2;
  const scale = Math.hypot(matrix[0], matrix[1]) * placementScale;
  const [cx, cy] = centerOf([Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])]);
  const halfWidth = (Math.abs(bbox[2] - bbox[0]) * scale) / 2;
  const halfHeight = (Math.abs(bbox[3] - bbox[1]) * scale) / 2;
  return { box: [cx - halfWidth, cy - halfHeight, cx + halfWidth, cy + halfHeight].map((value) => round(value)), angle };
}

module.exports = { SIMILARITY_TOLERANCE, normalizeAngle, centerOf, rotatePoint, matrixOf, boundsOf, rectOf, rotationOf };
