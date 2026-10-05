'use strict';

// 矢印の先の点の純粋層（spec-4-3 確定事項10・22、spec-4b-5a 確定事項7・8・34）。pdf-lib を知らない。
//
// renderer/arrow-head.js と同じ式で、一致はテストで見張る（プロセスが違うので import できない）。
// shape-appearance.js から移した（spec-4b-5a a0）うえで、塗った三角を足した（a1）。

// 開いた矢じり: 翼の長さは max(ARROW_MIN_LENGTH, 線幅 × ARROW_LENGTH_RATIO)、線からの開き ARROW_ANGLE。
const ARROW_MIN_LENGTH = 9;
const ARROW_LENGTH_RATIO = 6;
const ARROW_ANGLE = Math.PI / 6;
// 塗った三角: 長さは max(CLOSED_MIN_LENGTH, 線幅 × CLOSED_LENGTH_RATIO)、開き CLOSED_ANGLE（決定61 ①）。
const CLOSED_MIN_LENGTH = 12;
const CLOSED_LENGTH_RATIO = 4;
const CLOSED_ANGLE = Math.PI / 7;

function wings(from, to, length, opening) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const wing = (turn) => [to[0] + Math.cos(angle + turn) * length, to[1] + Math.sin(angle + turn) * length];
  return [wing(Math.PI - opening), wing(-(Math.PI - opening))];
}

// 矢じりの翼 2 点（終点 to から線の逆向きへ開く）。
function arrowHead(from, to, lineWidth) {
  return wings(from, to, Math.max(ARROW_MIN_LENGTH, lineWidth * ARROW_LENGTH_RATIO), ARROW_ANGLE);
}

// 塗った三角。left・right は底の 2 角、base は軸を止める底の中点。
function closedHead(from, to, lineWidth) {
  const length = Math.max(CLOSED_MIN_LENGTH, lineWidth * CLOSED_LENGTH_RATIO);
  const [left, right] = wings(from, to, length, CLOSED_ANGLE);
  const back = length * Math.cos(CLOSED_ANGLE);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  return { left, right, base: [to[0] - Math.cos(angle) * back, to[1] - Math.sin(angle) * back] };
}

module.exports = { ARROW_MIN_LENGTH, ARROW_LENGTH_RATIO, ARROW_ANGLE, CLOSED_MIN_LENGTH, CLOSED_LENGTH_RATIO, CLOSED_ANGLE, arrowHead, closedHead };
