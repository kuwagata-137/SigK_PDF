'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFDocument, PDFString, PDFHexString } = require('pdf-lib');
const { daColorOf, freeTextDetailsOf } = require('../worker/free-text-details.js');

// 口が読む FreeText の欄（spec-4b-4a 確定事項J1）。

test('daColorOf は /DA の最後の塗りの色（g・rg・k）を #rrggbb にし、無ければ null', () => {
  assert.equal(daColorOf('/SigKJP 12 Tf 0.753 0 0 rg'), '#c00000');
  assert.equal(daColorOf('0 0 1 rg /Helv 10 Tf 0.5 g'), '#808080');
  assert.equal(daColorOf('/Helv 10 Tf 0 0 1 0 k'), '#ffff00');
  assert.equal(daColorOf('/Helv 10 Tf'), null);
  assert.equal(daColorOf('1 rg'), null, '数の足りない演算子は読まない');
  assert.equal(daColorOf(null), null);
});

async function dictWith(entries) {
  const doc = await PDFDocument.create();
  const dict = doc.context.obj({ Type: 'Annot', Subtype: 'FreeText', ...entries });
  return { dict, context: doc.context };
}

test('freeTextDetailsOf は /DS を { bold, italic, color } に読み、/DS が無ければ null', async () => {
  const own = await dictWith({
    DA: PDFString.of('/SigKJP 12 Tf 0.11 0.141 0.188 rg'),
    DS: PDFString.of('font: 12pt "Noto Sans JP"; color: #1C2430; font-weight: bold'),
  });
  assert.deepEqual(freeTextDetailsOf(own.dict, own.context), { defaultStyle: { bold: true, italic: false, color: '#1c2430' }, daColor: '#1c2430' });
  const hex = await dictWith({ DS: PDFHexString.fromText('font-style: italic') });
  assert.deepEqual(freeTextDetailsOf(hex.dict, hex.context).defaultStyle, { bold: false, italic: true, color: null });
  const old = await dictWith({ DA: PDFString.of('/SigKJP 12 Tf 1 0 0 rg') });
  assert.deepEqual(freeTextDetailsOf(old.dict, old.context), { defaultStyle: null, daColor: '#ff0000' });
});

test('freeTextDetailsOf は暗号化された文書では /DS を読めないと答え、/DA の色も読まない', async () => {
  const own = await dictWith({ DA: PDFString.of('/SigKJP 12 Tf 1 0 0 rg'), DS: PDFString.of('color: #ff0000') });
  assert.deepEqual(freeTextDetailsOf(own.dict, own.context, { encrypted: true }), { defaultStyle: 'unreadable', daColor: null });
  const old = await dictWith({ DA: PDFString.of('/SigKJP 12 Tf 1 0 0 rg') });
  assert.equal(freeTextDetailsOf(old.dict, old.context, { encrypted: true }).defaultStyle, null, '/DS が無いことは暗号化されていても分かる');
});
