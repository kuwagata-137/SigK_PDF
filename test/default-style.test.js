'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FAMILY, defaultStyleOf, parseDefaultStyle, colorOf } = require('../worker/default-style.js');

// FreeText の /DS（既定の文字の書式）を組む・読む（spec-4b-4a 確定事項I5・J1。事前調査 C・D）。

test('defaultStyleOf は大きさ・書体・文字の色に、太字・斜体のときだけ font-weight・font-style を足す', () => {
  assert.equal(FAMILY, 'Noto Sans JP');
  assert.equal(defaultStyleOf({ fontSize: 12, color: '#222a35' }), 'font: 12pt "Noto Sans JP"; color: #222A35');
  assert.equal(defaultStyleOf({ fontSize: 10.5, color: '#c00000', bold: true }), 'font: 10.5pt "Noto Sans JP"; color: #C00000; font-weight: bold');
  assert.equal(defaultStyleOf({ fontSize: 200, color: '#000000', bold: true, italic: true }),
    'font: 200pt "Noto Sans JP"; color: #000000; font-weight: bold; font-style: italic');
});

test('parseDefaultStyle は自分で書いた /DS を読み戻す', () => {
  for (const style of [
    { fontSize: 12, color: '#222a35', bold: false, italic: false },
    { fontSize: 10.5, color: '#c00000', bold: true, italic: false },
    { fontSize: 144, color: '#4472c4', bold: true, italic: true },
    { fontSize: 8, color: '#ffffff', bold: false, italic: true },
  ])
    assert.deepEqual(parseDefaultStyle(defaultStyleOf(style)), style);
});

test('parseDefaultStyle は他のアプリの書き方（font の一括指定・数の太さ・rgb() の色）も読む', () => {
  assert.deepEqual(parseDefaultStyle('font: Helvetica,sans-serif 12.0pt; text-align:left; color:#FF0000'),
    { bold: false, italic: false, color: '#ff0000', fontSize: 12 });
  assert.deepEqual(parseDefaultStyle('font: italic bold 9pt Arial; color: rgb(0, 128, 255)'),
    { bold: true, italic: true, color: '#0080ff', fontSize: 9 });
  assert.deepEqual(parseDefaultStyle('font-weight: 700; font-style: oblique; font-size: 14pt; color: #0f0'),
    { bold: true, italic: true, color: '#00ff00', fontSize: 14 });
  assert.equal(parseDefaultStyle('font-weight: 400').bold, false);
  assert.equal(parseDefaultStyle('font-weight: normal').bold, false);
});

test('parseDefaultStyle は崩れた宣言と知らない宣言を飛ばし、文字列でなければ既定の形', () => {
  const empty = { bold: false, italic: false, color: null, fontSize: null };
  assert.deepEqual(parseDefaultStyle(''), empty);
  assert.deepEqual(parseDefaultStyle(null), empty);
  assert.deepEqual(parseDefaultStyle('garbage; ;: ; color: red; text-decoration: underline'), empty);
  assert.deepEqual(parseDefaultStyle('color: #12345; font-weight: bold'), { ...empty, bold: true });
});

test('colorOf は #rrggbb・#rgb・rgb() を小文字の #rrggbb にし、読めなければ null', () => {
  assert.equal(colorOf('#AbCdEf'), '#abcdef');
  assert.equal(colorOf('#f0a'), '#ff00aa');
  assert.equal(colorOf('rgb(255,0,16)'), '#ff0010');
  assert.equal(colorOf('rgb(256,0,0)'), null);
  assert.equal(colorOf('red'), null);
});
