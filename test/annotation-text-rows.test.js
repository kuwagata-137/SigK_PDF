'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell } = require('./text-helpers.js');

// 右パネルのテキストの行（spec-4b-4a。annotation-props.js から移した「文字の大きさ」の行）。

test('render は大きさがあれば行を出して値を入れ、null なら隠す', async (t) => {
  const { SigK, document } = await withTextShell(t);
  const row = document.getElementById('props-size-row');
  assert.equal(SigK.annotationTextRows.render(18), true);
  assert.equal(row.hidden, false);
  assert.equal(document.getElementById('props-size').value, '18');
  SigK.annotationTextRows.render(null);
  assert.equal(row.hidden, true);
});

test('選択肢はプリセットの大きさで、選ぶと annotate.setFontSize へ流れる', async (t) => {
  const { SigK, document, window } = await withTextShell(t);
  const select = document.getElementById('props-size');
  assert.deepEqual([...select.options].map((option) => Number(option.value)), [...SigK.annotationPresets.FONT_SIZES]);
  SigK.annotate.setTool('text');
  select.value = '36';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(SigK.annotate.getFontSize(), 36);
});
