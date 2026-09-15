'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/markup-quads.js');
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
