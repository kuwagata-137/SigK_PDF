'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/shape-style.js');
require('../renderer/free-text-entry.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/free-text-style-view.js');

// 右パネルのテキストの行と太さの行に出す形（spec-4b-4a 確定事項G1・G3〜G5）。

const view = globalThis.SigK.freeTextStyleView;

const text = (extra = {}) => ({ kind: 'text', fontSize: 12, bold: false, italic: false, border: null, lineWidth: null, ...extra });
const square = (extra = {}) => ({ kind: 'square', lineWidth: 2, ...extra });

test('textViewsOf はテキストが無ければどれも null、混ざれば名に「（テキスト）」を付ける', () => {
  assert.deepEqual(view.textViewsOf([square()]), { fontSize: null, format: null, border: null });
  const alone = view.textViewsOf([text({ border: '#c00000' })]);
  assert.deepEqual(alone.border, { value: '#c00000', mixed: false, label: '枠線' });
  assert.equal(alone.fontSize.label, '文字の大きさ');
  const mixed = view.textViewsOf([text({ border: '#c00000' }), square(), text({ fontSize: 18 })]);
  assert.deepEqual(mixed.border, { value: null, mixed: true, label: '枠線（テキスト）' });
  assert.deepEqual(mixed.fontSize, { value: 18, mixed: true, label: '文字の大きさ（テキスト）' });
  assert.equal(mixed.format.label, '書式（テキスト）');
});

test('widthViewOf の名は図形だけなら線の太さ、枠線のあるテキストだけなら枠線の太さ、両方なら線と枠線の太さ', () => {
  assert.deepEqual(view.widthViewOf([square()]), { value: 2, mixed: false, label: '線の太さ' });
  assert.deepEqual(view.widthViewOf([text({ border: '#000000', lineWidth: 3 })]), { value: 3, mixed: false, label: '枠線の太さ' });
  assert.deepEqual(view.widthViewOf([square(), text({ border: '#000000', lineWidth: 3 })]), { value: 3, mixed: true, label: '線と枠線の太さ' });
  assert.equal(view.widthViewOf([text()]), null, '枠線の無いテキストには太さの行を出さない');
  assert.deepEqual(view.widthViewOf([square(), text()]), { value: 2, mixed: false, label: '線の太さ' });
});
