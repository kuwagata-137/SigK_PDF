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
const { decorOps, readableTextOps } = require('./free-text-decor.js');
const { matrixOf, boundsOf } = require('./shape-rotation.js');
const { calloutGeometryOf, outlineOps } = require('./callout-outline.js');

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

// 角度（spec-4b-4b 確定事項G1）。無いか、0 以上 360 未満の数（0 は回さない）。
function validAngle(angle) {
  return angle === undefined || (Number.isFinite(angle) && angle >= 0 && angle < 360);
}

// 吹き出し（spec-4b-4b 確定事項G2）。無いか、{ tip: [x, y] }。
function validCallout(callout) {
  return callout === undefined || (Array.isArray(callout?.tip) && callout.tip.length === 2 && callout.tip.every(Number.isFinite));
}

function validWidth(width) {
  return width === 'auto' || (Number.isFinite(width) && width > 0);
}

function validInset(inset) {
  return Array.isArray(inset) && inset.length === 2 && inset.every((value) => Number.isFinite(value) && value >= 0);
}

// 塗りと枠線の形（塗り・枠線の色は無いか #rrggbb、枠線があれば太さは正の数）。
function validDecor(entry) {
  if (entry.fill !== undefined && parseColor(entry.fill) === null)
    return false;
  if (entry.borderColor === undefined)
    return entry.borderWidth === undefined;
  return parseColor(entry.borderColor) !== null && Number.isFinite(entry.borderWidth) && entry.borderWidth > 0;
}

// 新しい形のテキストの entry の形（isFreeTextEntry に加えて、幅・行・中身の位置・太字・斜体・塗り・枠線）。
function isWrappedEntry(entry) {
  if (!isFreeTextEntry(entry) || !isWrapped(entry) || !validWidth(entry.width) || !validInset(entry.inset) || !validAngle(entry.angle))
    return false;
  if (!validCallout(entry.callout))
    return false;
  if (![entry.bold, entry.italic].every((flag) => flag === undefined || flag === true) || !validDecor(entry))
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

// 外観の中身。戻り値は free-text-appearance.js の freeTextAppearanceOf と同じ形に、ds（/DS の文字列）・fontName（外観の
// Resources で使う書体の名前）・fillRgb（/C）・borderWidth（/BS /W）と、半透明のときの group・prefix を足したもの。形が違えば
// null。measure は太字なら太字の書体の口。
//
// 不透明なら q → /GS gs → cm → 箱で切る → 塗り → 枠線 → 文字 → Q。不透明度が 1 未満なら、/GS gs を外した同じ中身を透明グループで
// 包み（op-annotate.js）、外側の先頭に何も描かない文字の命令（prefix）を置く（確定事項I3。事前調査 J）。
function wrappedAppearanceOf(entry, measure) {
  if (!isWrappedEntry(entry))
    return null;
  const { fontSize, rotation } = entry;
  const rgb = parseColor(entry.color);
  const fillRgb = entry.fill === undefined ? null : parseColor(entry.fill);
  const borderRgb = entry.borderColor === undefined ? null : parseColor(entry.borderColor);
  const borderWidth = borderRgb === null ? 0 : entry.borderWidth;
  const alpha = Number.isFinite(entry.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : 1;
  const group = alpha < 1;
  const rect = entry.rect.map((value) => Math.round(value * 100) / 100);
  const { matrix, clip, first } = frameOf(rect, rotation);
  const origin = [first[0] + entry.inset[0], first[1] - entry.inset[1]];
  // 吹き出しは箱で切り抜かず、輪郭（塗りと枠線）を 4 方向の cm の外（回す前の紙の座標）に描く（spec-4b-4b 確定事項G2）。
  const callout = entry.callout === undefined ? null : calloutGeometryOf({ rect, angle: entry.angle, fontSize, borderWidth, callout: entry.callout });
  const content = [
    'q',
    ...(group ? [] : ['/GS gs']),
    ...(callout === null ? [] : outlineOps(callout.segments, { fill: fillRgb, border: borderRgb, borderWidth })),
    `${matrix.map(num).join(' ')} 0 0 cm`,
    ...(callout === null ? [`${clip.map(num).join(' ')} re W n`, ...decorOps({ clip, fill: fillRgb, border: borderRgb, borderWidth })] : []),
    ...wrappedBlockOps({ lines: entry.lines, fontSize, rgb, origin, italic: entry.italic === true }, measure),
    'Q',
  ].join('\n');
  const outer = callout === null ? rect : callout.bbox;
  const appearance = {
    content,
    bbox: outer,
    rect: outer,
    // /DA の書体名は太字でも自分の印の名前（確定事項I4）。色は枠線があれば枠線の色、無ければ文字の色（確定事項I5）。
    da: `/${DA_FONT_NAME} ${num(fontSize)} Tf ${colorOps(borderRgb ?? rgb)} rg`,
    ds: defaultStyleOf({ fontSize, color: entry.color, bold: entry.bold === true, italic: entry.italic === true }),
    subtype: 'FreeText',
    rgb,
    fillRgb,
    borderWidth,
    opacity: alpha,
    lines: entry.lines,
    fontName: measure.name,
  };
  if (group) {
    appearance.group = true;
    appearance.prefix = readableTextOps({ name: measure.name, fontSize, rgb });
  }
  if (callout !== null)
    appearance.callout = { cl: callout.cl, rd: callout.rd };
  // 回したテキストは、外側の Form に /Matrix（箱の中心で紙の上の時計回り。吹き出しもしっぽを含めない箱の中心）を付け、/Rect を /BBox の
  // 写しの外接にする（四角・丸と同じ。spec-4b-4b 確定事項G1）。/BBox は回す前の箱（吹き出しは箱としっぽの範囲）のまま。
  if (entry.angle > 0) {
    appearance.matrix = matrixOf(rect, entry.angle);
    appearance.rect = boundsOf(outer, appearance.matrix).map((value) => Math.round(value * 100) / 100);
  }
  return appearance;
}

module.exports = { ITALIC_SKEW, isWrapped, matchesText, isWrappedEntry, wrappedBlockOps, wrappedAppearanceOf };
