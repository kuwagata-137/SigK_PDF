'use strict';

// 注釈の辞書を直に読む口（annotation-dict-reader.js）の、FreeText の欄（spec-4b-4a 確定事項J1）。読むだけで、何も書かない。
//
//   defaultStyle … /DS を読んだ { bold, italic, color }（default-style.js）。/DS が無ければ null。暗号化された文書では文字列を
//                  読めない（数は読めるが、文字列とストリームは暗号のまま。annotation-dict-reader.js）ので 'unreadable'
//   daColor      … /DA の最後の塗りの色（'#rrggbb'。枠線の色に使う）。無い・読めなければ null
//   intent       … /IT の名前（'FreeTextCallout' なら吹き出し。spec-4b-4b 確定事項H3）。無ければ null
//   calloutLine  … /CL の 4 つか 6 つの数（吹き出しの線。最初の点がしっぽの先）。無い・崩れていれば null
// /IT と /CL は名前と数なので、暗号化された文書でも読める。

const { pick } = require('./pdf-tree-reader.js');
const { parseDefaultStyle } = require('./default-style.js');

const COLOR_OPERANDS = Object.freeze({ g: 1, rg: 3, k: 4 });

function nameOf(context, value) {
  const item = context.lookup(value);
  return typeof item?.encodedName === 'string' ? item.encodedName.slice(1) : null;
}

// /CL の数（4 つか 6 つ）。
function calloutLineOf(context, value) {
  const array = context.lookup(value);
  if (typeof array?.asArray !== 'function')
    return null;
  const numbers = array.asArray().map((item) => context.lookup(item)).map((item) => (typeof item?.asNumber === 'function' ? item.asNumber() : Number.NaN));
  return (numbers.length === 4 || numbers.length === 6) && numbers.every(Number.isFinite) ? numbers : null;
}

function textOf(context, value) {
  const item = context.lookup(value);
  if (typeof item?.decodeText !== 'function')
    return null;
  try {
    return item.decodeText();
  } catch {
    return null;
  }
}

function hexOf(rgb) {
  return `#${rgb.map((part) => Math.round(Math.min(1, Math.max(0, part)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// 色の演算子の数を RGB（0〜1）にする。
function rgbOf(operator, values) {
  if (operator === 'g')
    return [values[0], values[0], values[0]];
  if (operator === 'rg')
    return values;
  const [c, m, y, k] = values;
  return [1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k)];
}

// /DA の最後の塗りの色（g・rg・k）。
function daColorOf(da) {
  if (typeof da !== 'string')
    return null;
  const numbers = [];
  let color = null;
  for (const token of da.trim().split(/\s+/)) {
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(token)) {
      numbers.push(Number(token));
      continue;
    }
    const count = COLOR_OPERANDS[token];
    if (count !== undefined && numbers.length >= count)
      color = hexOf(rgbOf(token, numbers.slice(-count)));
    numbers.length = 0;
  }
  return color;
}

// /DS の読み。無ければ null、暗号化されていれば 'unreadable'。
function defaultStyleOf(dict, context, encrypted) {
  const ds = pick(dict, '/DS');
  if (ds === undefined)
    return null;
  if (encrypted)
    return 'unreadable';
  const { bold, italic, color } = parseDefaultStyle(textOf(context, ds));
  return { bold, italic, color };
}

// FreeText の欄。options.encrypted は文書が暗号化されているか。
function freeTextDetailsOf(dict, context, { encrypted = false } = {}) {
  return {
    defaultStyle: defaultStyleOf(dict, context, encrypted),
    daColor: encrypted ? null : daColorOf(textOf(context, pick(dict, '/DA'))),
    intent: nameOf(context, pick(dict, '/IT')),
    calloutLine: calloutLineOf(context, pick(dict, '/CL')),
  };
}

module.exports = { daColorOf, freeTextDetailsOf };
