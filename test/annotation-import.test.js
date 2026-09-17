'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/markup-quads.js');
require('../renderer/free-text-geometry.js');
require('../renderer/annotation-import.js');

// ファイルにあるテキストマークアップを集める層（spec-4-1 確定事項17・18）。

const imp = globalThis.SigK.annotationImport;

test('hexOf は 0〜255 の RGB を #rrggbb にし、無ければ黒', () => {
  assert.equal(imp.hexOf(new Uint8ClampedArray([255, 230, 51])), '#ffe633');
  assert.equal(imp.hexOf([0, 0, 0]), '#000000');
  assert.equal(imp.hexOf(null), '#000000');
  assert.equal(imp.hexOf([1]), '#000000');
});

test('quadsOf は 8 つずつ四角に切り、端数は捨てる', () => {
  assert.deepEqual(imp.quadsOf(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])), [[1, 2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15, 16]]);
  assert.deepEqual(imp.quadsOf([1, 2, 3]), []);
  assert.deepEqual(imp.quadsOf(undefined), []);
  assert.deepEqual(imp.quadsOf([1.234567, 2, 3, 4, 5, 6, 7, 8]), [[1.23, 2, 3, 4, 5, 6, 7, 8]]);
});

test('importedEntry はテキストマークアップだけを自前の形にする', () => {
  const entry = imp.importedEntry({ id: '86R', subtype: 'Underline', rect: [40, 600, 200, 612], quadPoints: [40, 612, 200, 612, 40, 600, 200, 600], color: [217, 44, 44] }, 3);
  assert.deepEqual(entry, {
    ref: '86R', src: 3, kind: 'underline', color: '#d92c2c', opacity: 1,
    quads: [[40, 612, 200, 612, 40, 600, 200, 600]], rect: [40, 600, 200, 612],
  });
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Highlight', quadPoints: [1, 2, 3, 4, 5, 6, 7, 8], color: [0, 0, 0], opacity: 0.6 }, 0).opacity, 0.6);
  // rect が無ければ四角の外接。
  assert.deepEqual(imp.importedEntry({ id: '1R', subtype: 'StrikeOut', quadPoints: [1, 8, 9, 8, 1, 2, 9, 2], color: [0, 0, 0] }, 0).rect, [1, 2, 9, 8]);
  assert.equal(imp.importedEntry({ id: '2R', subtype: 'Link', rect: [0, 0, 1, 1] }, 0), null);
  assert.equal(imp.importedEntry({ id: '3R', subtype: 'Highlight', quadPoints: [] }, 0), null);
  assert.equal(imp.importedEntry({ subtype: 'Highlight', quadPoints: [1, 2, 3, 4, 5, 6, 7, 8] }, 0), null);
});

// 文書の代わり。getAnnotations の結果を仕込む。
function makeDoc(pages) {
  const storage = new Map();
  return {
    numPages: pages.length,
    annotationStorage: { setValue: (key, value) => storage.set(key, value) },
    storage,
    getPage: async (number) => ({ getAnnotations: async () => pages[number - 1] }),
  };
}

test('importDocument は全ページから集め、pdf.js に描かせない印を付け、viewer へ渡す', async () => {
  const calls = [];
  globalThis.SigK.viewer = { setImported: (imported, options) => calls.push({ imported, options }) };
  const doc = makeDoc([
    [],
    [{ id: '5R', subtype: 'Highlight', quadPoints: [1, 8, 9, 8, 1, 2, 9, 2], color: [255, 0, 0] }, { id: '6R', subtype: 'Link' }],
    [{ id: '7R', subtype: 'StrikeOut', quadPoints: [1, 8, 9, 8, 1, 2, 9, 2], color: [0, 0, 255] }],
  ]);
  const imported = await imp.importDocument(doc);
  assert.deepEqual(Object.keys(imported), ['1', '2']);
  assert.equal(imported[1][0].ref, '5R');
  assert.equal(imported[2][0].kind, 'strikeout');
  assert.deepEqual([...doc.storage.entries()], [['5R', { noView: true }], ['7R', { noView: true }]]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { rerender: [1, 2] });
  delete globalThis.SigK.viewer;
});

test('importDocument は集めている間に文書が変われば捨てる', async () => {
  const calls = [];
  globalThis.SigK.viewer = { setImported: (imported) => calls.push(imported) };
  const doc = makeDoc([[{ id: '5R', subtype: 'Highlight', quadPoints: [1, 8, 9, 8, 1, 2, 9, 2], color: [255, 0, 0] }]]);
  assert.equal(await imp.importDocument(doc, () => false), null);
  assert.equal(calls.length, 0);
  assert.equal(await imp.importDocument(null), null);
  delete globalThis.SigK.viewer;
});

test('importDocument は getAnnotations が投げても止まらない', async () => {
  const calls = [];
  globalThis.SigK.viewer = { setImported: (imported) => calls.push(imported) };
  const doc = {
    numPages: 2,
    annotationStorage: { setValue: () => {} },
    getPage: async (number) => ({ getAnnotations: async () => { if (number === 1) throw new Error('壊れている'); return [{ id: '9R', subtype: 'Underline', quadPoints: [1, 8, 9, 8, 1, 2, 9, 2], color: [0, 0, 0] }]; } }),
  };
  const imported = await imp.importDocument(doc);
  assert.deepEqual(Object.keys(imported), ['1']);
  delete globalThis.SigK.viewer;
});

// ---- 図形・ペン（spec-4-3 確定事項13） ----

const BORDER = { width: 3, rawWidth: 3, style: 1, dashArray: [3] };

test('importedEntry は Square・Circle を箱と線幅で拾う', () => {
  const square = imp.importedEntry({ id: '12R', subtype: 'Square', rect: [100, 650, 300, 780], color: new Uint8ClampedArray([41, 112, 217]), borderStyle: { ...BORDER, width: 2 } }, 0);
  assert.deepEqual(square, {
    ref: '12R', src: 0, kind: 'square', color: '#2970d9', opacity: 1, lineWidth: 2,
    rect: [100, 650, 300, 780], quads: [[100, 780, 300, 780, 100, 650, 300, 650]],
  });
  const circle = imp.importedEntry({ id: '14R', subtype: 'Circle', rect: [330.004, 650, 500, 780], color: [217, 43, 43], borderStyle: BORDER, opacity: 0.5 }, 2);
  assert.equal(circle.kind, 'circle');
  assert.equal(circle.src, 2);
  assert.equal(circle.lineWidth, 3);
  assert.equal(circle.opacity, 0.5);
  assert.deepEqual(circle.rect, [330, 650, 500, 780]);
  // 線幅が無ければ 1、/C が無ければ拾わない
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Square', rect: [0, 0, 10, 10], color: [0, 0, 0] }, 0).lineWidth, 1);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Square', rect: [0, 0, 10, 10], color: null, borderStyle: BORDER }, 0), null);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Square', rect: [0, 0, 10], color: [0, 0, 0] }, 0), null);
});

test('importedEntry は 2 点の PolyLine を直線か矢印として向きのまま拾う', () => {
  const line = imp.importedEntry({ id: '24R', subtype: 'PolyLine', rect: [99, 299, 481, 331], color: [41, 153, 76], borderStyle: { ...BORDER, width: 2 }, vertices: new Float32Array([100, 330, 480, 300]), lineEndings: ['None', 'None'] }, 0);
  assert.deepEqual(line, {
    ref: '24R', src: 0, kind: 'line', color: '#29994c', opacity: 1, lineWidth: 2,
    rect: [99, 299, 481, 331], quads: [[99, 331, 481, 331, 99, 299, 481, 299]], paths: [[[100, 330], [480, 300]]],
  });
  const arrow = imp.importedEntry({ id: '22R', subtype: 'PolyLine', rect: [80.5, 280.5, 499.5, 349.5], color: [217, 43, 43], borderStyle: BORDER, vertices: new Float32Array([480, 330, 100.4000015, 300]), lineEndings: ['None', 'OpenArrow'] }, 1);
  assert.equal(arrow.kind, 'arrow');
  assert.deepEqual(arrow.paths, [[[480, 330], [100.4, 300]]]);
  // 3 点以上、矢じりが始点、両端の矢じり、閉じた矢じりは拾わない（表示のみ）
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], vertices: [0, 0, 5, 5, 10, 0], lineEndings: ['None', 'None'] }, 0), null);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], vertices: [0, 0, 10, 10], lineEndings: ['OpenArrow', 'None'] }, 0), null);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], vertices: [0, 0, 10, 10], lineEndings: ['None', 'ClosedArrow'] }, 0), null);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'PolyLine', rect: [0, 0, 10, 10], color: [0, 0, 0], vertices: null, lineEndings: ['None', 'None'] }, 0), null);
  // Line（pdf.js が向きを落とす）と Polygon は拾わない
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Line', rect: [0, 0, 10, 10], color: [0, 0, 0], lineCoordinates: [0, 0, 10, 10], lineEndings: ['None', 'None'] }, 0), null);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Polygon', rect: [0, 0, 10, 10], color: [0, 0, 0], vertices: [0, 0, 10, 0, 10, 10] }, 0), null);
});

test('importedEntry は Ink を path ごとの点列で拾い、2 点未満の path は捨てる', () => {
  const ink = imp.importedEntry({ id: '20R', subtype: 'Ink', rect: [97.5, 347.5, 302.5, 412.5], color: [41, 112, 217], borderStyle: { ...BORDER, width: 5 }, inkLists: [new Float32Array([100, 380, 130, 410, 170, 360]), new Float32Array([1, 1]), new Float32Array([200.004, 400, 210, 390])], opacity: 1 }, 0);
  assert.deepEqual(ink, {
    ref: '20R', src: 0, kind: 'ink', color: '#2970d9', opacity: 1, lineWidth: 5,
    rect: [97.5, 347.5, 302.5, 412.5], quads: [[97.5, 412.5, 302.5, 412.5, 97.5, 347.5, 302.5, 347.5]],
    paths: [[[100, 380], [130, 410], [170, 360]], [[200, 400], [210, 390]]],
  });
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Ink', rect: [0, 0, 10, 10], color: [0, 0, 0], inkLists: [[1, 1]] }, 0), null);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Ink', rect: [0, 0, 10, 10], color: [0, 0, 0], inkLists: [] }, 0), null);
  assert.equal(imp.importedEntry({ id: '1R', subtype: 'Ink', rect: [0, 0, 10, 10], color: [0, 0, 0] }, 0), null);
});
