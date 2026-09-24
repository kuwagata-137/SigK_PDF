'use strict';

// 起動確認の透かし・フラット化の道具（spec-4-5 確定事項48・49）。スクリプトは実機でしか回せないので、
// ここは「文法として正しいこと」と「読み返しの関数がワーカーの出力を正しく読むこと」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { watermarkScript, flattenScript, inspectWatermarked, inspectFlattened } = require('../smoke-rewrite.js');
const { runTask } = require('../worker/pdf-task.js');
const { fixturePath } = require('./fixtures/build.js');

const ROOT = path.resolve(__dirname, '..');

function parses(script) {
  // executeJavaScript に渡す式（async の即時関数）として読めること。コンパイルだけで実行はしない。
  assert.doesNotThrow(() => new vm.Script(script));
}

test('スクリプトはどの指定でも式として読める', () => {
  for (const stay of [false, true])
    parses(watermarkScript({ source: 'C:\\a.pdf', target: 'C:\\b.pdf', ops: 'text:社外秘,pos:top-right,pages:1-2', stay }));
  for (const stay of [null, 'screen', 'confirm'])
    parses(flattenScript({ source: 'C:\\a.pdf', target: 'C:\\b.pdf', stay }));
});

test('inspectWatermarked は、ページごとの透かしの名前・透かしの XObject の数・フォントの数を返す', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-rewrite-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'out.pdf');
  const mark = { type: 'text', text: '社外秘', color: '#808080', opacity: 0.3, angle: 45, size: 'medium', position: 'center' };
  const result = await runTask({ kind: 'watermark', source: fixturePath('page-boxes.pdf'), target, pages: [0, 1, 2, 3, 4], mark });
  assert.equal(result.ok, true, result.error);
  const written = await inspectWatermarked(target, ROOT);
  assert.deepEqual(written.pages.map((page) => page.names), [['SigKWM'], ['SigKWM'], ['SigKWM'], ['SigKWM'], ['SigKWM']]);
  assert.deepEqual(written.pages.map((page) => page.rotate), [0, 90, 180, 270, 0]);
  assert.equal(written.watermarkForms, 1);
  assert.equal(written.fonts, 1, '元の Helvetica だけ（透かしはフォントを埋めない）');
});

test('inspectFlattened は、残った注釈・焼いた外観の数・ノートの本文の残りを返す', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-rewrite-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = fixturePath('annotated.pdf');
  const target = path.join(dir, 'out.pdf');
  const result = await runTask({ kind: 'flatten', source, target });
  assert.equal(result.ok, true, result.error);
  const written = await inspectFlattened(source, target, ROOT);
  assert.deepEqual(written.pages.map((page) => page.annots), [['Line', 'FreeText', 'Link'], [], []]);
  assert.deepEqual(written.pages.map((page) => page.baked), [2, 1, 0]);
  assert.equal(written.notesBefore, 2);
  assert.equal(written.notesLeft, 0);
  // 焼く前のファイルでは本文が見つかる（見張りが空振りしていないこと）。
  assert.equal((await inspectFlattened(source, source, ROOT)).notesLeft, 2);
});
