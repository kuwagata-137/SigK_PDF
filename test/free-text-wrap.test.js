'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-wrap.js');

// テキストの折り返し（spec-4b-4a 確定事項C1・E1。事前調査 E）。

const wrap = globalThis.SigK.freeTextWrap;

// 全角 10pt・半角 5pt の送り幅（大きさ 10 の見積もり）。絵文字は 12pt、結合文字と異体字セレクタは 0。
function advance(unit) {
  if (/\p{Extended_Pictographic}/u.test(unit))
    return 12;
  return unit.charCodeAt(0) < 128 ? 5 : 10;
}

test('1 字ずつ詰め、幅を超える字から次の行へ送る（禁則なし・語をまとめない）', () => {
  const cases = [
    ['', 30, ['']],
    ['あ', 30, ['あ']],
    ['あいう', 30, ['あいう']],
    ['あいうえ', 30, ['あいう', 'え']],
    ['あいうえおかきくけ', 30, ['あいう', 'えおか', 'きくけ']],
    ['、。」「', 20, ['、。', '」「']],
    ['abcdefg', 20, ['abcd', 'efg']],
    ['あab', 20, ['あab']],
    ['あabc', 20, ['あab', 'c']],
  ];
  for (const [text, width, expected] of cases)
    assert.deepEqual(wrap.wrapLines(text, width, advance), expected, `${text} / ${width}`);
});

test('明示の改行は残し、空の行も 1 行として持つ。CR は捨てる', () => {
  assert.deepEqual(wrap.wrapLines('あいうえ\n\nか', 30, advance), ['あいう', 'え', '', 'か']);
  assert.deepEqual(wrap.wrapLines('あ\r\nい', 30, advance), ['あ', 'い']);
  assert.deepEqual(wrap.wrapLines('あいう\n', 30, advance), ['あいう', '']);
});

test('空白も字として幅を持ち、行末でもぶら下げない', () => {
  assert.deepEqual(wrap.wrapLines('ab cd ef', 20, advance), ['ab c', 'd ef']);
  assert.deepEqual(wrap.wrapLines('あい う', 25, advance), ['あい ', 'う']);
  assert.deepEqual(wrap.wrapLines('    ', 10, advance), ['  ', '  ']);
});

test('ちょうど幅いっぱいの行は送らず、幅より広い字は 1 字で 1 行にする', () => {
  assert.deepEqual(wrap.wrapLines('あい', 20, advance), ['あい']);
  assert.deepEqual(wrap.wrapLines('あいう', 5, advance), ['あ', 'い', 'う']);
  // 送り幅の和の小数の誤差は許す（0.1 × 3 は 0.30000000000000004）。
  assert.deepEqual(wrap.wrapLines('aaa', 0.3, () => 0.1), ['aaa']);
});

test('字の単位は書記素で、異体字セレクタや結合文字を切り離さない', () => {
  assert.deepEqual(wrap.unitsOf('があ'), ['が', 'あ']);
  assert.deepEqual(wrap.unitsOf('❤️a'), ['❤️', 'a']);
  // 1 字ずつ幅より広くても、異体字セレクタだけが次の行へ行くことはない。
  assert.deepEqual(wrap.wrapLines('❤️❤️', 5, advance), ['❤️', '❤️']);
});

test('widthOf は字の送り幅の和', () => {
  assert.equal(wrap.widthOf('あいab', advance), 30);
  assert.equal(wrap.widthOf('', advance), 0);
});

test('editorWidthOf は、入る行の最長と、送った字を足した行の最短との真ん中', () => {
  // 'あいう'（30）と 'え'（10）。送った行は 'あいう'＋'え'＝40。真ん中は 35。
  assert.equal(wrap.editorWidthOf('あいうえ', 30, advance), 35);
  // 半角を含む行: 'abcd'（20）と 'efg'。送った行は 'abcd'＋'e'＝25。真ん中は 22.5。
  assert.equal(wrap.editorWidthOf('abcdefg', 20, advance), 22.5);
  // 送った行が 2 つあれば、足した幅の最短で決める（'あab'＋'c'＝25、'cあ'＋'い'＝25。入る行の最長は 20）。
  assert.equal(wrap.editorWidthOf('あabcあいう', 20, advance), (20 + 25) / 2);
});

test('editorWidthOf は送った行が無ければ最長行に 1pt 足し、1 字だけの行は決め手にしない', () => {
  assert.equal(wrap.editorWidthOf('あい\nう', 30, advance), 21);
  assert.equal(wrap.editorWidthOf('', 30, advance), 1);
  // 幅 5 に全角を並べると 1 字ずつの行になる。2 字以上の行が無いので、入る行の最長は 0 として真ん中を取る。
  assert.equal(wrap.editorWidthOf('あい', 5, advance), 10);
});
