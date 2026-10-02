'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, placeCallout, placeText } = require('./text-helpers.js');

// 吹き出しの道具の段・一覧・右パネル・ヒント（spec-4b-4b 確定事項F1・F6・F7）。

test('道具の段のテキストの隣に「吹き出し」のボタンがあり、押すと吹き出しの道具になる', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  const button = document.querySelector('#edit-bar .edit-tool[data-tool="callout"]');
  assert.ok(button !== null);
  assert.equal(button.getAttribute('title'), '吹き出し');
  assert.equal(button.closest('.edit-item').previousElementSibling.querySelector('[data-tool]').dataset.tool, 'text');
  assert.ok(SigK.icons.has('callout'));
  button.click();
  assert.equal(SigK.annotate.getTool(), 'callout');
  assert.equal(document.getElementById('props-kind').textContent, '吹き出し（次に付ける）');
  assert.equal(document.getElementById('props-size-row').hidden, false, '文字の大きさの行を出す');
  assert.match(document.getElementById('props-hint').textContent, /吹き出し/);
});

test('一覧の吹き出しの行は、吹き出しのアイコン・枠線の色・「吹き出し」の名前で、右パネルの種類も「吹き出し」', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  placeText(shell, 100, 760, '普通のテキスト');
  const entry = placeCallout(shell, 100, 700, '数量を確認');
  const rows = SigK.annotationIndex.rowsOf(SigK.viewer.getAnnotations(), SigK.viewer.getImported(), SigK.viewer.getPlan());
  const row = rows.find((item) => item.key === entry.id);
  assert.deepEqual([row.label, row.icon, row.color], ['吹き出し', 'callout', '#c00000']);
  assert.equal(rows.find((item) => item.key !== entry.id).label, 'テキスト');
  SigK.annotate.setTool('select');
  SigK.annotate.select(entry.id);
  assert.equal(document.getElementById('props-kind').textContent, '吹き出し');
  assert.match(document.getElementById('props-hint').textContent, /しっぽ/);
  assert.equal(document.getElementById('props-angle-row').hidden, false);
});
