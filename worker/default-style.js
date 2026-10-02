'use strict';

// FreeText の /DS（既定の文字の書式。ISO 32000-1 12.7.3.4）を組む・読む純粋層（spec-4b-4a 確定事項I5・J1。事前調査 C・D）。
//
// 書くのは自前の新しい形のテキストだけで、大きさ・書体・文字の色と、太字・斜体のときだけ font-weight・font-style を足す。
// 読むのは CSS の宣言の並び（「名前: 値;」）で、font の一括指定・font-weight・font-style・color を拾う。他のアプリの /DS
// （Acrobat の「font: Helvetica,sans-serif 12.0pt; text-align:left; color:#FF0000」など）も同じ読み方で読める。

const { num } = require('./annotation-appearance.js');

const FAMILY = 'Noto Sans JP';
const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;

// /DS の文字列。color は '#rrggbb'（大文字で書く）。
function defaultStyleOf({ fontSize, color, bold = false, italic = false }) {
  const parts = [`font: ${num(fontSize)}pt "${FAMILY}"`, `color: ${color.toUpperCase()}`];
  if (bold)
    parts.push('font-weight: bold');
  if (italic)
    parts.push('font-style: italic');
  return parts.join('; ');
}

// 色の値を '#rrggbb'（小文字）にする。読めなければ null。
function colorOf(value) {
  const hex6 = HEX6.exec(value);
  if (hex6 !== null)
    return `#${hex6[1].toLowerCase()}`;
  const hex3 = HEX3.exec(value);
  if (hex3 !== null)
    return `#${hex3.slice(1).map((digit) => digit + digit).join('').toLowerCase()}`;
  const rgb = RGB.exec(value);
  if (rgb === null || rgb.slice(1).some((part) => Number(part) > 255))
    return null;
  return `#${rgb.slice(1).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
}

// 太さの値（bold・bolder・600 以上）。
function isBoldWeight(value) {
  return /^bold(er)?$/i.test(value) || (/^\d+$/.test(value) && Number(value) >= 600);
}

// font の一括指定から、太字・斜体・大きさを拾う。
function fromFont(value, style) {
  for (const token of value.split(/[\s,]+/)) {
    if (/^(italic|oblique)$/i.test(token))
      style.italic = true;
    else if (isBoldWeight(token))
      style.bold = true;
    else if (/^\d+(\.\d+)?pt$/i.test(token))
      style.fontSize = Number(token.slice(0, -2));
  }
}

// /DS を読む。{ bold, italic, color（'#rrggbb' か null）, fontSize（pt か null） }。知らない宣言と崩れた宣言は飛ばす。
function parseDefaultStyle(text) {
  const style = { bold: false, italic: false, color: null, fontSize: null };
  if (typeof text !== 'string')
    return style;
  for (const declaration of text.split(';')) {
    const at = declaration.indexOf(':');
    if (at < 0)
      continue;
    const name = declaration.slice(0, at).trim().toLowerCase();
    const value = declaration.slice(at + 1).trim();
    if (name === 'font')
      fromFont(value, style);
    else if (name === 'font-weight')
      style.bold = isBoldWeight(value);
    else if (name === 'font-style')
      style.italic = /^(italic|oblique)$/i.test(value);
    else if (name === 'color')
      style.color = colorOf(value) ?? style.color;
    else if (name === 'font-size' && /^\d+(\.\d+)?pt$/i.test(value))
      style.fontSize = Number(value.slice(0, -2));
  }
  return style;
}

module.exports = { FAMILY, defaultStyleOf, parseDefaultStyle, colorOf };
