'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/markup-quads.js');
require('../renderer/free-text-geometry.js');
require('../renderer/note-graphics.js');
require('../renderer/imported-values.js');
require('../renderer/shape-style.js');
require('../renderer/imported-shape.js');
require('../renderer/imported-entry.js');
require('../renderer/annotation-box-details.js');
require('../renderer/annotation-details.js');
require('../renderer/annotation-import.js');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// ファイルにある注釈を集める層（spec-4-1 確定事項17・18、spec-4-4 確定事項20、spec-4b-1a 確定事項25〜30）。
// 前半は偽の文書と偽の viewer・annotationAPI で流れを見て、後半は足場で「続けて開いても前のタブへ届く」を見る。

const imp = globalThis.SigK.annotationImport;
const FILE = { path: 'a.pdf', size: 2048, mtimeMs: 1 };
const QUAD = [1, 8, 9, 8, 1, 2, 9, 2];

function makeDoc(pages) {
  const storage = new Map();
  return {
    numPages: pages.length,
    annotationStorage: { setValue: (key, value) => storage.set(key, value) },
    storage,
    getPage: async (number) => ({ getAnnotations: async () => pages[number - 1] }),
  };
}

// 偽の viewer（届いたものを控える）と、偽の口（届いた spec を控え、answer を返す）を据える。
function stubs(t, { answer = { ok: true, details: {} }, available = true } = {}) {
  const delivered = [];
  const requests = [];
  globalThis.SigK.viewer = { deliverImported: (doc, imported, options) => delivered.push({ doc, imported, options }) };
  globalThis.annotationAPI = {
    available,
    readDetails: async (spec) => {
      requests.push(spec);
      return typeof answer === 'function' ? answer(spec) : answer;
    },
  };
  t.after(() => {
    delete globalThis.SigK.viewer;
    delete globalThis.annotationAPI;
  });
  return { delivered, requests };
}

const square = (id, extra = {}) => ({ id, subtype: 'Square', rect: [10, 10, 60, 40], color: [255, 0, 0], borderStyle: { width: 2, rawWidth: 2, style: 1 }, ...extra });
const line = (id) => ({ id, subtype: 'PolyLine', rect: [9, 9, 61, 41], vertices: [10, 10, 60, 40], lineEndings: ['None', 'None'], color: [0, 0, 255], borderStyle: { width: 2, rawWidth: 2, style: 1 } });
const note = (id) => ({ id, subtype: 'Text', rect: [60, 760, 80, 780], color: [255, 227, 89], contentsObj: { str: 'n' }, titleObj: { str: '' } });

test('importDocument は全ページから集め、印を付けて viewer へ届ける。口の要る書き込みが無ければ口を呼ばない', async (t) => {
  const { delivered, requests } = stubs(t);
  const doc = makeDoc([
    [],
    [{ id: '5R', subtype: 'Highlight', quadPoints: QUAD, color: [255, 0, 0] }, { id: '6R', subtype: 'Link' }],
    [{ id: '7R', subtype: 'StrikeOut', quadPoints: QUAD, color: [0, 0, 255] }],
  ]);
  const imported = await imp.importDocument(doc, { file: FILE });
  assert.deepEqual(Object.keys(imported), ['1', '2']);
  assert.equal(imported[1][0].ref, '5R');
  assert.equal(imported[2][0].kind, 'strikeout');
  assert.deepEqual([...doc.storage.entries()], [['5R', { noView: true }], ['7R', { noView: true }]]);
  assert.equal(requests.length, 0, 'ハイライトと取り消し線は pdf.js が不透明度を返すので、口は要らない');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].doc, doc);
  assert.deepEqual(delivered[0].options, { rerender: [1, 2] });
});

test('importDocument は文書が閉じられていたら捨て、文書が無ければ null', async (t) => {
  const { delivered } = stubs(t);
  const doc = makeDoc([[{ id: '5R', subtype: 'Highlight', quadPoints: QUAD, color: [255, 0, 0] }]]);
  assert.equal(await imp.importDocument(doc, { file: FILE, isAlive: () => false }), null);
  assert.equal(delivered.length, 0);
  assert.equal(doc.storage.size, 0);
  assert.equal(await imp.importDocument(null), null);
});

test('importDocument は getAnnotations が投げても止まらない', async (t) => {
  stubs(t);
  const doc = {
    numPages: 2,
    annotationStorage: { setValue: () => {} },
    getPage: async (number) => ({ getAnnotations: async () => { if (number === 1) throw new Error('壊れている'); return [{ id: '9R', subtype: 'Underline', quadPoints: QUAD, color: [0, 0, 0] }]; } }),
  };
  const imported = await imp.importDocument(doc, { file: FILE });
  assert.deepEqual(Object.keys(imported), ['1']);
});

test('importDocument はノートに noView を付け、表示のみには付けない', async (t) => {
  const { delivered } = stubs(t);
  const doc = makeDoc([[
    note('12R'),
    { id: '13R', subtype: 'Popup', rect: [90, 680, 270, 780], parentRect: [60, 760, 80, 780] },
    { id: '17R', subtype: 'Line', rect: [298, 698, 502, 762], color: [255, 0, 0], contentsObj: { str: '' } },
  ]]);
  const imported = await imp.importDocument(doc, { file: FILE });
  assert.deepEqual(imported[0].map((entry) => [entry.ref, entry.kind, entry.readonly === true]), [['12R', 'note', false], ['17R', 'other', true]]);
  assert.deepEqual([...doc.storage.entries()], [['12R', { noView: true }]]);
  assert.deepEqual(delivered[0].options, { rerender: [0] });
});

// ---- 読み戻しの口（spec-4b-1a 確定事項25〜28） ----

test('口に頼むのは四角・丸・直線・矢印・テキスト・ノートだけで、答えの不透明度を当ててから届ける', async (t) => {
  const answer = { ok: true, details: { '30R': { ca: 0.5 }, '12R': { ca: 0.25 } } };
  const { delivered, requests } = stubs(t, { answer });
  const doc = makeDoc([[square('30R'), { id: '5R', subtype: 'Highlight', quadPoints: QUAD, color: [255, 0, 0], opacity: 0.4 }, note('12R')]]);
  const imported = await imp.importDocument(doc, { file: FILE });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { source: 'a.pdf', expect: { size: 2048, mtimeMs: 1 }, refs: ['30R', '12R'] });
  assert.deepEqual(imported[0].map((entry) => [entry.ref, entry.opacity]), [['30R', 0.5], ['5R', 0.4], ['12R', 0.25]]);
  assert.equal(delivered[0].imported, imported);
});

// spec-4b-1a では塗り・雲形・/RD の四角と丸を表示のみにしていた。spec-4b-1b から直せる形で当て、pdf.js には描かせない
// （確定事項36〜38）。描けないもの（崩れた /RD）と、線も塗りも無いものは表示のみのまま。
test('塗り・雲形・/RD の四角と丸は直せる形で当て、描けないものと線も塗りも無いものは表示のみにする', async (t) => {
  const answer = { ok: true, details: {
    '30R': { ca: 1, interior: [1, 1, 0] },
    '31R': { cloudy: true, cloudIntensity: 2 },
    '32R': { rectDifference: [5, 5, 5, 5] },
    '33R': { ca: 0.5, rectDifference: [0, 0, 0, 0] },
    '34R': { rectDifference: [30, 0, 30, 0] },
    '35R': { interior: null },
  } };
  stubs(t, { answer });
  const doc = makeDoc([[square('30R'), square('31R', { subtype: 'Circle' }), square('32R'), square('33R'), square('34R'), square('35R', { color: null })]]);
  const imported = await imp.importDocument(doc, { file: FILE });
  assert.deepEqual(imported[0].map((entry) => [entry.ref, entry.readonly === true]),
    [['30R', false], ['31R', false], ['32R', false], ['33R', false], ['34R', true], ['35R', true]]);
  assert.equal(imported[0][0].fill, '#ffff00');
  assert.deepEqual([imported[0][1].lineStyle, imported[0][1].cloudIntensity], ['cloudy', 2]);
  assert.deepEqual(imported[0][2].rect, [15, 15, 55, 35]);
  assert.equal(imported[0][3].opacity, 0.5);
  assert.deepEqual([...doc.storage.keys()], ['30R', '31R', '32R', '33R'], 'noView は直せるものにだけ付ける');
});

// 口が使えなくても、線も塗りも無いもの（/C の無い四角）は表示のみにそろえる（塗りが分からないまま直せる形にしない）。
test('口が答えなければ、四角・丸は線の有無によらず表示のみにする（spec-4b-2 確定事項36）', async (t) => {
  stubs(t, { answer: { ok: false, reason: 'timeout' } });
  const doc = makeDoc([[square('30R', { color: null }), square('31R'), square('32R', { subtype: 'Circle' }), note('33R')]]);
  const imported = await imp.importDocument(doc, { file: FILE });
  assert.deepEqual(imported[0].map((entry) => [entry.ref, entry.readonly === true]), [['30R', true], ['31R', true], ['32R', true], ['33R', false]]);
  assert.deepEqual([...doc.storage.keys()], ['33R'], '表示のみの四角・丸は pdf.js が描き続ける');
});

test('口が使えない・断られたときは、四角・丸は表示のみ、ほかは pdf.js の値のまま読む', async (t) => {
  const refused = stubs(t, { answer: { ok: false, reason: 'changed' } });
  const pages = () => [[square('30R'), line('40R')]];
  const imported = await imp.importDocument(makeDoc(pages()), { file: FILE });
  assert.equal(refused.requests.length, 1);
  assert.equal(imported[0][0].readonly, true);
  assert.equal(imported[0][1].opacity, 1);
  assert.equal(imported[0][1].readonly, undefined);

  // 口が無い（古い preload）・ファイルの控えが無い文書では、呼ばずに読む。
  globalThis.annotationAPI.available = false;
  const unavailable = (await imp.importDocument(makeDoc(pages()), { file: FILE }))[0];
  assert.deepEqual(unavailable.map((entry) => entry.readonly === true), [true, false]);
  globalThis.annotationAPI.available = true;
  const noFile = (await imp.importDocument(makeDoc(pages()), { file: null }))[0];
  assert.deepEqual(noFile.map((entry) => entry.readonly === true), [true, false]);
  assert.equal(refused.requests.length, 1, 'どちらも口を呼んでいない');
});

test('口を待つ間に文書が閉じられたら捨て、settled は走っている読み込みの終わりを待つ', async (t) => {
  let release;
  const { delivered } = stubs(t, { answer: () => new Promise((resolve) => { release = () => resolve({ ok: true, details: { '30R': { ca: 0.5 } } }); }) });
  let alive = true;
  const doc = makeDoc([[square('30R')]]);
  const job = imp.importDocument(doc, { file: FILE, isAlive: () => alive });
  let settled = false;
  imp.settled().then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, '口の答えを待っている');
  alive = false;
  release();
  assert.equal(await job, null);
  await imp.settled();
  assert.equal(settled, true);
  assert.equal(delivered.length, 0);
  assert.equal(doc.storage.size, 0);
});

// ---- 続けて開いたとき（spec-4b-1a 確定事項29。事前調査 B） ----

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

test('口を待つ間に次のファイルを開いても、前のタブの書き込みは捨てずにそのタブへ届く', async (t) => {
  let releaseA;
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: { 0: [square('30R')] } }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }), [B]: makeSource({ path: B, name: 'b.pdf' }) },
    // a.pdf の口の答えだけ遅らせる。b.pdf は既定の答え（読めたが足す欄が無い）。
    detailsResults: [() => new Promise((resolve) => { releaseA = () => resolve({ ok: true, details: { '30R': { ca: 0.5 } } }); })],
  });
  t.after(() => shell.cleanup());
  const { SigK } = shell;
  await SigK.tabs.openPath(A);
  await shell.flush();
  const tabA = SigK.tabs.activeId();
  assert.equal(shell.detailsCalls.length, 1, 'a.pdf の口を呼んで待っている');
  assert.deepEqual(Object.keys(SigK.viewer.getImported()), [], 'まだ映っていない');

  await SigK.tabs.openPath(B);
  await shell.flush();
  releaseA();
  await SigK.annotationImport.settled();
  // b.pdf は既定の答えで読めている。
  assert.equal(SigK.viewer.getImported()[0][0].opacity, 1);

  SigK.tabs.activate(tabA);
  await shell.flush();
  const entries = SigK.viewer.getImported()[0] ?? [];
  assert.equal(entries.length, 1, 'a.pdf の書き込みが a.pdf のタブに届いている');
  assert.equal(entries[0].opacity, 0.5);
});
