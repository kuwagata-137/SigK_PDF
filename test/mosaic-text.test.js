'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/mosaic-text.js');
const text = globalThis.SigK.mosaicText;

// モザイクの範囲に重なる文字を空にする（spec-4b-6b 確定事項9。決定66 ③。事前調査 K）。

// 横書きの項目: 書き始め (x, y)・文字の大きさ size・送りの長さ width。
function line(str, x, y, size, width) {
  return { str, transform: [size, 0, 0, size, x, y], width, height: size, fontName: 'F1', hasEOL: false };
}

const ITEMS = [line('見積の条件', 70, 780, 18, 150), line('1. 納期は…', 70, 740, 10.5, 300), { str: '', transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0, hasEOL: true }, line('担当：山田', 70, 700, 9, 200)];

test('範囲に重なる行の文字だけを空にし、項目の数と並びは変えない', () => {
  const out = text.blankItems(ITEMS, [{ box: [100, 735, 140, 745], block: 8 }]);
  assert.equal(out.length, ITEMS.length);
  assert.deepEqual(out.map((item) => item.str), ['見積の条件', '', '', '担当：山田']);
  assert.equal(out[1].transform, ITEMS[1].transform);
  assert.equal(ITEMS[1].str, '1. 納期は…');
});

test('行の外れ（範囲の外の部分）も含めて行ごと空になり、触れていない行はそのまま', () => {
  // 範囲は 9pt の行（x 70〜270）の右の端だけに掛かり、大半は行の外にある。
  const out = text.blankItems(ITEMS, [{ box: [250, 690, 500, 712], block: 4 }]);
  assert.deepEqual(out.map((item) => item.str), ['見積の条件', '1. 納期は…', '', '']);
});

test('ディセンダーの分（文字の大きさの 1/4）だけ下の範囲にも当たる', () => {
  // 9pt の行の書き始めは y 700。下へ 2.25pt までは同じ行。
  assert.equal(text.blankItems(ITEMS, [{ box: [80, 696, 120, 699], block: 4 }])[3].str, '');
  assert.equal(text.blankItems(ITEMS, [{ box: [80, 690, 120, 697.5], block: 4 }])[3].str, '担当：山田');
});

test('回した文字（90°）と縦書きの項目の四角', () => {
  // 90° 回した横書き: 送りの向きが上（y が増える）。
  const rotated = { str: 'ABC', transform: [0, 10, -10, 0, 100, 100], width: 50, height: 10, fontName: 'F1' };
  assert.deepEqual(text.boundsOf(rotated, false), [90, 100, 102.5, 150]);
  // 縦書き: width が文字の大きさ・height が送りの長さ（下へ）。左右と上下に文字の大きさの半分を足す。
  const vertical = { str: '縦', transform: [10, 0, 0, 10, 200, 500], width: 10, height: 40, fontName: 'V' };
  assert.deepEqual(text.boundsOf(vertical, true), [190, 455, 210, 505]);
  const out = text.blankContent({ items: [vertical], styles: { V: { vertical: true } } }, [{ box: [195, 460, 205, 470], block: 4 }]);
  assert.equal(out.items[0].str, '');
});

test('モザイクが無ければ同じものを返し、読めない transform の項目は空にしない', () => {
  assert.equal(text.blankItems(ITEMS, []), ITEMS);
  assert.equal(text.blankItems(ITEMS, null), ITEMS);
  const content = { items: ITEMS, styles: {} };
  assert.equal(text.blankContent(content, undefined), content);
  const broken = [{ str: 'x', transform: null, width: 1, height: 1 }];
  assert.equal(text.blankItems(broken, [{ box: [-1e6, -1e6, 1e6, 1e6], block: 4 }])[0].str, 'x');
});
