'use strict';

// 透かしの置き方の幾何（spec-4-5 確定事項12〜18）。pdf-lib を知らない純関数。
//
// 画面のプレビュー（renderer/watermark-geometry.js）に同じ式を持ち、一致は
// test/watermark-geometry.test.js が見張る（プロセスが違うので import はしない）。
//
// 座標の約束:
//   box      … 基準の箱（CropBox。無ければ MediaBox）[x0, y0, x1, y1]。紙の座標で y は上向き
//   表示     … ページの /Rotate を当てたあとの見た目。左上が原点で y は下向き
//   素の箱   … 透かしの Form XObject の中の座標で width × height。中心が原点

// 大きさの倍率 k（論点5）。回した透かし全体が、紙の幅と高さの k 倍に収まる。
const SIZE_RATIOS = Object.freeze({ small: 0.25, medium: 0.5, large: 0.8 });
// 端に寄せるときの紙の縁からの余白（紙の短い辺に対する割合）。
const MARGIN_RATIO = 0.05;
// 向き（論点4）。斜めは表示で左下から右上へ。
const ANGLES = Object.freeze({ diagonal: 45, horizontal: 0 });
// 位置（論点3）。左上から右へ、上の行から下の行へ。
const POSITIONS = Object.freeze([
  'top-left', 'top', 'top-right',
  'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
]);

// 行列の数は小数 4 桁（cos 45° ＝ 0.7071 を 2 桁に丸めると 0.71 になり粗い。事前調査 A）。
function num4(value) {
  const text = value.toFixed(4);
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  return trimmed === '-0' ? '0' : trimmed;
}

// ページの /Rotate を 0・90・180・270 に寄せる。90 の倍数でなければ 0（pdf.js と同じ扱い）。
function normalizeRotation(rotate) {
  if (!Number.isFinite(rotate))
    return 0;
  const value = ((Math.round(rotate) % 360) + 360) % 360;
  return value % 90 === 0 ? value : 0;
}

function isBox(box) {
  return Array.isArray(box) && box.length === 4 && box.every(Number.isFinite)
    && box[0] !== box[2] && box[1] !== box[3];
}

// 表示の幅と高さ。/Rotate 90・270 は紙の縦横が入れ替わって見える。
function displaySize(box, rotate) {
  const width = Math.abs(box[2] - box[0]);
  const height = Math.abs(box[3] - box[1]);
  return rotate === 90 || rotate === 270 ? { width: height, height: width } : { width, height };
}

// 素の箱を angle 度回した外形。
function outerSize(width, height, angle) {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return { width: width * cos + height * sin, height: width * sin + height * cos };
}

// 表示の中心。中は紙の中央、端は縁から余白をとって外形を寄せる（確定事項16）。
function centerOf(display, outer, scale, position) {
  const index = POSITIONS.indexOf(position);
  const column = index % 3;
  const row = Math.floor(index / 3);
  const margin = MARGIN_RATIO * Math.min(display.width, display.height);
  const halfWidth = (scale * outer.width) / 2;
  const halfHeight = (scale * outer.height) / 2;
  const x = [margin + halfWidth, display.width / 2, display.width - margin - halfWidth][column];
  const y = [margin + halfHeight, display.height / 2, display.height - margin - halfHeight][row];
  return [x, y];
}

// 表示の点を紙の座標へ（確定事項17）。
function toPaper([x, y], box, rotate) {
  const x0 = Math.min(box[0], box[2]);
  const y0 = Math.min(box[1], box[3]);
  const x1 = Math.max(box[0], box[2]);
  const y1 = Math.max(box[1], box[3]);
  switch (rotate) {
    case 90: return [x0 + y, y0 + x];
    case 180: return [x1 - x, y0 + y];
    case 270: return [x1 - y, y1 - x];
    default: return [x0 + x, y1 - y];
  }
}

// 透かしの XObject を置く cm の 6 数。形が違えば null。
//   width・height … 素の箱の大きさ（XObject の中の座標）
//   angle        … 表示の角度（度）。size は SIZE_RATIOS のキー、position は POSITIONS のどれか
function placementOf({ box, rotate = 0, width, height, angle, size, position }) {
  if (!isBox(box) || !(width > 0) || !(height > 0) || !Number.isFinite(angle))
    return null;
  if (!Object.hasOwn(SIZE_RATIOS, size) || !POSITIONS.includes(position))
    return null;
  const rotation = normalizeRotation(rotate);
  const display = displaySize(box, rotation);
  const outer = outerSize(width, height, angle);
  const scale = SIZE_RATIOS[size] * Math.min(display.width / outer.width, display.height / outer.height);
  const [x, y] = toPaper(centerOf(display, outer, scale, position), box, rotation);
  const phi = ((angle + rotation) * Math.PI) / 180;
  const cos = Math.cos(phi) * scale;
  const sin = Math.sin(phi) * scale;
  return [cos, sin, -sin, cos, x, y];
}

function matrixText(matrix) {
  return matrix.map(num4).join(' ');
}

module.exports = {
  SIZE_RATIOS, MARGIN_RATIO, ANGLES, POSITIONS,
  num4, normalizeRotation, displaySize, outerSize, placementOf, matrixText,
};
