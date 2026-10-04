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
const { turnOf } = require('./shape-rotation.js');
const { isCallout, validCallout, calloutPartsOf } = require('./free-text-callout.js');

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

// 塗りと枠線の形（塗り・枠線の色は無いか #rrggbb、枠線があれば太さは正の数）。
function validDecor(entry) {
  if (entry.fill !== undefined && parseColor(entry.fill) === null)
    return false;
  if (entry.borderColor === undefined)
    return entry.borderWidth === undefined;
  return parseColor(entry.borderColor) !== null && Number.isFinite(entry.borderWidth) && entry.borderWidth > 0;
}

// 自由な角度（spec-4b-4b 確定事項A1）。無いか、0 より大きく 360 未満。
function validAngle(angle) {
  return angle === undefined || (Number.isFinite(angle) && angle > 0 && angle < 360);
}

// 新しい形のテキストの entry の形（isFreeTextEntry に加えて、幅・行・中身の位置・太字・斜体・塗り・枠線・角度・吹き出しのしっぽ）。
function isWrappedEntry(entry) {
  if (!isFreeTextEntry(entry) || !isWrapped(entry) || !validWidth(entry.width) || !validInset(entry.inset) || !validAngle(entry.angle))
    return false;
  if (!validCallout(entry, entry.fill !== undefined, entry.borderColor !== undefined))
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
// Resources で使う書体の名前）・fillRgb（/C）・borderWidth（/BS /W）と、半透明のときの group・prefix、回したときの matrix を
// 足したもの。形が違えば null。measure は太字なら太字の書体の口。
//
// 回したテキスト（angle。spec-4b-4b 確定事項H1）は、中身はそのままで、外側の Form に箱の中心まわりの /Matrix を付け、/BBox は
// 回す前の箱、注釈の /Rect は /BBox を /Matrix で写した外接にする（四角・丸と同じ。op-annotate.js が外側の Form にだけ付ける）。
//
// 不透明なら q → /GS gs → cm → 箱で切る → 塗り → 枠線 → 文字 → Q。不透明度が 1 未満なら、/GS gs を外した同じ中身を透明グループで
// 包み（op-annotate.js）、外側の先頭に何も描かない文字の命令（prefix）を置く（確定事項I3。事前調査 J）。
//
// 吹き出し（tip を持つ。spec-4b-4b 確定事項H2・H3）は、箱の四角の塗りと枠線の代わりに、角の丸い箱としっぽの輪郭を箱で切る前に
// 描く（free-text-callout.js）。/BBox と回していないときの /Rect は箱と先を含む外接で、/IT・/CL・/RD・/LE の値を callout に添える。
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
  const callout = isCallout(entry) ? calloutPartsOf(entry, { rect, first, fillRgb, borderRgb, borderWidth }) : null;
  const bbox = callout?.bbox ?? rect;
  const content = [
    'q',
    ...(group ? [] : ['/GS gs']),
    `${matrix.map(num).join(' ')} 0 0 cm`,
    ...(callout?.ops ?? []),
    `${clip.map(num).join(' ')} re W n`,
    ...(callout === null ? decorOps({ clip, fill: fillRgb, border: borderRgb, borderWidth }) : []),
    ...wrappedBlockOps({ lines: entry.lines, fontSize, rgb, origin, italic: entry.italic === true }, measure),
    'Q',
  ].join('\n');
  const appearance = {
    content,
    bbox,
    rect: bbox,
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
    ...turnOf(rect, entry.angle, bbox),
  };
  if (callout !== null)
    appearance.callout = { rd: callout.rd, cl: callout.cl };
  if (group) {
    appearance.group = true;
    appearance.prefix = readableTextOps({ name: measure.name, fontSize, rgb });
  }
  return appearance;
}

module.exports = { ITALIC_SKEW, isWrapped, matchesText, isWrappedEntry, wrappedBlockOps, wrappedAppearanceOf };
