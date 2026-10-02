'use strict';

// 起動確認のテキストの書式の操作と、保存先の FreeText の欄を読む口（smoke-annotate-text.js。spec-4b-4a の起動確認）。
// スクリプトは実機でしか回せないので、ここは「テキストの操作を入れた式が文法として正しいこと」と「保存先の欄を正しく読むこと」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { annotateScript } = require('../smoke-annotate.js');
const { TEXT_STATE, TEXT_STEPS, TEXT_REPORT, inspectTexts } = require('../smoke-annotate-text.js');
const { applyAnnotations } = require('../worker/op-annotate.js');
const { createFontSource } = require('../worker/font-embed.js');

test('テキストの操作を入れた操作列も式として読め、状態・分岐・結果は 1 度だけ埋まる', () => {
  const script = annotateScript('x.pdf', 'text:0:72x780:あいう,fontsize:13.3,size-list:18,bold,italic,border:#c00000,save,compare:2,reopen');
  assert.doesNotThrow(() => new vm.Script(script));
  for (const part of [TEXT_STATE, TEXT_STEPS, TEXT_REPORT]) {
    assert.equal(script.split(part).length, 2);
    assert.equal(part.includes('`'), false);
    assert.equal(part.includes('${'), false);
  }
  assert.ok(script.includes('text: textReport'), '結果の text の欄に入れる');
});

test('inspectTexts は保存先の FreeText の /DA・/DS・/C・/BS と、半透明の透明グループ・先頭の文字の命令・行の数を読む', async (t) => {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const base = { src: 0, kind: 'text', color: '#222a35', fontSize: 10, rotation: 0, text: 'あいうえお\nかき', width: 'auto', lines: ['あいうえお', 'かき'] };
  const add = [
    { ...base, opacity: 1, rect: [100, 662.5, 165, 700], fill: '#fff2cc', borderColor: '#c00000', borderWidth: 2, inset: [6, 6], italic: true },
    { ...base, opacity: 0.6, rect: [100, 500, 154, 529], inset: [2, 2], bold: true },
  ];
  const tools = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
  assert.equal((await applyAnnotations(doc, { add }, tools, { fontSource: createFontSource({ fontkit }) })).ok, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-text-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'texts.pdf');
  fs.writeFileSync(file, await doc.save());
  const [decorated, translucent] = await inspectTexts(file);
  assert.deepEqual(decorated.rect, [100, 662.5, 165, 700]);
  assert.equal(decorated.DA, '/SigKJP 10 Tf 0.753 0 0 rg');
  assert.match(decorated.DS, /font-style: italic$/);
  assert.equal(decorated.C.length, 3);
  assert.deepEqual([decorated.BSW, decorated.CA, decorated.group, decorated.prefix, decorated.lines, decorated.italic], [2, 1, false, null, 2, true]);
  assert.deepEqual([translucent.BSW, translucent.CA, translucent.group, translucent.lines, translucent.italic], [0, 0.6, true, 2, false]);
  assert.equal(translucent.prefix, 'BT /SigKJPB 10 Tf 0.133 0.165 0.208 rg ET');
});
