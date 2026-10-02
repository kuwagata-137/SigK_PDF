'use strict';

// 回した FreeText（テキストと吹き出し）の箱と角度の読み（spec-4b-4b 確定事項H2）。読むだけで、何も書かない。
//
// 角度と「回っていない・読めない（skewed）」の見分けは四角・丸と同じ rotationOf（shape-rotation.js）に任せる。箱は、外観を紙へ
// 置く写し（12.5.5 の A。/BBox を /Matrix で写した外接を /Rect に合わせる拡大と移動）がほぼ恒等なら、/BBox（吹き出しは /BBox を
// /RD で縮めた inner）をそのまま回す前の箱にする。書いた値をそのまま読むので、保存と読み戻しをくり返しても箱がずれない
// （/Rect の中心から組み直すと、/Rect の丸めの分だけ動きうる）。ほぼ恒等でなければ（他のアプリが /Rect を動かした）、
// 回す中心（/Matrix の動かない点＝箱の中心）を A で写した位置へ箱をずらす。吹き出しでない FreeText は rotationOf の箱を使う。

const { rotationOf } = require('./shape-rotation.js');
const { placementMatrix } = require('./flatten-geometry.js');
const { transformPoint } = require('./pdf-matrix.js');

// A をほぼ恒等とみなす、/BBox の四隅の動きの上限（pt）。/Rect を小数 2 桁に丸めた差（最大 0.005×2）に、/Matrix の小数 4 桁の
// 丸めの差を足しても収まる値（事前調査 O で最大 0.027pt）。
const PLACEMENT_SLACK = 0.03;

function round(value) {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function centerOf([x1, y1, x2, y2]) {
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

// A が /BBox の四隅をどれも PLACEMENT_SLACK より動かさないか。
function nearlyIdentity(placement, bbox, matrix) {
  const corners = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map((point) => transformPoint(point, matrix));
  return corners.every((point) => {
    const [x, y] = transformPoint(point, placement);
    return Math.abs(x - point[0]) <= PLACEMENT_SLACK && Math.abs(y - point[1]) <= PLACEMENT_SLACK;
  });
}

// { box, angle }（回っている）・null（回っていない・読めない）・'skewed'（回転とゆがみが混ざる・裏返し）。inner は吹き出しの
// 回す前の箱（/BBox を /RD で縮めたもの）で、無ければ /BBox が箱。
function freeTextRotationOf({ rect, bbox, matrix, inner = null }) {
  const turn = rotationOf({ rect, bbox, matrix });
  if (turn === null || turn === 'skewed')
    return turn;
  const placement = placementMatrix(bbox, matrix, rect);
  const box = inner ?? bbox;
  if (nearlyIdentity(placement, bbox, matrix))
    return { box: box.map(round), angle: turn.angle };
  if (inner === null)
    return turn;
  const center = centerOf(inner);
  const [x, y] = transformPoint(center, placement);
  const [dx, dy] = [x - center[0], y - center[1]];
  return { box: [inner[0] + dx, inner[1] + dy, inner[2] + dx, inner[3] + dy].map(round), angle: turn.angle };
}

module.exports = { PLACEMENT_SLACK, freeTextRotationOf };
