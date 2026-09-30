'use strict';

// テキストマークアップ注釈の外観（/AP /N）の中身を組む純粋層（spec-4-1 確定事項25・26）。
//
// 外観を必ず書くのは、他のビューアが /AP の無い注釈に既定の外観を作ってくれるとは
// 限らないためである。content stream は文字列で返し、pdf-lib の Form XObject に
// 包むのは op-annotate.js の仕事にする（ここは pdf-lib を知らない。テストは文字列の比較）。
//
// 四角は UL・UR・LL・LR の順（renderer/markup-quads.js と同じ約束）。

const KINDS = Object.freeze(['highlight', 'underline', 'strikeout']);
const SUBTYPES = Object.freeze({ highlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut' });

// 数の書き方。PDF は指数表記を読めないので固定小数にし、末尾の 0 は落とす。
function num(value) {
  const text = value.toFixed(2);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

// 色の成分の書き方。8bit の色が往復するよう小数 3 桁にし、末尾の 0 は落とす（spec-4b-1a 確定事項34）。
// 2 桁では、pdf.js が外観の rg から読むテキストの色が保存のたびに 1 段ずれた（#d92c2c → #d92b2b）。
function colorNum(value) {
  const text = value.toFixed(3);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

// 0〜1 の成分の並びを、rg・RG の前に置く形（空白区切り）にする。
function colorOps(rgb) {
  return rgb.map(colorNum).join(' ');
}

// '#rrggbb' → 0〜1 の RGB。読めなければ null。
function parseColor(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color ?? '');
  if (match === null)
    return null;
  const value = parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function isQuad(quad) {
  return Array.isArray(quad) && quad.length === 8 && quad.every(Number.isFinite);
}

// 線の太さ。四角の高さの 1/14、最低 0.5pt（renderer/markup-quads.js の lineWidth と同じ比）。
function lineWidthOf(height) {
  return Math.max(0.5, height / 14);
}

// 四角ごとの操作。ハイライトは塗り、下線・取り消し線は 1 本の線。
function quadOps(kind, quad) {
  const [x1, y1, x2, , , y3] = quad;
  const width = x2 - x1;
  const height = y1 - y3;
  if (kind === 'highlight')
    return `${num(x1)} ${num(y3)} ${num(width)} ${num(height)} re f`;
  const thickness = lineWidthOf(height);
  const y = kind === 'underline' ? y3 + thickness : y3 + height / 2;
  return `${num(thickness)} w ${num(x1)} ${num(y)} m ${num(x2)} ${num(y)} l S`;
}

// 外観の中身。戻り値は { content, bbox, blend, subtype }。形が違えば null。
//
//   content … content stream の文字列
//   bbox    … Form XObject の /BBox（注釈の /Rect と同じ）
//   blend   … ハイライトだけ 'Multiply'（ExtGState /BM。文字が透ける）
function appearanceOf({ kind, quads, rect, color, opacity = 1 }) {
  if (!KINDS.includes(kind) || !Array.isArray(quads) || quads.length === 0 || !quads.every(isQuad))
    return null;
  const rgb = parseColor(color);
  if (rgb === null || !Array.isArray(rect) || rect.length !== 4)
    return null;
  const alpha = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  const lines = ['/GS gs'];
  lines.push(kind === 'highlight'
    ? `${colorOps(rgb)} rg`
    : `${colorOps(rgb)} RG`);
  for (const quad of quads)
    lines.push(quadOps(kind, quad));
  return {
    content: lines.join('\n'),
    bbox: rect.map((value) => Math.round(value * 100) / 100),
    blend: kind === 'highlight' ? 'Multiply' : null,
    subtype: SUBTYPES[kind],
    rgb,
    opacity: alpha,
  };
}

module.exports = { KINDS, SUBTYPES, num, colorNum, colorOps, parseColor, appearanceOf };
