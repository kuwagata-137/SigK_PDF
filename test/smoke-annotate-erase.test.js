'use strict';

// 起動確認のマーカー・消しゴム・「その他」の操作（smoke-annotate-erase.js。spec-4b-5b 確定事項33）と、画面写真の画素の数え方・保存先の
// 重ね方の読み取り。スクリプトは実機でしか回せないので、ここは「操作を入れた式が文法として正しいこと」と「画素と欄を正しく数え・読むこと」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const { annotateScript, inspectAnnotations, pixelsIn } = require('../smoke-annotate.js');
const { ERASE_STATE, ERASE_STEPS, ERASE_REPORT } = require('../smoke-annotate-erase.js');
const { applyAnnotations } = require('../worker/op-annotate.js');

test('マーカー・消しゴム・「その他」の操作を入れた操作列も式として読め、状態・分岐・結果は 1 度だけ埋まる', () => {
  const script = annotateScript('x.pdf', 'marker:0:230x420;330x420,pen:0:100x500;300x500,erase:0:150x480;150x520,undo,redo,bar-width:944,more:eraser,bar-width:,erase-draft:0:200x480;200x520,save,reink,reink,reink,marker-pixels:2');
  assert.doesNotThrow(() => new vm.Script(script));
  for (const part of [ERASE_STATE, ERASE_STEPS, ERASE_REPORT]) {
    assert.equal(script.split(part).length, 2);
    assert.equal(part.includes('`'), false);
    assert.equal(part.includes('${'), false);
  }
  assert.ok(script.includes('erase: eraseReport'), '結果の erase の欄に入れる');
});

// B・G・R・A の順の画素を持つ、Electron の NativeImage に似せたもの。
function imageOf(width, height, colorAt) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colorAt(x, y);
      bitmap.set([b, g, r, 255], (y * width + x) * 4);
    }
  }
  return { getSize: () => ({ width, height }), toBitmap: () => bitmap };
}

test('pixelsIn は箱の縁を 1 画素ずつ除いた中の、暗い画素と黄の画素を数え、画面の倍率に合わせる', () => {
  // 左半分が黄、右半分が暗い（乗算で残った文字）。画面写真は CSS px の 2 倍
  const image = imageOf(40, 20, (x) => (x < 20 ? [255, 255, 0] : [28, 36, 0]));
  const counted = pixelsIn(image, { box: [0, 0, 20, 10], viewWidth: 20, viewHeight: 10 });
  assert.deepEqual(counted, { dark: 19 * 18, yellow: 19 * 18, total: 38 * 18, factor: 2 });
  // B・G・R の順を取り違えると、黄は青に見えて数えない
  const blue = imageOf(10, 10, () => [0, 0, 255]);
  assert.equal(pixelsIn(blue, { box: [0, 0, 10, 10], viewWidth: 10, viewHeight: 10 }).yellow, 0);
  // 箱が画面の外なら null
  assert.equal(pixelsIn(image, { box: [50, 0, 60, 10], viewWidth: 20, viewHeight: 10 }), null);
});

test('inspectAnnotations はマーカーの外観の重ね方 /BM /Multiply を読み、ペンは null', async (t) => {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const add = [
    { src: 0, kind: 'ink', blend: 'multiply', color: '#ffff00', opacity: 1, lineWidth: 12, rect: [94, 494, 306, 506], paths: [[[100, 500], [300, 500]]] },
    { src: 0, kind: 'ink', color: '#c00000', opacity: 1, lineWidth: 2, rect: [99, 399, 301, 401], paths: [[[100, 400], [300, 400]]] },
  ];
  const tools = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
  assert.equal((await applyAnnotations(doc, { add }, tools, {})).ok, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-erase-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'marker.pdf');
  fs.writeFileSync(file, await doc.save());
  const [marker, pen] = await inspectAnnotations(file);
  assert.equal(marker.subtype, 'Ink');
  assert.equal(marker.BM, 'Multiply');
  assert.equal(marker.group, true, '不透明度 100% でも透明グループで包む');
  assert.equal(pen.BM, null);
});
