'use strict';

// フラット化のワーカー（spec-4-5 確定事項27〜33）。fixture と生成した文書だけを使う（.claude/CLAUDE.md 付則C）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef, PDFDict, PDFRawStream } = require('pdf-lib');
const { FLATTEN_PREFIX, flattenDocument } = require('../worker/op-flatten.js');
const { bakeMatrix } = require('../worker/flatten-geometry.js');
const { matrixText } = require('../worker/pdf-matrix.js');
const { runTask } = require('../worker/pdf-task.js');
const { fixturePath } = require('./fixtures/build.js');

const TOOLS = { PDFName };

async function load(bytes) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

async function roundTrip(doc) {
  return load(await doc.save({ addDefaultPage: false, useObjectStreams: false }));
}

function textOf(stream) {
  const filter = stream.dict.get(PDFName.of('Filter'));
  const bytes = filter?.encodedName === '/FlateDecode' ? zlib.inflateSync(Buffer.from(stream.contents)) : Buffer.from(stream.contents);
  return bytes.toString('latin1');
}

function annotsOf(doc, index) {
  const annots = doc.context.lookup(doc.getPage(index).node.get(PDFName.of('Annots')));
  return annots instanceof PDFArray ? annots.asArray().map((item) => doc.context.lookup(item)) : null;
}

function subtypesOf(doc, index) {
  return annotsOf(doc, index)?.map((dict) => dict.get(PDFName.of('Subtype')).encodedName.slice(1)) ?? null;
}

function lastContentOf(doc, index) {
  const contents = doc.context.lookup(doc.getPage(index).node.get(PDFName.of('Contents')));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return textOf(doc.context.lookup(refs[refs.length - 1]));
}

function xobjectOf(doc, index, name) {
  const dict = doc.getPage(index).node.Resources().lookup(PDFName.of('XObject'));
  return dict instanceof PDFDict ? dict.get(PDFName.of(name)) : undefined;
}

function form(doc, content, bbox, extra = {}) {
  return doc.context.register(doc.context.stream(content, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: bbox, ...extra }));
}

test('annotated.pdf: ノート 2 件とスタンプを焼き、外観の無い直線とテキスト・リンクは残し、Popup を外す', async () => {
  const doc = await load(fs.readFileSync(fixturePath('annotated.pdf')));
  const result = flattenDocument(doc, TOOLS);
  assert.deepEqual(result, {
    ok: true, baked: 3, kept: 3, notes: 2,
    bake: { markup: 0, text: 0, shape: 0, note: 2, other: 1 },
    keep: { functional: 1, noAppearance: 2, hidden: 0 },
  });
  const saved = await roundTrip(doc);
  assert.deepEqual(subtypesOf(saved, 0), ['Line', 'FreeText', 'Link']);
  assert.equal(saved.getPage(1).node.get(PDFName.of('Annots')), undefined);
  // 1 ページ目は描き起こしたノートとスタンプ、2 ページ目はノートを、注釈の並び順に焼く。
  const lines = lastContentOf(saved, 0).split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], new RegExp(`^q [-\\d. ]+ cm /${FLATTEN_PREFIX}1 Do Q$`));
  assert.match(lines[1], new RegExp(`^q [-\\d. ]+ cm /${FLATTEN_PREFIX}2 Do Q$`));
  assert.match(lastContentOf(saved, 1), new RegExp(`^q [-\\d. ]+ cm /${FLATTEN_PREFIX}1 Do Q$`));
  // 焼いた外観の実体は生きている（ページの Resources から引ける Form XObject）。
  for (const [index, name] of [[0, `${FLATTEN_PREFIX}1`], [0, `${FLATTEN_PREFIX}2`], [1, `${FLATTEN_PREFIX}1`]]) {
    const stream = saved.context.lookup(xobjectOf(saved, index, name));
    assert.ok(stream instanceof PDFRawStream, `${index} ${name}`);
    assert.equal(stream.dict.get(PDFName.of('Subtype')).encodedName, '/Form');
  }
});

test('焼いたノートの本文・作成者・Popup はファイルのどこにも残らない', async () => {
  const bytes = fs.readFileSync(fixturePath('annotated.pdf'));
  const hexes = ['他のツールのノート\n2行目', 'p2 のノート', 'other'].map((text) => PDFHexString.fromText(text).toString());
  const before = bytes.toString('latin1');
  hexes.forEach((hex) => assert.ok(before.includes(hex), hex));
  const doc = await load(bytes);
  flattenDocument(doc, TOOLS);
  const after = Buffer.from(await doc.save({ addDefaultPage: false, useObjectStreams: false })).toString('latin1');
  hexes.forEach((hex) => assert.ok(!after.includes(hex), hex));
  assert.ok(!after.includes('/Subtype /Popup'));
});

test('dryRun は数えるだけで文書を変えない（画面の件数と焼く件数が同じ判定を通る）', async () => {
  const doc = await load(fs.readFileSync(fixturePath('annotated.pdf')));
  const contentsBefore = String(doc.getPage(0).node.get(PDFName.of('Contents')));
  const preview = flattenDocument(doc, TOOLS, { dryRun: true });
  assert.equal(preview.baked, 3);
  // 1 ページ目の注釈はノート・Popup・直線・テキスト・スタンプ・リンクの 6 つのまま。
  assert.equal(annotsOf(doc, 0).length, 6);
  assert.equal(String(doc.getPage(0).node.get(PDFName.of('Contents'))), contentsBefore);
  assert.deepEqual(flattenDocument(doc, TOOLS), preview);
});

// 焼く・残すの境目を 1 ページに集めた文書。
async function edgeCases() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const annots = doc.context.obj([]);
  page.node.set(PDFName.of('Annots'), annots);
  const refs = {};
  const add = (key, fields, { direct = false } = {}) => {
    const dict = doc.context.obj({ Type: 'Annot', P: page.ref, ...fields });
    if (direct) {
      annots.push(dict);
      return;
    }
    refs[key] = doc.context.register(dict);
    annots.push(refs[key]);
  };
  refs.matrixForm = form(doc, '0 0 1 rg 0 0 100 50 re f', [0, 0, 100, 50], { Matrix: [0, 1, -1, 0, 0, 0] });
  add('matrix', { Subtype: 'Square', Rect: [100, 600, 150, 700], F: 4, AP: { N: refs.matrixForm } });
  refs.on = form(doc, '0.2 0.7 0.3 rg 0 0 60 60 re f', [0, 0, 60, 60]);
  refs.off = form(doc, '0.6 0.6 0.6 rg 0 0 60 60 re f', [0, 0, 60, 60]);
  add('states', { Subtype: 'Square', Rect: [200, 600, 260, 660], F: 4, AS: 'On', AP: { N: { On: refs.on, Off: refs.off } } });
  add('hidden', { Subtype: 'Square', Rect: [300, 600, 360, 660], F: 2, AP: { N: form(doc, '1 0 0 rg 0 0 60 60 re f', [0, 0, 60, 60]) } });
  add('noView', { Subtype: 'Square', Rect: [380, 600, 440, 660], F: 32 | 4, AP: { N: form(doc, '0 0 1 rg 0 0 60 60 re f', [0, 0, 60, 60]) } });
  // /Subtype の無い外観（ビューアは Form として描く）。焼くときに /Form を足す。
  refs.bare = doc.context.register(doc.context.stream('1 0.5 0 rg 0 0 60 60 re f', { BBox: [0, 0, 60, 60] }));
  add('noPrint', { Subtype: 'Square', Rect: [460, 600, 520, 660], AP: { N: refs.bare } });
  add('direct', { Subtype: 'Square', Rect: [100, 450, 160, 510], F: 4, AP: { N: form(doc, '0.5 0 0.5 rg 0 0 60 60 re f', [0, 0, 60, 60]) } }, { direct: true });
  add('widget', { Subtype: 'Widget', Rect: [300, 450, 400, 480], F: 4, FT: 'Tx', T: PDFString.of('field1'), AP: { N: form(doc, '0.6 0.4 0.2 rg 0 0 100 30 re f', [0, 0, 100, 30]) } });
  add('link', { Subtype: 'Link', Rect: [420, 450, 520, 480], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of('https://example.invalid/') } });
  add('redact', { Subtype: 'Redact', Rect: [100, 300, 200, 330], AP: { N: form(doc, '0 0 0 rg 0 0 100 30 re f', [0, 0, 100, 30]) } });
  add('line', { Subtype: 'Line', Rect: [300, 300, 500, 360], L: [300, 300, 500, 360], C: [1, 0, 0] });
  add('note', { Subtype: 'Text', Rect: [60, 200, 80, 220], F: 28, C: [0.55, 0.9, 0.6], Contents: PDFHexString.fromText('描き起こすノート') });
  // 非表示のノートと、その Popup（親を残すので Popup も残す）。
  add('hiddenNote', { Subtype: 'Text', Rect: [500, 200, 520, 220], F: 2 | 28, Contents: PDFHexString.fromText('残すノート') });
  add('hiddenPopup', { Subtype: 'Popup', Rect: [522, 120, 700, 220], Parent: refs.hiddenNote, F: 28 });
  doc.context.lookup(refs.hiddenNote).set(PDFName.of('Popup'), refs.hiddenPopup);
  return { doc: await roundTrip(doc), refs };
}

test('境目: /Matrix・/AS・印刷の指定の無いもの・直に並ぶ辞書は焼き、非表示・働きを持つ注釈・外観の無い直線は残す', async () => {
  const { doc, refs } = await edgeCases();
  const result = flattenDocument(doc, TOOLS);
  assert.deepEqual(result, {
    ok: true, baked: 5, kept: 7, notes: 1,
    bake: { markup: 0, text: 0, shape: 4, note: 1, other: 0 },
    keep: { functional: 3, noAppearance: 1, hidden: 3 },
  });
  const saved = await roundTrip(doc);
  assert.deepEqual(subtypesOf(saved, 0), ['Square', 'Square', 'Widget', 'Link', 'Redact', 'Line', 'Text', 'Popup']);
  const lines = lastContentOf(saved, 0).split('\n');
  assert.equal(lines.length, 5);
  // /AS の On の外観を焼き、Off は焼かない。
  assert.equal(xobjectOf(saved, 0, `${FLATTEN_PREFIX}2`).objectNumber, refs.on.objectNumber);
  // /Matrix 付きの外観は 12.5.5 の A で /Rect に合わせる。
  const a = bakeMatrix({ bbox: [0, 0, 100, 50], matrix: [0, 1, -1, 0, 0, 0], rect: [100, 600, 150, 700] });
  assert.equal(lines[0], `q ${matrixText(a)} cm /${FLATTEN_PREFIX}1 Do Q`);
  // /Subtype の無かった外観には /Form を足した。
  assert.equal(saved.context.lookup(refs.bare).dict.get(PDFName.of('Subtype')).encodedName, '/Form');
  // 外観の無いノートは本アプリの付箋（ノートの色）で描き起こす。
  const drawn = saved.context.lookup(xobjectOf(saved, 0, `${FLATTEN_PREFIX}5`));
  assert.match(textOf(drawn), /0\.55 0\.9 0\.6 rg/);
});

test('/Rotate 90 のページのノートは /Rect の左上を軸に回して焼く（表示で上向き）', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  page.setRotation({ type: 'degrees', angle: 90 });
  const note = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [100, 700, 120, 720], F: 28, P: page.ref,
    AP: { N: form(doc, '1 1 0 rg 100 700 20 20 re f', [100, 700, 120, 720]) },
  }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([note]));
  const loaded = await roundTrip(doc);
  flattenDocument(loaded, TOOLS);
  const expected = bakeMatrix({ bbox: [100, 700, 120, 720], rect: [100, 700, 120, 720], rotate: 90, noRotate: true });
  assert.equal(lastContentOf(await roundTrip(loaded), 0), `q ${matrixText(expected)} cm /${FLATTEN_PREFIX}1 Do Q`);
});

test('ページに同じ名前があれば、空いている名前を使う', async () => {
  const doc = await load(fs.readFileSync(fixturePath('annotated.pdf')));
  const taken = form(doc, '0 0 m', [0, 0, 1, 1]);
  doc.getPage(1).node.normalizedEntries().XObject.set(PDFName.of(`${FLATTEN_PREFIX}1`), taken);
  flattenDocument(doc, TOOLS);
  const saved = await roundTrip(doc);
  assert.equal(xobjectOf(saved, 1, `${FLATTEN_PREFIX}1`).objectNumber, taken.objectNumber);
  assert.match(lastContentOf(saved, 1), new RegExp(`/${FLATTEN_PREFIX}2 Do Q$`));
});

test('注釈の無い文書は 0 件で、何も変えない', async () => {
  // three-pages.pdf の各ページには生成時に pdf-lib が付けた空の /Annots がある。
  const doc = await load(fs.readFileSync(fixturePath('three-pages.pdf')));
  const before = doc.getPages().map((page) => [String(page.node.get(PDFName.of('Annots'))), String(page.node.get(PDFName.of('Contents')))]);
  const result = flattenDocument(doc, TOOLS);
  assert.equal(result.baked, 0);
  assert.equal(result.kept, 0);
  assert.deepEqual(doc.getPages().map((page) => [String(page.node.get(PDFName.of('Annots'))), String(page.node.get(PDFName.of('Contents')))]), before);
});

test('runTask の kind: flatten で焼いて書き、元のファイルは変わらない。flatten-preview は同じ件数を返し、書かない', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-flatten-'));
  try {
    const source = path.join(dir, 'in.pdf');
    const target = path.join(dir, 'out.pdf');
    fs.copyFileSync(fixturePath('annotated.pdf'), source);
    const before = fs.readFileSync(source);
    const preview = await runTask({ kind: 'flatten-preview', source });
    assert.equal(preview.ok, true, preview.error);
    assert.equal(fs.existsSync(target), false);
    const phases = [];
    const result = await runTask({ kind: 'flatten', source, target }, { send: (message) => phases.push(message.phase) });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual([...new Set(phases)], ['read', 'load', 'apply', 'save', 'write']);
    for (const key of ['baked', 'kept', 'notes', 'bake', 'keep'])
      assert.deepEqual(result[key], preview[key], key);
    assert.equal(result.baked, 3);
    assert.equal(result.path, target);
    assert.deepEqual(fs.readFileSync(source), before);
    assert.deepEqual(subtypesOf(await load(fs.readFileSync(target)), 0), ['Line', 'FreeText', 'Link']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runTask の kind: flatten は焼くものが無ければ断って書かない。読めない元も断る', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-flatten-'));
  try {
    const target = path.join(dir, 'out.pdf');
    const none = await runTask({ kind: 'flatten', source: fixturePath('three-pages.pdf'), target });
    assert.equal(none.error, '焼き込める注釈がありません。');
    assert.equal(fs.existsSync(target), false);
    const broken = await runTask({ kind: 'flatten-preview', source: fixturePath('broken.pdf') });
    assert.equal(broken.error, 'この PDF は内容が壊れているため保存できません。');
    const missing = await runTask({ kind: 'flatten-preview', source: path.join(dir, 'none.pdf') });
    assert.equal(missing.error, '元のファイルが見つかりません。移動または削除された可能性があります。');
    assert.equal((await runTask({ kind: 'flatten-preview' })).error, '対象のファイルが決まっていません。');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
