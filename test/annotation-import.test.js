'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/markup-quads.js');
require('../renderer/free-text-geometry.js');
require('../renderer/note-graphics.js');
require('../renderer/imported-entry.js');
require('../renderer/annotation-import.js');

// ファイルにあるテキストマークアップを集める層（spec-4-1 確定事項17・18、spec-4-4 確定事項20）。

const imp = globalThis.SigK.annotationImport;

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

test('importDocument はノートに noView を付け、表示のみには付けない', async () => {
  const set = [];
  const doc = {
    numPages: 1,
    annotationStorage: { setValue: (id, value) => set.push([id, value]) },
    getPage: async () => ({
      getAnnotations: async () => [
        { id: '12R', subtype: 'Text', rect: [60, 760, 80, 780], color: [255, 227, 89], contentsObj: { str: 'n' }, titleObj: { str: '' } },
        { id: '13R', subtype: 'Popup', rect: [90, 680, 270, 780], parentRect: [60, 760, 80, 780] },
        { id: '17R', subtype: 'Line', rect: [298, 698, 502, 762], color: [255, 0, 0], contentsObj: { str: '' } },
      ],
    }),
  };
  const received = [];
  globalThis.SigK.viewer = { setImported: (imported, options) => received.push([imported, options]) };
  try {
    const imported = await imp.importDocument(doc);
    assert.deepEqual(imported[0].map((entry) => [entry.ref, entry.kind, entry.readonly === true]), [['12R', 'note', false], ['17R', 'other', true]]);
    assert.deepEqual(set, [['12R', { noView: true }]]);
    assert.deepEqual(received[0][1], { rerender: [0] });
  } finally {
    delete globalThis.SigK.viewer;
  }
});
