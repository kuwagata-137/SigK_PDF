'use strict';

// PDF の行列 [a b c d e f]（点 (x, y) は (a·x + c·y + e, b·x + d·y + f) へ写る）の計算と書き方。
// 透かし（watermark-layout.js）とフラット化（flatten-geometry.js・op-flatten.js）が使う。
// pdf-lib を知らない純関数。

const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

// m を当ててから n を当てる行列（PDF の積 m × n）。
function multiply(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function transformPoint([x, y], m) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// ページの /Rotate を 0・90・180・270 に寄せる。90 の倍数でなければ 0（pdf.js と同じ扱い）。
function normalizeRotation(rotate) {
  if (!Number.isFinite(rotate))
    return 0;
  const value = ((Math.round(rotate) % 360) + 360) % 360;
  return value % 90 === 0 ? value : 0;
}

// 行列の数は小数 4 桁（cos 45° ＝ 0.7071 を 2 桁に丸めると 0.71 になり粗い。spec-4-5 事前調査 A）。
// PDF は指数表記を読めないので固定小数にし、末尾の 0 と -0 の符号は落とす。
function num4(value) {
  const text = value.toFixed(4);
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  return trimmed === '-0' ? '0' : trimmed;
}

function matrixText(matrix) {
  return matrix.map(num4).join(' ');
}

module.exports = { IDENTITY, multiply, transformPoint, normalizeRotation, num4, matrixText };
