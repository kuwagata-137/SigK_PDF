'use strict';

// 起動確認の、保存先の FreeText の欄を読む口（smoke-annotate-inspect.js。spec-4b-4b の起動確認）。回したテキストと吹き出しの欄を読むこと。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { inspectTexts } = require('../smoke-annotate-inspect.js');
const smokeText = require('../smoke-annotate-text.js');
const { applyAnnotations } = require('../worker/op-annotate.js');
const { createFontSource } = require('../worker/font-embed.js');
const { matrixOf } = require('../worker/shape-rotation.js');

test('inspectTexts は回したテキストの /Matrix・/BBox と、吹き出しの /IT・/CL・/LE・/RD を読み、箱で切り抜いているかを返す', async (t) => {
  assert.equal(smokeText.inspectTexts, inspectTexts, 'smoke-annotate-text.js からも同じ口を引ける');
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const base = { src: 0, kind: 'text', color: '#222a35', opacity: 1, fontSize: 10, rotation: 0, text: 'あいう', width: 'auto', lines: ['あいう'], inset: [2, 2] };
  const box = [100, 686, 134, 700];
  const add = [
    { ...base, rect: box, angle: 30 },
    { ...base, rect: [100, 500, 145.5, 523.5], inset: [6.75, 6.75], fill: '#ffffff', borderColor: '#c00000', borderWidth: 1.5, callout: { tip: [90, 460] } },
  ];
  const tools = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
  assert.equal((await applyAnnotations(doc, { add }, tools, { fontSource: createFontSource({ fontkit }) })).ok, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-inspect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'texts.pdf');
  fs.writeFileSync(file, await doc.save());
  const [turned, callout] = await inspectTexts(file);
  assert.deepEqual(turned.matrix, matrixOf(box, 30));
  assert.deepEqual(turned.bbox, box);
  assert.deepEqual([turned.IT, turned.CL, turned.LE, turned.RD, turned.clipped], [null, null, null, null, true]);
  assert.deepEqual([callout.IT, callout.LE, callout.matrix, callout.clipped], ['FreeTextCallout', 'None', null, false]);
  assert.deepEqual(callout.CL.slice(0, 2), [90, 460]);
  assert.equal(callout.RD.length, 4);
  assert.deepEqual(callout.rect, callout.bbox);
});
