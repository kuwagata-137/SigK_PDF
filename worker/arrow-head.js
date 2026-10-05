'use strict';

// 矢じりの点の純粋層（spec-4-3 確定事項10・22）。pdf-lib を知らない。
//
// renderer/shape-geometry.js の arrowHead と同じ式で、一致はテストで見張る（プロセスが違うので import できない）。
// shape-appearance.js から移した（spec-4b-5a a0。中身は変えていない）。

// 開いた矢じり: 翼の長さは max(ARROW_MIN_LENGTH, 線幅 × ARROW_LENGTH_RATIO)、線からの開き ARROW_ANGLE。
const ARROW_MIN_LENGTH = 9;
const ARROW_LENGTH_RATIO = 6;
const ARROW_ANGLE = Math.PI / 6;

// 矢じりの翼 2 点（終点 to から線の逆向きへ開く）。
function arrowHead(from, to, lineWidth) {
  const length = Math.max(ARROW_MIN_LENGTH, lineWidth * ARROW_LENGTH_RATIO);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const wing = (turn) => [to[0] + Math.cos(angle + turn) * length, to[1] + Math.sin(angle + turn) * length];
  return [wing(Math.PI - ARROW_ANGLE), wing(-(Math.PI - ARROW_ANGLE))];
}

module.exports = { ARROW_MIN_LENGTH, ARROW_LENGTH_RATIO, ARROW_ANGLE, arrowHead };
