'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TOOL_TASKS, isToolKind, runMerge, runSplit, runConvert, runWatermark, runFlatten, runFlattenPreview } = require('../worker/tool-tasks.js');
const pdfTask = require('../worker/pdf-task.js');

// ツールの実行は tool-tasks.js にあり、pdf-task.js の runTask が kind で引く（spec-4-5 確定事項47）。

test('TOOL_TASKS は結合・分割・変換・透かし・フラット化（と件数の下見）・注釈の辞書の読み戻し・紙全体の大きさの実行関数を kind で引く', () => {
  assert.deepEqual(Object.keys(TOOL_TASKS), ['merge', 'split', 'convert', 'watermark', 'flatten', 'flatten-preview', 'annotation-details', 'page-boxes']);
  assert.equal(TOOL_TASKS.merge, runMerge);
  assert.equal(TOOL_TASKS.split, runSplit);
  assert.equal(TOOL_TASKS.convert, runConvert);
  assert.equal(TOOL_TASKS.watermark, runWatermark);
  assert.equal(TOOL_TASKS.flatten, runFlatten);
  assert.equal(TOOL_TASKS['flatten-preview'], runFlattenPreview);
  // 注釈の辞書の読み戻し（spec-4b-1a 確定事項22）。
  assert.equal(TOOL_TASKS['annotation-details'], require('../worker/annotation-dict-reader.js').runAnnotationDetails);
  // 紙全体の大きさ（spec-4b-6a 確定事項9）。
  assert.equal(TOOL_TASKS['page-boxes'], require('../worker/page-boxes-task.js').runPageBoxes);
  assert.equal(Object.isFrozen(TOOL_TASKS), true);
});

test('isToolKind は表にある kind だけを真にする（保存・抽出・下見・継承したキーは偽）', () => {
  for (const kind of ['merge', 'split', 'convert', 'watermark', 'flatten', 'flatten-preview'])
    assert.equal(isToolKind(kind), true, kind);
  for (const kind of ['save', 'extract', 'insert-preview', 'mergee', '', undefined, null, 'toString', '__proto__', 'constructor'])
    assert.equal(isToolKind(kind), false, String(kind));
});

test('pdf-task.js は同じ関数を再エクスポートする（既存のテストの入口を変えない）', () => {
  assert.equal(pdfTask.runMerge, runMerge);
  assert.equal(pdfTask.runSplit, runSplit);
  assert.equal(pdfTask.runConvert, runConvert);
});

test('runTask はツールの kind をその実行関数へ、表に無い kind を保存へ回す', async () => {
  assert.equal((await pdfTask.runTask({ kind: 'merge' })).error, '結合するファイルがありません。');
  assert.equal((await pdfTask.runTask({ kind: 'split' })).error, '分割するファイルが決まっていません。');
  assert.equal((await pdfTask.runTask({ kind: 'convert' })).error, '変換する画像がありません。');
  assert.equal((await pdfTask.runTask({ kind: 'watermark' })).error, '対象のファイルが決まっていません。');
  assert.equal((await pdfTask.runTask({ kind: 'flatten' })).error, '対象のファイルが決まっていません。');
  assert.equal((await pdfTask.runTask({ kind: 'flatten-preview' })).error, '対象のファイルが決まっていません。');
  // 綴りを誤った kind は今までどおり保存へ落ちる（既定を変えない）。
  assert.equal((await pdfTask.runTask({ kind: 'mergee' })).error, '保存先が決まっていません。');
});
