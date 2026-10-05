'use strict';

// 起動確認の図形の追加の操作（smoke-annotate-shapes.js。spec-4b-5a の起動確認）と、保存先の矢印の先・多角形・×印の欄の読み取り。
// スクリプトは実機でしか回せないので、ここは「図形の操作を入れた式が文法として正しいこと」と「保存先の欄を正しく読むこと」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const { annotateScript, inspectAnnotations } = require('../smoke-annotate.js');
const { SHAPE_STATE, SHAPE_STEPS, SHAPE_REPORT } = require('../smoke-annotate-shapes.js');
const { applyAnnotations } = require('../worker/op-annotate.js');

test('図形の追加の操作を入れた操作列も式として読め、状態・分岐・結果は 1 度だけ埋まる', () => {
  const script = annotateScript('x.pdf', 'bar:cross,shape:cross:0:100x700-160x640,polygon:0:250x760;350x760;330x680:close,polygon:0:250x560;350x560;330x480:open,bar:line,snap:0:100x700-60x600,save,reshape,compare-shapes:2');
  assert.doesNotThrow(() => new vm.Script(script));
  for (const part of [SHAPE_STATE, SHAPE_STEPS, SHAPE_REPORT]) {
    assert.equal(script.split(part).length, 2);
    assert.equal(part.includes('`'), false);
    assert.equal(part.includes('${'), false);
  }
  assert.ok(script.includes('shapes: shapeReport'), '結果の shapes の欄に入れる');
});

test('inspectAnnotations は多角形（Polygon・PolyLine）と ×印（Ink）・塗った三角の矢印の /LE・/Vertices・/InkList を読む', async (t) => {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const add = [
    { src: 0, kind: 'polygon', closed: true, color: '#c00000', fill: '#ffff00', opacity: 1, lineWidth: 2, rect: [99, 599, 201, 721], paths: [[[100, 600], [180, 620], [200, 720]]] },
    { src: 0, kind: 'polygon', closed: false, color: '#c00000', opacity: 1, lineWidth: 2, rect: [99, 599, 201, 721], paths: [[[100, 600], [180, 620], [200, 720]]] },
    { src: 0, kind: 'cross', color: '#c00000', opacity: 1, lineWidth: 2, rect: [99, 399, 161, 461], paths: [[[100, 460], [160, 400]], [[160, 460], [100, 400]]] },
    { src: 0, kind: 'arrow', color: '#c00000', opacity: 1, lineWidth: 2, rect: [99, 199, 301, 211], paths: [[[100, 205], [300, 205]]] },
  ];
  const tools = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
  assert.equal((await applyAnnotations(doc, { add }, tools, {})).ok, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-shapes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'shapes.pdf');
  fs.writeFileSync(file, await doc.save());
  const [closed, open, cross, arrow] = await inspectAnnotations(file);
  assert.equal(closed.subtype, 'Polygon');
  assert.equal(closed.vertices, 6);
  assert.deepEqual(closed.IC, [1, 1, 0]);
  assert.equal(open.subtype, 'PolyLine');
  assert.equal(open.LE, null);
  assert.equal(cross.subtype, 'Ink');
  assert.equal(cross.inkList, 2);
  assert.deepEqual(arrow.LE, ['None', 'ClosedArrow']);
  assert.deepEqual(arrow.IC, arrow.C);
});
