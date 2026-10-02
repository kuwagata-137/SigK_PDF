'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-entry.js');

// テキストの書き込みの書式の欄（spec-4b-4a 確定事項A1・A2・A4・I1）。

const fields = globalThis.SigK.freeTextEntry;

test('validFields は幅（無い・auto・正の数）と、新しい形の太字・斜体（true だけ）を受ける', () => {
  for (const entry of [{}, { width: 'auto' }, { width: 120.5 }, { width: 'auto', bold: true }, { width: 30, italic: true, bold: true }])
    assert.equal(fields.validFields(entry), true, JSON.stringify(entry));
  for (const entry of [{ width: 0 }, { width: -3 }, { width: 'fixed' }, { width: Number.NaN }, { width: 'auto', bold: false }, { width: 'auto', italic: 1 }])
    assert.equal(fields.validFields(entry), false, JSON.stringify(entry));
});

test('今までの形（幅が無い）は太字・斜体を持てない', () => {
  assert.equal(fields.validFields({ bold: true }), false);
  assert.equal(fields.validFields({ italic: true }), false);
  assert.equal(fields.isNewForm({}), false);
  assert.equal(fields.isNewForm({ width: 'auto' }), true);
  assert.equal(fields.isNewForm(null), false);
});

test('validPatchValue は幅と、太字・斜体の true・false を受ける', () => {
  assert.equal(fields.validPatchValue('width', 'auto'), true);
  assert.equal(fields.validPatchValue('width', 40), true);
  assert.equal(fields.validPatchValue('width', 0), false);
  assert.equal(fields.validPatchValue('bold', false), true);
  assert.equal(fields.validPatchValue('italic', true), true);
  assert.equal(fields.validPatchValue('bold', 'yes'), false);
  assert.equal(fields.validPatchValue('fill', '#ffffff'), false);
});

test('tidy は false の太字・斜体を外す', () => {
  assert.deepEqual(fields.tidy({ width: 'auto', bold: false, italic: true }), { width: 'auto', italic: true });
});

test('copyFields と sameFields は幅・太字・斜体を写して比べる（無いと false は同じ）', () => {
  const copy = fields.copyFields({ width: 40, bold: true, italic: false }, {});
  assert.deepEqual(copy, { width: 40, bold: true });
  assert.deepEqual(fields.copyFields({}, {}), {});
  assert.equal(fields.sameFields({ width: 40, bold: true }, copy), true);
  assert.equal(fields.sameFields({ width: 'auto' }, { width: 'auto', italic: false }), true);
  assert.equal(fields.sameFields({ width: 'auto' }, { width: 40 }), false);
  assert.equal(fields.sameFields({ width: 'auto' }, { width: 'auto', bold: true }), false);
  assert.equal(fields.sameFields({}, {}), true);
});

test('saveFields は新しい形に幅・太字・斜体と、画面で決めた行と中身の位置を添え、今までの形には何も足さない', () => {
  const inset = { padding: 2, left: 2.8, top: 2, horizontal: 7.3, vertical: 4 };
  assert.deepEqual(fields.saveFields({ text: 'x' }, { lines: ['x'], inset }), {});
  assert.deepEqual(fields.saveFields({ width: 'auto', bold: true }, { lines: ['あいう', 'え'], inset }),
    { width: 'auto', bold: true, lines: ['あいう', 'え'], inset: [2.8, 2] });
  // 行が無ければ添えない（ワーカーが断る）。
  assert.deepEqual(fields.saveFields({ width: 30, italic: true }, null), { width: 30, italic: true });
});
