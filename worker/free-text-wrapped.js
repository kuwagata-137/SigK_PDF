'use strict';

// 新しい形のテキスト（折り返す形。spec-4b-4a）の外観（/AP /N）の中身を組む純粋層（確定事項I1・I2・I4・I5）。
//
// 行は画面が決めて lines で渡す（ワーカーは折り返さない。字の幅の測り方を 2 つ持たないため）。ワーカーは lines が本文を
// 改行の位置で割ったものかだけを見て、違えば断る。行ごとに Tm で置き、斜体は Tm の傾き（0.25。画面の擬似斜体と画素で一致。
// 事前調査 B）で出す。箱は /Rect のまま（今までの形のように表示の右へ 1pt 伸ばさない。画面と字幅が一致するため）。
// inset は箱の左上から中身の左上まで（余白と斜体の分。画面の free-text-layout.js の insetOf）。
//
// pdf-lib を知らないのは free-text-appearance.js と同じで、文字は「文字を知る口」measure を通してだけ触る。

const { num, colorOps, parseColor } = require('./annotation-appearance.js');
const { LINE_HEIGHT, BASELINE, frameOf, isFreeTextEntry } = require('./free-text-appearance.js');
const { defaultStyleOf } = require('./default-style.js');
const { DA_FONT_NAME } = require('./font-embed.js');

// 斜体の傾き（Tm の c）。画面の CSS font-style: italic（斜体の書体が無いときの擬似斜体）と同じ形になる値（事前調査 B）。
const ITALIC_SKEW = 0.25;

// 新しい形か（width を持つ）。
function isWrapped(entry) {
  return entry?.width !== undefined;
}

// lines が本文を明示の改行で割り、その中をさらに割ったものか。
function matchesText(lines, text) {
  let at = 0;
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    let joined = '';
    do {
      if (at >= lines.length)
        return false;
      joined += lines[at];
      at += 1;
    } while (joined.length < paragraph.length);
    if (joined !== paragraph)
      return false;
  }
  return at === lines.length;
}

function validWidth(width) {
  return width === 'auto' || (Number.isFinite(width) && width > 0);
}

function validInset(inset) {
  return Array.isArray(inset) && inset.length === 2 && inset.every((value) => Number.isFinite(value) && value >= 0);
}

// 新しい形のテキストの entry の形（isFreeTextEntry に加えて、幅・行・中身の位置・太字・斜体）。
function isWrappedEntry(entry) {
  if (!isFreeTextEntry(entry) || !isWrapped(entry) || !validWidth(entry.width) || !validInset(entry.inset))
    return false;
  if (![entry.bold, entry.italic].every((flag) => flag === undefined || flag === true))
    return false;
  return Array.isArray(entry.lines) && entry.lines.every((line) => typeof line === 'string') && matchesText(entry.lines, entry.text);
}

// 行のブロック。origin は（回転後の座標での）中身の左上。空の行は描かない（行送りは数える）。
function wrappedBlockOps({ lines, fontSize, rgb, origin, italic }, measure) {
  const ops = ['BT', `${colorOps(rgb)} rg`, `/${measure.name} ${num(fontSize)} Tf`];
  const skew = italic ? ITALIC_SKEW : 0;
  lines.forEach((line, index) => {
    if (line === '')
      return;
    const y = origin[1] - fontSize * BASELINE - fontSize * LINE_HEIGHT * index;
    ops.push(`1 0 ${num(skew)} 1 ${num(origin[0])} ${num(y)} Tm`, `<${measure.encode(line)}> Tj`);
  });
  ops.push('ET');
  return ops;
}

// 外観の中身。戻り値は free-text-appearance.js の freeTextAppearanceOf と同じ形に、ds（/DS の文字列）と fontName
// （外観の Resources で使う書体の名前）を足したもの。形が違えば null。measure は太字なら太字の書体の口。
function wrappedAppearanceOf(entry, measure) {
  if (!isWrappedEntry(entry))
    return null;
  const { fontSize, rotation } = entry;
  const rgb = parseColor(entry.color);
  const alpha = Number.isFinite(entry.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : 1;
  const rect = entry.rect.map((value) => Math.round(value * 100) / 100);
  const { matrix, clip, first } = frameOf(rect, rotation);
  const origin = [first[0] + entry.inset[0], first[1] - entry.inset[1]];
  const content = [
    'q',
    '/GS gs',
    `${matrix.map(num).join(' ')} 0 0 cm`,
    `${clip.map(num).join(' ')} re W n`,
    ...wrappedBlockOps({ lines: entry.lines, fontSize, rgb, origin, italic: entry.italic === true }, measure),
    'Q',
  ].join('\n');
  return {
    content,
    bbox: rect,
    rect,
    // /DA の書体名は太字でも自分の印の名前（確定事項I4）。色は文字の色（枠線を持てば枠線の色。確定事項I5）。
    da: `/${DA_FONT_NAME} ${num(fontSize)} Tf ${colorOps(rgb)} rg`,
    ds: defaultStyleOf({ fontSize, color: entry.color, bold: entry.bold === true, italic: entry.italic === true }),
    subtype: 'FreeText',
    rgb,
    opacity: alpha,
    lines: entry.lines,
    fontName: measure.name,
  };
}

module.exports = { ITALIC_SKEW, isWrapped, matchesText, isWrappedEntry, wrappedBlockOps, wrappedAppearanceOf };
