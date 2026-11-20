'use strict';

// マーキングの保存と読み戻しの往復（spec-7-9 確定事項F6）。画面の形 → toSaveEntry → ワーカーで PDF に書く → 辞書から pdf.js が返す形を
// 組む → 読み込み（imported-shape.js・annotation-details.js・imported-marking.js。口の答えは annotation-dict-reader.js の detailsOf）を
// 3 回くり返し、形・大きさ・番号・色・線の太さ・不透明度が変わらないことを見る。pdf.js そのものは通さない（shape-roundtrip.test.js と同じ）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const { applyAnnotations } = require('../worker/op-annotate.js');
const { detailsOf } = require('../worker/annotation-dict-reader.js');
const { pick } = require('../worker/pdf-tree-reader.js');
const workerGeometry = require('../worker/marking-geometry.js');
const { RANGES: WORKER_RANGES } = require('../worker/marking-appearance.js');

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
require('../renderer/imported-shape.js');
require('../renderer/annotation-box-details.js');
require('../renderer/annotation-details.js');
require('../renderer/marking-rules.js');
require('../renderer/marking-glyphs.js');
require('../renderer/marking-geometry.js');
require('../renderer/imported-marking.js');

const { annotationEntry: entries, importedShape, annotationDetails, markingGeometry, markingGlyphs, markingRules } = globalThis.SigK;
const TOOLS = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
const NOW = new Date(2026, 10, 20, 12, 0, 0);

function numbers(context, value) {
  const array = context.lookup(value);
  return array === undefined ? undefined : array.asArray().map((item) => context.lookup(item).asNumber());
}

// 保存した丸の辞書から、pdf.js の getAnnotations() が返す欄を組む（shape-roundtrip.test.js と同じ）。
function pdfjsDataOf(dict, context, ref) {
  const bs = context.lookup(pick(dict, '/BS'));
  const width = pick(bs, '/W').asNumber();
  return {
    id: ref, subtype: pick(dict, '/Subtype').encodedName.slice(1), rect: numbers(context, pick(dict, '/Rect')),
    color: Uint8ClampedArray.from(numbers(context, pick(dict, '/C')).map((value) => Math.round(value * 255))),
    borderStyle: { width, rawWidth: width, style: 1, dashArray: [3] },
  };
}

async function save(entry) {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const result = await applyAnnotations(doc, { add: [entries.toSaveEntry(entry)] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 1, removed: 0 });
  const saved = await PDFDocument.load(await doc.save({ addDefaultPage: false }), { updateMetadata: false });
  const annots = saved.context.lookup(saved.getPages()[0].node.get(PDFName.of('Annots')));
  return { context: saved.context, dict: saved.context.lookup(annots.get(0)) };
}

async function saveAndRead(entry) {
  const { context, dict } = await save(entry);
  const imported = importedShape.importedShape(pdfjsDataOf(dict, context, '9R'), 0);
  return annotationDetails.applyDetails(imported, detailsOf(dict, context));
}

function markingEntry(shape, extra = {}) {
  const marking = { ...markingRules.DEFAULTS, shape, ...(shape === 'number' ? { number: 12 } : {}) };
  return {
    id: 'sigk-1', src: 0, kind: 'marking', color: '#0070c0', opacity: 1, lineWidth: 3, text: '', marking,
    ...markingGeometry.frameOf(marking, [200.5, 600.25]), ...extra,
  };
}

const KEYS = ['kind', 'color', 'opacity', 'lineWidth', 'rect', 'marking'];
const pickKeys = (entry) => Object.fromEntries(KEYS.map((key) => [key, entry[key]]));

test('形 5 種と半透明を、保存して読み戻すことを 3 回くり返しても、形・大きさ・番号・色・線の太さ・不透明度が変わらない', async () => {
  const cases = [...markingRules.SHAPES.map((shape) => markingEntry(shape)), markingEntry('double', { opacity: 0.45, lineWidth: 7 }),
    markingEntry('target', { marking: { ...markingRules.DEFAULTS, outer: 60.5, dot: 21.25 } })];
  for (const start of cases) {
    const entry = { ...start, ...markingGeometry.frameOf(start.marking, markingGeometry.centerOf(start.rect)) };
    let current = entry;
    for (let round = 1; round <= 3; round += 1) {
      const read = await saveAndRead(current);
      assert.equal(read.ref, '9R');
      assert.deepEqual(pickKeys(read), pickKeys(entry), `${entry.marking.shape} の ${round} 回目`);
      assert.equal(entries.validEntry(read), true);
      current = { ...read, id: 'sigk-1' };
      delete current.ref;
    }
  }
});

test('保存すると PDF 標準の丸の注釈 /Circle に外観を付け、値は外観のマーク付き内容の属性 /MK に書く。/IC とフォントは書かない', async () => {
  const { context, dict } = await save(markingEntry('number', { opacity: 0.5 }));
  assert.equal(pick(dict, '/Subtype').encodedName, '/Circle');
  assert.equal(pick(dict, '/IC'), undefined);
  assert.deepEqual(numbers(context, pick(dict, '/C')).map((value) => Math.round(value * 255)), [0, 112, 192]);
  assert.equal(pick(context.lookup(pick(dict, '/BS')), '/W').asNumber(), 3);
  assert.equal(pick(dict, '/CA').asNumber(), 0.5);
  assert.deepEqual(numbers(context, pick(dict, '/Rect')), markingEntry('number').rect);
  const stream = context.lookup(pick(context.lookup(pick(dict, '/AP')), '/N'));
  const resources = context.lookup(pick(stream.dict, '/Resources'));
  assert.equal(pick(resources, '/Font'), undefined, 'フォントを埋め込まない');
  const mk = context.lookup(pick(context.lookup(pick(resources, '/Properties')), '/MK'));
  assert.equal(pick(mk, '/Shape').encodedName, '/Number');
  assert.equal(pick(mk, '/Number').asNumber(), 12);
  assert.equal(pick(mk, '/Outer').asNumber(), 32);
  const content = Buffer.from(stream.getContents()).toString('latin1');
  assert.match(content, /^\/SigKMark \/MK BDC\n/);
  assert.match(content, /\nEMC$/);
  assert.match(content, /\/G0 Do/, '半透明は透明グループで包む');
  // 注釈の辞書には独自の欄を追加しない（決定61 ②）。
  const keys = dict.keys().map((key) => key.encodedName).sort();
  assert.deepEqual(keys, ['/AP', '/BS', '/Border', '/C', '/CA', '/Contents', '/F', '/M', '/NM', '/P', '/Rect', '/Subtype', '/Type']);
});

test('マーキングの値を持たない丸（ほかのアプリの丸・今までのファイル）は、今までどおり丸として読む', async () => {
  const circle = { id: 'c1', src: 0, kind: 'circle', color: '#ff0000', opacity: 1, lineWidth: 2, rect: [100, 600, 140, 640], quads: [[100, 640, 140, 640, 100, 600, 140, 600]], text: '' };
  const read = await saveAndRead(circle);
  assert.equal(read.kind, 'circle');
  // 範囲の外の値は組み直さない。
  const detail = { ca: 1, marking: { shape: 'target', outer: 2, dot: 1, ring: 1, cross: 4, fontSize: 16 } };
  assert.equal(globalThis.SigK.importedMarking.withMarking({ ...circle, ref: '9R' }, detail), null);
});

test('ワーカーの部品と数字の表は、画面と同じ（形 5 種・桁数・線の太さ）', () => {
  assert.deepEqual(workerGeometry.GLYPHS, markingGlyphs.GLYPHS);
  assert.deepEqual(WORKER_RANGES, Object.fromEntries(Object.entries(markingRules.RANGES).map(([field, range]) => [field, [...range]])));
  for (const shape of markingRules.SHAPES) {
    for (const [lineWidth, extra] of [[3, {}], [12, { outer: 20, dot: 20, ring: 5 }], [1, { number: 1234, fontSize: 40 }]]) {
      const marking = { ...markingRules.DEFAULTS, ...extra, shape, ...(shape === 'number' ? { number: extra.number ?? 7 } : {}) };
      const entry = { lineWidth, marking, ...markingGeometry.frameOf(marking, [123.45, 456.78]) };
      assert.deepEqual(workerGeometry.partsOf(entry), markingGeometry.partsOf(entry), `${shape} ${lineWidth}`);
    }
  }
});

test('pdf.js が外観を読み、マーク付き内容と円の線・番号の線を命令の並びにする', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  await applyAnnotations(doc, { add: [entries.toSaveEntry(markingEntry('number'))] }, TOOLS, { now: NOW });
  const bytes = await doc.save();
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const pdfjs = await import(pathToFileURL(path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
  try {
    const page = await (await task.promise).getPage(1);
    const annotations = await page.getAnnotations();
    assert.equal(annotations[0].subtype, 'Circle');
    const list = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE });
    assert.ok(list.fnArray.includes(pdfjs.OPS.beginMarkedContentProps));
    assert.ok(list.fnArray.includes(pdfjs.OPS.endMarkedContent));
    assert.ok(list.fnArray.filter((op) => op === pdfjs.OPS.constructPath).length >= 2, '外の円と番号の線');
  } finally {
    await task.destroy();
  }
});

test('フラット化は外観をそのまま焼き込む（丸の注釈と同じ扱い）', async () => {
  const { flattenDocument } = require('../worker/op-flatten.js');
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  await applyAnnotations(doc, { add: [entries.toSaveEntry(markingEntry('crosshair'))] }, TOOLS, { now: NOW });
  const loaded = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  const result = flattenDocument(loaded, { PDFName });
  assert.equal(result.ok, true);
  assert.equal(result.bake.shape, 1);
  const saved = await PDFDocument.load(await loaded.save({ addDefaultPage: false }), { updateMetadata: false });
  assert.equal(saved.getPages()[0].node.get(PDFName.of('Annots')), undefined);
});
