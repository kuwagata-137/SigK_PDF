'use strict';

// 起動確認の吹き出しの操作と結果の欄（smoke-annotate-callout.js。spec-4b-4b の起動確認）と、保存先の吹き出しの欄を読む口
// （smoke-annotate-text.js の inspectTexts）。スクリプトは実機でしか回せないので、ここは式が文法として正しいことと、欄を正しく読むことを見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { annotateScript } = require('../smoke-annotate.js');
const { CALLOUT_STEPS, CALLOUT_REPORT } = require('../smoke-annotate-callout.js');
const { inspectTexts } = require('../smoke-annotate-text.js');
const { applyAnnotations } = require('../worker/op-annotate.js');
const { createFontSource } = require('../worker/font-embed.js');

test('吹き出しの操作を入れた操作列も式として読め、分岐と結果は 1 度だけ埋まる', () => {
  const script = annotateScript('x.pdf', 'bar:callout,callout:0:100x700:確認|お願いします,grab:tip:60x20:shift,angle:30,click-tail:2,callout-draft:0:300x500:打ちかけ,save,reopen,compare:2');
  assert.doesNotThrow(() => new vm.Script(script));
  for (const part of [CALLOUT_STEPS, CALLOUT_REPORT]) {
    assert.equal(script.split(part).length, 2);
    assert.equal(part.includes('`'), false);
    assert.equal(part.includes('${'), false);
  }
  assert.ok(script.includes('callout: calloutReport'), '結果の callout の欄に入れる');
});

test('inspectTexts は吹き出しの /IT・/CL・/RD・/LE と、回した外観の /Matrix を読む（吹き出しでなければ null）', async (t) => {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const base = { src: 0, kind: 'text', color: '#222a35', fontSize: 10, rotation: 0, text: 'あいう', width: 'auto', lines: ['あいう'], opacity: 1 };
  const add = [
    { ...base, rect: [100, 670, 142, 700], fill: '#ffffff', borderColor: '#c00000', borderWidth: 2, inset: [6, 6], tip: [110, 640], angle: 30 },
    { ...base, rect: [100, 500, 134, 516], inset: [2, 2] },
  ];
  const tools = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
  assert.equal((await applyAnnotations(doc, { add }, tools, { fontSource: createFontSource({ fontkit }) })).ok, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-callout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'callouts.pdf');
  fs.writeFileSync(file, await doc.save());
  const [callout, plain] = await inspectTexts(file);
  assert.equal(callout.IT, '/FreeTextCallout');
  assert.equal(callout.LE, '/None');
  assert.equal(callout.CL.length, 4);
  assert.equal(callout.RD.length, 4);
  assert.equal(callout.Matrix.length, 6);
  assert.deepEqual([plain.IT, plain.CL, plain.RD, plain.LE, plain.Matrix], [null, null, null, null, null]);
});
