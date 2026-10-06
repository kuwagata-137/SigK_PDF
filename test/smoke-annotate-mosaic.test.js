'use strict';

// 起動確認のモザイクの操作（smoke-annotate-mosaic.js。spec-4b-6b 確定事項31）と、保存先の読み取り。スクリプトは実機でしか回せないので、
// ここは「操作を入れた式が文法として正しいこと」と「保存先のページ・控え・元の文字を正しく読むこと」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { PDFDocument } = require('pdf-lib');
const { annotateScript, inspectMosaic } = require('../smoke-annotate.js');
const { MOSAIC_STATE, MOSAIC_STEPS, MOSAIC_REPORT } = require('../smoke-annotate-mosaic.js');
const { runSave } = require('../worker/pdf-task.js');
const { readSignature } = require('../pdf-write.js');
const { buildMosaicSample, pngBytes } = require('./fixtures/mosaic-sample.js');

test('モザイクの操作を入れた操作列も式として読め、状態・分岐・結果は 1 度だけ埋まる', () => {
  const script = annotateScript('x.pdf', 'mosaic-tool,mosaic:0:60x780-540x700,mosaic:0:60x600-300x500:14,mosaic-draft:1:80x760-500x700,esc,unmosaic:0,undo,mosaic-save,mosaic-confirm');
  assert.doesNotThrow(() => new vm.Script(script));
  for (const part of [MOSAIC_STATE, MOSAIC_STEPS, MOSAIC_REPORT]) {
    assert.equal(script.split(part).length, 2);
    assert.equal(part.includes('`'), false);
    assert.equal(part.includes('${'), false);
  }
  assert.ok(script.includes('mosaic: mosaicReport'), '結果の mosaic の欄に入れる');
});

test('inspectMosaic は画像 1 枚になったページ・書き込み・控えの有無と、保存先に残った文字を読む', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-mosaic-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'a.pdf');
  fs.writeFileSync(file, await buildMosaicSample());
  const before = await inspectMosaic(file, ['SECRET-ONE', 'KEEP-TWO', 'NOT-THERE']);
  assert.deepEqual(before.found, ['SECRET-ONE', 'KEEP-TWO']);
  assert.equal(before.pages[0].fonts, true);

  fs.writeFileSync(`${file}.bak`, 'old');
  const result = await runSave({ kind: 'save', source: file, target: file, pages: [{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }],
    mosaics: [{ src: 0, kind: 'png', bytes: pngBytes(), box: [0, 0, 595, 842] }], dropBackup: true, expect: await readSignature(file) });
  assert.equal(result.ok, true, result.error);
  const after = await inspectMosaic(file, ['SECRET-ONE', 'KEEP-TWO']);
  assert.deepEqual(after.found, ['KEEP-TWO']);
  assert.deepEqual(after.pages[0], { xobjects: ['SigKMosaic'], fonts: false, annots: 1, rotate: 90 });
  assert.equal(after.backup, false);
  assert.equal(after.secrets, 2);
  // 読めるファイルのまま。
  assert.equal((await PDFDocument.load(fs.readFileSync(file))).getPageCount(), 2);
});
