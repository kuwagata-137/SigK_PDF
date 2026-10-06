'use strict';

// 起動確認のトリミングの操作（smoke-annotate-trim.js。spec-4b-6a 確定事項28）と、保存先の箱の読み取り。スクリプトは実機でしか回せないので、
// ここは「操作を入れた式が文法として正しいこと」と「保存先の /MediaBox・/CropBox を正しく読むこと」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { PDFDocument } = require('pdf-lib');
const { annotateScript, inspectBoxes } = require('../smoke-annotate.js');
const { TRIM_STATE, TRIM_STEPS, TRIM_REPORT } = require('../smoke-annotate-trim.js');

test('トリミングの操作を入れた操作列も式として読め、状態・分岐・結果は 1 度だけ埋まる', () => {
  const script = annotateScript('x.pdf', 'fit:page,trim-tool,trim-draft:0:60x780-540x250,trim-move:20x-10,esc,trim:0:60x780-540x250,trim:1:80x760-500x300:all,undo,redo,save,untrim:0,untrim:0:all,fit:width');
  assert.doesNotThrow(() => new vm.Script(script));
  for (const part of [TRIM_STATE, TRIM_STEPS, TRIM_REPORT]) {
    assert.equal(script.split(part).length, 2);
    assert.equal(part.includes('`'), false);
    assert.equal(part.includes('${'), false);
  }
  assert.ok(script.includes('trim: trimReport'), '結果の trim の欄に入れる');
});

test('inspectBoxes は各ページの紙全体と、ページ自身の /CropBox（無ければ null）を読む', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-trim-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]).setCropBox(50, 60, 300, 400);
  doc.addPage([500, 700]);
  const file = path.join(dir, 'a.pdf');
  fs.writeFileSync(file, await doc.save());

  assert.deepEqual(await inspectBoxes(file), [
    { media: [0, 0, 600, 800], crop: [50, 60, 350, 460] },
    { media: [0, 0, 500, 700], crop: null },
  ]);
});
