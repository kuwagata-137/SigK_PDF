'use strict';

// 塗りと枠線を分けて描く図形の保存の外観と、読み戻し（spec-7-9 確定事項B2・B4・B5・C1〜C4）。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const { applyAnnotations } = require('../worker/op-annotate.js');
const { shapeAppearanceOf } = require('../worker/shape-appearance.js');
const { detailsOf } = require('../worker/annotation-dict-reader.js');
const { pick } = require('../worker/pdf-tree-reader.js');
const workerHatch = require('../worker/hatch-geometry.js');
const workerFill = require('../worker/fill-style-rules.js');
const { HATCH_NAMES } = require('../worker/fill-apart-appearance.js');
const { PATTERNS } = require('../worker/appearance-fill-style.js');

require('../renderer/free-text-geometry.js');
require('../renderer/imported-values.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/cross-geometry.js');
require('../renderer/fill-style.js');
require('../renderer/shape-style.js');
require('../renderer/free-text-entry.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/hatch-geometry.js');
require('../renderer/imported-shape.js');
require('../renderer/polygon-geometry.js');
require('../renderer/imported-polygon.js');
require('../renderer/annotation-box-details.js');
require('../renderer/imported-fill-style.js');
require('../renderer/annotation-details.js');

const { annotationEntry: entries, importedShape, annotationDetails, freeTextGeometry, hatchGeometry, fillStyle } = globalThis.SigK;
const TOOLS = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
const NOW = new Date(2026, 10, 20, 12, 0, 0);
const HATCH = Object.freeze({ pattern: 'diagonal', color: '#0070c0', gap: 6, width: 1 });

function square(overrides = {}) {
  const rect = [100, 600, 220, 680];
  return { id: 'sigk-1', src: 0, kind: 'square', color: '#c00000', fill: '#ffd966', opacity: 1, lineWidth: 4, rect, quads: [freeTextGeometry.quadOfRect(rect)], text: '', ...overrides };
}

test('ハッチングの線と欄の決まりは、画面とワーカーで同じ', () => {
  for (const pattern of fillStyle.HATCH_PATTERNS) {
    for (const box of [[100, 600, 220, 680], [0, 0, 3, 97.5], [10.5, 20.25, 400, 21]])
      assert.deepEqual(workerHatch.linesOf(box, { ...HATCH, pattern }), hatchGeometry.linesOf(box, { ...HATCH, pattern }), `${pattern} ${box}`);
  }
  assert.equal(workerHatch.LINES_MAX, hatchGeometry.LINES_MAX);
  assert.deepEqual(workerFill.HATCH_PATTERNS, fillStyle.HATCH_PATTERNS);
  for (const key of ['HATCH_GAP_MIN', 'HATCH_GAP_MAX', 'HATCH_WIDTH_MIN', 'HATCH_WIDTH_MAX'])
    assert.equal(workerFill[key], fillStyle[key], key);
  // 外観の属性の名前は、書く側と読む側で対になる。
  assert.deepEqual(Object.fromEntries(Object.entries(HATCH_NAMES).map(([pattern, name]) => [name, pattern])), PATTERNS);
});

test('同じ不透明度でハッチングが無い図形は、今までどおりの外観（透明グループと辞書の /CA）', () => {
  const appearance = shapeAppearanceOf(entries.toSaveEntry(square({ opacity: 0.5, fillOpacity: 0.5 })));
  assert.equal(appearance.group, true);
  assert.equal(appearance.opacity, 0.5);
  assert.equal(appearance.apart, undefined);
  assert.doesNotMatch(appearance.content, /BDC/);
});

test('塗りと枠線の不透明度が違う図形は、塗り・ハッチング・枠線を別の ExtGState で描き、マーク付き内容に値を書く', () => {
  const appearance = shapeAppearanceOf(entries.toSaveEntry(square({ opacity: 0.6, fillOpacity: 0.3, hatch: { ...HATCH } })));
  assert.equal(appearance.group, false);
  assert.equal(appearance.opacity, 1);
  const lines = appearance.content.split('\n');
  assert.deepEqual(lines.slice(0, 4), ['/SigKStyle /SK BDC', 'q /GF gs', '1 0.851 0.4 rg', '102 602 116 76 re f']);
  // ハッチングは塗りの上で、図形の形で切り抜く。枠線は最後に GL で。
  const clip = lines.indexOf('102 602 116 76 re W n');
  assert.ok(clip > 3);
  assert.equal(lines[clip + 1], '0 0.439 0.753 RG 1 w 0 J 0 j [] 0 d');
  assert.deepEqual(lines.slice(-5), ['q /GL gs', '0.753 0 0 RG 4 w', '102 602 116 76 re S', 'Q', 'EMC']);
  assert.deepEqual(appearance.apart.states, { GF: { ca: 0.3, CA: 1 }, GL: { CA: 0.6, ca: 0.6 } });
  assert.deepEqual(appearance.apart.properties, { SK: { FillOpacity: 0.3, Opacity: 0.6, Hatch: 'Diagonal', HatchColor: [0, 0.4392, 0.7529], HatchGap: 6, HatchWidth: 1 } });
  // 枠線が半透明なので、内側から枠線の帯を抜く輝度の Form を持つ。
  assert.equal(appearance.apart.mask, '1 g\n102 602 116 76 re f\n0 G 4 w\n102 602 116 76 re S');
  // 枠線が不透明なら抜かない。
  assert.equal(shapeAppearanceOf(entries.toSaveEntry(square({ fillOpacity: 0.3 }))).apart.mask, null);
});

test('雲形の丸は、ハッチングを雲の形で切り抜く。閉じた多角形も分けて描ける', () => {
  const cloudy = shapeAppearanceOf(entries.toSaveEntry(square({ kind: 'circle', lineStyle: 'cloudy', cloudIntensity: 1, hatch: { ...HATCH } })));
  const lines = cloudy.content.split('\n');
  const clip = lines.findIndex((line) => line.endsWith(' W n'));
  assert.ok(clip > 0);
  assert.equal(lines[clip], 'h W n');
  assert.match(lines[clip - 1], / c$/);
  assert.ok(cloudy.rectDifference !== undefined);
  const polygon = shapeAppearanceOf(entries.toSaveEntry({ ...square(), kind: 'polygon', closed: true, rect: [98, 598, 202, 702], paths: [[[100, 600], [200, 600], [150, 700]]], fillOpacity: 0.2 }));
  assert.equal(polygon.subtype, 'Polygon');
  assert.match(polygon.content, /100 600 m 200 600 l 150 700 l h f/);
});

function numbers(context, value) {
  const array = context.lookup(value);
  return array === undefined ? undefined : array.asArray().map((item) => context.lookup(item).asNumber());
}

async function saveOne(entry) {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const result = await applyAnnotations(doc, { add: [entries.toSaveEntry(entry)] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 1, removed: 0 });
  const bytes = await doc.save({ addDefaultPage: false });
  const saved = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = saved.context.lookup(saved.getPages()[0].node.get(PDFName.of('Annots')));
  return { bytes, context: saved.context, dict: saved.context.lookup(annots.get(0)) };
}

test('辞書の /CA は 1 で、外観の資源に GF（SMask 付き）・GL・/Properties /SK を持つ', async () => {
  const { context, dict } = await saveOne(square({ opacity: 0.6, fillOpacity: 0.3, hatch: { ...HATCH } }));
  assert.equal(pick(dict, '/CA').asNumber(), 1);
  const stream = context.lookup(pick(context.lookup(pick(dict, '/AP')), '/N'));
  const resources = context.lookup(pick(stream.dict, '/Resources'));
  const states = context.lookup(pick(resources, '/ExtGState'));
  const gf = context.lookup(pick(states, '/GF'));
  assert.equal(pick(gf, '/ca').asNumber(), 0.3);
  const mask = context.lookup(pick(gf, '/SMask'));
  assert.equal(pick(mask, '/S').encodedName, '/Luminosity');
  const group = context.lookup(pick(mask, '/G'));
  assert.equal(pick(context.lookup(pick(group.dict, '/Group')), '/CS').encodedName, '/DeviceGray');
  assert.equal(pick(context.lookup(pick(states, '/GL')), '/CA').asNumber(), 0.6);
  const sk = context.lookup(pick(context.lookup(pick(resources, '/Properties')), '/SK'));
  assert.deepEqual(numbers(context, pick(sk, '/HatchColor')), [0, 0.4392, 0.7529]);
});

// 保存した辞書から、pdf.js の getAnnotations() が返す欄を組む（shape-roundtrip.test.js と同じ。spec-4b-5a 事前調査 C）。
function pdfjsDataOf(dict, context) {
  const subtype = pick(dict, '/Subtype').encodedName.slice(1);
  const bs = context.lookup(pick(dict, '/BS'));
  const width = pick(bs, '/W').asNumber();
  const data = {
    id: '9R', subtype, rect: numbers(context, pick(dict, '/Rect')),
    color: pick(dict, '/C') === undefined ? null : Uint8ClampedArray.from(numbers(context, pick(dict, '/C')).map((value) => Math.round(value * 255))),
    borderStyle: { width, rawWidth: width, style: 1, dashArray: [3] },
  };
  if (subtype === 'Polygon')
    data.vertices = Float32Array.from(numbers(context, pick(dict, '/Vertices')));
  return data;
}

async function roundTrips(entry, keys) {
  let current = entry;
  for (let round = 1; round <= 3; round += 1) {
    const { context, dict } = await saveOne(current);
    const imported = importedShape.importedShape(pdfjsDataOf(dict, context), 0);
    const read = annotationDetails.applyDetails(imported, detailsOf(dict, context));
    assert.equal(read.readonly, undefined, `${round} 回目に表示のみになった`);
    for (const key of keys)
      assert.deepEqual(read[key], entry[key], `${round} 回目の ${key}`);
    current = { ...read, id: 'sigk-1', text: '' };
    delete current.ref;
  }
}

test('保存 → 読み戻しで、枠線の不透明度・塗りの不透明度・ハッチングが同じ値に戻る（3 回）', async () => {
  await roundTrips(square({ opacity: 0.6, fillOpacity: 0.3, hatch: { ...HATCH } }), ['opacity', 'fillOpacity', 'hatch', 'fill', 'color', 'rect']);
  await roundTrips(square({ kind: 'circle', color: null, fillOpacity: 0.45, hatch: { pattern: 'grid', color: '#00b050', gap: 12.5, width: 0.25 } }), ['opacity', 'fillOpacity', 'hatch', 'fill', 'color']);
  await roundTrips(square({ angle: 30, opacity: 0.8, hatch: { ...HATCH, pattern: 'reverse' } }), ['opacity', 'fillOpacity', 'hatch', 'angle', 'rect']);
  const paths = [[[100, 600], [200, 600], [150, 700]]];
  const polygon = { ...square(), kind: 'polygon', closed: true, paths, ...globalThis.SigK.shapeGeometry.rectOfShape({ kind: 'polygon', paths, lineWidth: 4 }) };
  await roundTrips({ ...polygon, opacity: 0.5, fillOpacity: 0.9, hatch: { ...HATCH, pattern: 'horizontal' } }, ['opacity', 'fillOpacity', 'hatch', 'paths', 'closed']);
  await roundTrips(square({ fill: undefined, hatch: { ...HATCH, pattern: 'vertical' } }), ['opacity', 'fillOpacity', 'hatch', 'fill']);
});

test('属性の無い外観（今までのファイル）は、今までどおり辞書の /CA を不透明度として読む', async () => {
  const { context, dict } = await saveOne(square({ opacity: 0.5 }));
  const detail = detailsOf(dict, context);
  assert.equal(detail.fillStyle, null);
  const read = annotationDetails.applyDetails(importedShape.importedShape(pdfjsDataOf(dict, context), 0), detail);
  assert.equal(read.opacity, 0.5);
  assert.equal(read.fillOpacity, undefined);
  assert.equal(read.hatch, undefined);
});

test('pdf.js が外観を読み、SMask とマーク付き内容を含む命令の並びにする', async () => {
  const { bytes } = await saveOne(square({ opacity: 0.6, fillOpacity: 0.3, hatch: { ...HATCH }, angle: 30 }));
  const entry = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
  const pdfjs = await import(pathToFileURL(entry).href);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const list = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE });
    const ops = list.fnArray;
    assert.ok(ops.includes(pdfjs.OPS.beginMarkedContentProps));
    const states = list.argsArray.filter((_args, index) => ops[index] === pdfjs.OPS.setGState).flatMap((args) => args[0]);
    assert.ok(states.some(([key, value]) => key === 'SMask' && value !== false));
    assert.ok(states.some(([key, value]) => key === 'ca' && value === 0.3));
    assert.ok(states.some(([key, value]) => key === 'CA' && value === 0.6));
  } finally {
    await task.destroy();
  }
});

test('フラット化は外観をそのまま焼き込み、塗りと枠線の ExtGState と SMask も一緒に残る', async () => {
  const { flattenDocument } = require('../worker/op-flatten.js');
  const { bytes } = await saveOne(square({ opacity: 0.6, fillOpacity: 0.3, hatch: { ...HATCH } }));
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const result = flattenDocument(doc, { PDFName });
  assert.equal(result.ok, true);
  assert.equal(result.bake.shape, 1);
  const saved = await PDFDocument.load(await doc.save({ addDefaultPage: false }), { updateMetadata: false });
  const context = saved.context;
  const xobjects = context.lookup(pick(context.lookup(saved.getPage(0).node.get(PDFName.of('Resources'))), '/XObject'));
  const baked = [...xobjects.entries()].map(([, value]) => context.lookup(value));
  const states = baked.map((stream) => context.lookup(pick(context.lookup(pick(stream.dict, '/Resources')), '/ExtGState'))).find((value) => value !== undefined);
  assert.notEqual(context.lookup(pick(context.lookup(pick(states, '/GF')), '/SMask')), undefined);
});

test('塗りつぶしもハッチングも無い図形は、塗りの不透明度が違っても今までどおりの外観で書く', () => {
  const appearance = shapeAppearanceOf(entries.toSaveEntry(square({ fill: undefined, opacity: 0.5, fillOpacity: 1 })));
  assert.equal(appearance.apart, undefined);
  assert.equal(appearance.opacity, 0.5);
});
