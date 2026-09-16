'use strict';

// フリーテキスト注釈の外観（/AP /N）の中身を組む純粋層（spec-4-2 確定事項25〜27）。
//
// annotation-appearance.js と同じく pdf-lib を知らない。文字は「文字を知る口」
// measure = { name, encode(line) → hex, width(line, size) → pt } を通してだけ触る
// （サブセットは encode を通したグリフからしか作られない。worker/font-embed.js）。
// pdf-lib の Form XObject と注釈の辞書に包むのは op-annotate.js の仕事である。
//
// 回転した表示で置いた文字は pdf.js の FreeText エディタと同じ式で回す
// （cm の回転行列と /Rotate。spec-4-2 事前調査 C）。

const { num, parseColor } = require('./annotation-appearance.js');

// 行の寸法。renderer/free-text-geometry.js に同じ値を持ち、一致はテストで見張る
// （プロセスが違うので import できない）。ascent／descent は Noto Sans JP の hhea で、
// Chromium が line-height 1.25 の入力欄でベースラインを置く位置と揃える（事前調査 D）。
const FONT_ASCENT = 1.16;
const FONT_DESCENT = 0.288;
const LINE_HEIGHT = 1.25;
const BASELINE = 1.061; // (LINE_HEIGHT − (FONT_ASCENT + FONT_DESCENT)) / 2 + FONT_ASCENT
const PADDING = 2;      // pt。上下左右
const RIGHT_SLACK = 1;  // 画面と pdf-lib の幅の差（英字で 0.5%）を吸う分。/Rect を表示の右へ伸ばす
const ROTATIONS = Object.freeze([0, 90, 180, 270]);

// pdf.js の createNewAppearanceStream と同じ式。rotation は置いたときの表示の回転。
// 戻り値は回転後の座標での { matrix（cm の a b c d）, clip（x y w h）, first（箱の左上） }。
function frameOf(rect, rotation) {
  const [x1, y1, x2, y2] = rect;
  let width = x2 - x1;
  let height = y2 - y1;
  if (rotation % 180 !== 0)
    [width, height] = [height, width];
  switch (rotation) {
    case 90: return { matrix: [0, 1, -1, 0], clip: [y1, -x2, width, height], first: [y1, -x1] };
    case 180: return { matrix: [-1, 0, 0, -1], clip: [-x2, -y2, width, height], first: [-x2, -y1] };
    case 270: return { matrix: [0, -1, 1, 0], clip: [-y2, x1, width, height], first: [-y2, x2] };
    default: return { matrix: [1, 0, 0, 1], clip: [x1, y1, width, height], first: [x1, y2] };
  }
}

// 表示の右へ slack だけ伸ばした /Rect。表示の右は紙の座標では回転ごとに向きが違う。
function widenRight(rect, rotation, slack) {
  const [x1, y1, x2, y2] = rect;
  switch (rotation) {
    case 90: return [x1, y1, x2, y2 + slack];
    case 180: return [x1 - slack, y1, x2, y2];
    case 270: return [x1, y1 - slack, x2, y2];
    default: return [x1, y1, x2 + slack, y2];
  }
}

// 行のブロックを描く演算子列。origin は（回転後の座標での）箱の左上。塊⑤の透かしも同じ口。
function textBlockOps({ lines, fontSize, rgb, origin }, measure) {
  const ops = [
    'BT',
    `${num(rgb[0])} ${num(rgb[1])} ${num(rgb[2])} rg`,
    `/${measure.name} ${num(fontSize)} Tf`,
    `${num(fontSize * LINE_HEIGHT)} TL`,
    `${num(origin[0] + PADDING)} ${num(origin[1] - PADDING - fontSize * BASELINE)} Td`,
  ];
  lines.forEach((line, index) => {
    if (index > 0)
      ops.push('T*');
    ops.push(`<${measure.encode(line)}> Tj`);
  });
  ops.push('ET');
  return ops;
}

function isRect(rect) {
  return Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite);
}

// 外観の中身。戻り値は { content, bbox, rect, da, subtype, rgb, opacity, lines }。形が違えば null。
//
//   content … content stream の文字列（q → cm → clip → 文字 → Q）
//   bbox    … Form XObject の /BBox。注釈の /Rect と同じで、表示の右へ RIGHT_SLACK 伸ばした値
//   da      … /DA の文字列（他のビューアが文字を直すときの既定の外観）
function freeTextAppearanceOf(entry, measure) {
  if (entry?.kind !== 'text' || typeof entry.text !== 'string' || entry.text.trim() === '')
    return null;
  const { fontSize, rotation, color } = entry;
  if (!Number.isFinite(fontSize) || fontSize <= 0 || !ROTATIONS.includes(rotation) || !isRect(entry.rect))
    return null;
  const rgb = parseColor(color);
  if (rgb === null)
    return null;

  const rect = widenRight(entry.rect, rotation, RIGHT_SLACK).map((value) => Math.round(value * 100) / 100);
  const { matrix, clip, first } = frameOf(rect, rotation);
  const lines = entry.text.split('\n');
  const content = [
    'q',
    '/GS gs',
    `${matrix.map(num).join(' ')} 0 0 cm`,
    `${clip.map(num).join(' ')} re W n`,
    ...textBlockOps({ lines, fontSize, rgb, origin: first }, measure),
    'Q',
  ].join('\n');
  return {
    content,
    bbox: rect,
    rect,
    da: `/${measure.name} ${num(fontSize)} Tf ${num(rgb[0])} ${num(rgb[1])} ${num(rgb[2])} rg`,
    subtype: 'FreeText',
    rgb,
    opacity: 1,
    lines,
  };
}

module.exports = {
  FONT_ASCENT, FONT_DESCENT, LINE_HEIGHT, BASELINE, PADDING, RIGHT_SLACK, ROTATIONS,
  frameOf, widenRight, textBlockOps, freeTextAppearanceOf,
};
