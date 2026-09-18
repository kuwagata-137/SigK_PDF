'use strict';

// ノート注釈（/Text）の外観（/AP /N）の中身を組む純粋層（spec-4-4 確定事項22〜25）。
//
// annotation-appearance.js と同じく pdf-lib を知らない。content stream は文字列で返し、
// Form XObject と注釈の辞書（/Popup を含む）に包むのは op-annotate.js の仕事である。
// 付箋の絵（NOTE_SHAPE）は renderer/note-graphics.js と同じ配列で、一致はテストで見張る
// （プロセスが違うので import できない）。絵は 20×20・y 下向きの座標で持ち、ここで
// /Rect の左上 (x1, y2) を原点に紙の向き（y 上向き）へ直す。

const { num, parseColor } = require('./annotation-appearance.js');

// 付箋の大きさ（pt）。画面は 20 × 96/72 px で固定、印刷は 20 × 倍率（確定事項40）。
const ICON_SIZE = 20;
// 線の色（#4a4a4a）。
const STROKE_RGB = Object.freeze([0.29, 0.29, 0.29]);
// /Popup の箱。アイコンの右隣に置く（確定事項24）。
const POPUP_WIDTH = 180;
const POPUP_HEIGHT = 100;
const POPUP_GAP = 2;
// Print ＋ NoZoom ＋ NoRotate（確定事項23）。
const FLAGS = 28;

// 角丸の吹き出し（角の半径 1.5・κ 0.5523）と、左下のしっぽ、本文の印 2 本。
const NOTE_SHAPE = Object.freeze({
  outline: Object.freeze([
    ['M', 3, 1.5], ['L', 17, 1.5], ['C', 17.83, 1.5, 18.5, 2.17, 18.5, 3], ['L', 18.5, 13],
    ['C', 18.5, 13.83, 17.83, 14.5, 17, 14.5], ['L', 9, 14.5], ['L', 5.5, 18], ['L', 5.5, 14.5], ['L', 3, 14.5],
    ['C', 2.17, 14.5, 1.5, 13.83, 1.5, 13], ['L', 1.5, 3], ['C', 1.5, 2.17, 2.17, 1.5, 3, 1.5],
  ].map((segment) => Object.freeze(segment))),
  lines: Object.freeze([Object.freeze([[5.5, 6.5], [14.5, 6.5]]), Object.freeze([[5.5, 9.5], [11.5, 9.5]])]),
});

function round(value) {
  return Math.round(value * 100) / 100;
}

function isRect(rect) {
  return Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) && rect[2] > rect[0] && rect[3] > rect[1];
}

// ノートの entry の形。箱が右上へ広がる 4 つの数、色が #rrggbb、本文が文字列（空でもよい）、作成者が文字列か無し。
function isNoteEntry(entry) {
  if (entry?.kind !== 'note' || !isRect(entry.rect) || parseColor(entry.color) === null)
    return false;
  return typeof entry.text === 'string' && (entry.author === undefined || typeof entry.author === 'string');
}

// 20×20・y 下向きの点を、箱の左上を原点にした紙の座標へ。箱が 20 でなければ合わせて伸ばす。
function mapper([x1, y1, x2, y2]) {
  const sx = (x2 - x1) / ICON_SIZE;
  const sy = (y2 - y1) / ICON_SIZE;
  return (px, py) => `${num(x1 + px * sx)} ${num(y2 - py * sy)}`;
}

function outlineOps(to) {
  return NOTE_SHAPE.outline.map(([op, ...values]) => {
    if (op === 'C')
      return `${to(values[0], values[1])} ${to(values[2], values[3])} ${to(values[4], values[5])} c`;
    return `${to(values[0], values[1])} ${op === 'M' ? 'm' : 'l'}`;
  });
}

function lineOps(to) {
  return NOTE_SHAPE.lines.map(([from, until]) => `${to(from[0], from[1])} m ${to(until[0], until[1])} l S`);
}

// 外観の中身。戻り値は { content, bbox, subtype, rgb, opacity, flags, popupRect }。形が違えば null。
function noteAppearanceOf(entry) {
  if (!isNoteEntry(entry))
    return null;
  const rgb = parseColor(entry.color);
  const alpha = Number.isFinite(entry.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : 1;
  const to = mapper(entry.rect);
  const content = [
    '/GS gs',
    `${rgb.map(num).join(' ')} rg ${STROKE_RGB.map(num).join(' ')} RG 1 w 1 j 1 J`,
    ...outlineOps(to),
    'h B',
    ...lineOps(to),
  ].join('\n');
  const [, , x2, y2] = entry.rect;
  return {
    content,
    bbox: entry.rect.map(round),
    subtype: 'Text',
    rgb,
    opacity: alpha,
    flags: FLAGS,
    popupRect: [x2 + POPUP_GAP, y2 - POPUP_HEIGHT, x2 + POPUP_GAP + POPUP_WIDTH, y2].map(round),
  };
}

module.exports = { ICON_SIZE, NOTE_SHAPE, STROKE_RGB, POPUP_WIDTH, POPUP_HEIGHT, FLAGS, isNoteEntry, noteAppearanceOf };
