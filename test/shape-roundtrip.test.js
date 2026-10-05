'use strict';

// 図形の保存と読み戻しの往復（spec-4b-5a 確定事項41）。画面の形 → toSaveEntry → ワーカーで PDF に書く → 辞書から pdf.js が返す形を組む
// → 読み込み（imported-shape.js・annotation-details.js。口の答えは annotation-dict-reader.js の detailsOf）を 3 回くり返し、形が変わらない
// ことを見る。pdf.js そのものは通さない（pdf.js が返す欄は spec-4b-5a 事前調査 C のとおりに組む）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const { applyAnnotations } = require('../worker/op-annotate.js');
const { detailsOf } = require('../worker/annotation-dict-reader.js');
const { pick } = require('../worker/pdf-tree-reader.js');

require('../renderer/free-text-geometry.js');
require('../renderer/imported-values.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/cross-geometry.js');
require('../renderer/shape-style.js');
require('../renderer/free-text-entry.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/imported-shape.js');
require('../renderer/annotation-box-details.js');
require('../renderer/annotation-details.js');

const { annotationEntry: entries, importedShape, annotationDetails, freeTextGeometry } = globalThis.SigK;
const TOOLS = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
const NOW = new Date(2026, 9, 5, 12, 0, 0);

function numbers(context, value) {
  const array = context.lookup(value);
  return array === undefined ? undefined : array.asArray().map((item) => context.lookup(item).asNumber());
}

// 保存した注釈の辞書から、pdf.js の getAnnotations() が返す欄を組む（spec-4b-5a 事前調査 C）。
function pdfjsDataOf(dict, context, ref) {
  const subtype = pick(dict, '/Subtype').encodedName.slice(1);
  const bs = context.lookup(pick(dict, '/BS'));
  const style = pick(bs, '/S')?.encodedName === '/D' ? 2 : 1;
  const width = pick(bs, '/W').asNumber();
  const data = {
    id: ref, subtype, rect: numbers(context, pick(dict, '/Rect')),
    color: pick(dict, '/C') === undefined ? null : Uint8ClampedArray.from(numbers(context, pick(dict, '/C')).map((value) => Math.round(value * 255))),
    borderStyle: { width, rawWidth: width, style, dashArray: style === 2 ? numbers(context, pick(bs, '/D')) : [3] },
  };
  if (subtype === 'Ink') {
    data.inkLists = context.lookup(pick(dict, '/InkList')).asArray().map((list) => Float32Array.from(numbers(context, list)));
    data.opacity = pick(dict, '/CA')?.asNumber() ?? 1;
  }
  if (subtype === 'PolyLine' || subtype === 'Polygon')
    data.vertices = Float32Array.from(numbers(context, pick(dict, '/Vertices')));
  if (subtype === 'PolyLine') {
    const le = context.lookup(pick(dict, '/LE'));
    data.lineEndings = le === undefined ? ['None', 'None'] : le.asArray().map((name) => name.encodedName.slice(1));
  }
  return data;
}

// 1 件を保存して読み戻した画面の形（口の答えも当てたもの）。
async function saveAndRead(entry) {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const result = await applyAnnotations(doc, { add: [entries.toSaveEntry(entry)] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 1, removed: 0 });
  const saved = await PDFDocument.load(await doc.save({ addDefaultPage: false }), { updateMetadata: false });
  const annots = saved.context.lookup(saved.getPages()[0].node.get(PDFName.of('Annots')));
  const dict = saved.context.lookup(annots.get(0));
  const imported = importedShape.importedShape(pdfjsDataOf(dict, saved.context, '9R'), 0);
  assert.notEqual(imported, null, '拾えなかった');
  return annotationDetails.applyDetails(imported, detailsOf(dict, saved.context));
}

// 3 回続けて保存と読み戻しをし、keys の欄が毎回はじめと同じであること。
async function roundTrips(entry, keys) {
  let current = { ...entry, id: 'sigk-1' };
  for (let round = 1; round <= 3; round += 1) {
    const read = await saveAndRead(current);
    assert.equal(read.readonly, undefined, `${round} 回目に表示のみになった`);
    for (const key of keys)
      assert.deepEqual(read[key], entry[key], `${round} 回目の ${key}`);
    current = { ...read, id: 'sigk-1' };
    delete current.ref;
  }
}

function crossEntry(overrides = {}) {
  const rect = [100.12, 600.34, 160.56, 640.78];
  return { src: 0, kind: 'cross', color: '#c00000', opacity: 1, lineWidth: 2, rect, quads: [freeTextGeometry.quadOfRect(rect)], ...overrides };
}

test('×印は 3 回往復しても、箱・角度・色・太さ・線種・不透明度が変わらない（回したもの・破線・半透明・小さなもの）', async () => {
  const keys = ['kind', 'rect', 'angle', 'color', 'lineWidth', 'lineStyle', 'opacity'];
  await roundTrips(crossEntry(), keys);
  await roundTrips(crossEntry({ angle: 30 }), keys);
  await roundTrips(crossEntry({ angle: 200, lineStyle: 'dashed', opacity: 0.5 }), keys);
  await roundTrips(crossEntry({ rect: [300, 300, 304, 312], angle: 345, lineWidth: 1 }), keys);
});
