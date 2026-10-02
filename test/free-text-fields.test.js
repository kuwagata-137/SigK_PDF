'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFString, PDFHexString } = require('pdf-lib');
const { freeTextFields } = require('../worker/free-text-fields.js');

// FreeText の辞書の欄（spec-4-2 確定事項25、spec-4b-4a 確定事項I5・I6）。

const TOOLS = { PDFString, PDFHexString };

test('今までの形は /Contents・/DA・/Border に /BS /W 0 を書き、/DS は書かない', () => {
  const fields = freeTextFields({ text: 'あ', rotation: 0 }, { da: '/SigKJP 12 Tf 0 0 0 rg' }, TOOLS);
  assert.deepEqual(Object.keys(fields), ['Contents', 'DA', 'Border', 'BS']);
  assert.equal(fields.Contents.decodeText(), 'あ');
  assert.equal(fields.DA.decodeText(), '/SigKJP 12 Tf 0 0 0 rg');
  assert.deepEqual(fields.Border, [0, 0, 0]);
  assert.deepEqual(fields.BS, { W: 0, S: 'S' });
});

test('新しい形は /DS も書き、回した表示で置いたものは /Rotate を書く', () => {
  const fields = freeTextFields({ text: 'あ', rotation: 270 }, { da: '/SigKJP 12 Tf 0 0 0 rg', ds: 'font: 12pt "Noto Sans JP"; color: #000000' }, TOOLS);
  assert.equal(fields.DS.decodeText(), 'font: 12pt "Noto Sans JP"; color: #000000');
  assert.equal(fields.Rotate, 270);
  assert.equal('C' in fields || 'RC' in fields || 'IC' in fields, false);
});

test('塗りがあれば /C に、枠線の太さは /BS /W に書く', () => {
  const fields = freeTextFields({ text: 'あ', rotation: 0 }, { da: '/SigKJP 12 Tf 1 0 0 rg', ds: 'x', fillRgb: [1, 1, 0], borderWidth: 2 }, TOOLS);
  assert.deepEqual(fields.C, [1, 1, 0]);
  assert.deepEqual(fields.BS, { W: 2, S: 'S' });
});

// 吹き出し（spec-4b-4b 確定事項G3）。
test('吹き出しは /IT /FreeTextCallout・/CL・/LE /None・/RD を書く', () => {
  const appearance = { da: '/SigKJP 12 Tf 0.753 0 0 rg', ds: 'x', fillRgb: [1, 1, 1], borderWidth: 1.5, callout: { cl: [80, 540, 120.75, 600.75], rd: [21.75, 61.75, 1.75, 1.75] } };
  const fields = freeTextFields({ text: 'あ', rotation: 0 }, appearance, TOOLS);
  assert.equal(fields.IT, 'FreeTextCallout');
  assert.deepEqual(fields.CL, [80, 540, 120.75, 600.75]);
  assert.equal(fields.LE, 'None');
  assert.deepEqual(fields.RD, [21.75, 61.75, 1.75, 1.75]);
  const plain = freeTextFields({ text: 'あ', rotation: 0 }, { da: 'x', ds: 'x' }, TOOLS);
  assert.equal('IT' in plain || 'CL' in plain || 'LE' in plain || 'RD' in plain, false);
});
