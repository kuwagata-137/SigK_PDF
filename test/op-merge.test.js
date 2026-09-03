'use strict';

// 結合の層のテスト（spec-2-1 確定事項22・29〜34）。
//
// 抽出（op-extract.test.js）と同じく新規文書へ複製するので、しおりが消えることも
// 仕様として固定する。fixture だけを使う（.claude/CLAUDE.md 付則C）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument, PDFName, PDFHexString, PDFString } = require('pdf-lib');
const { resolvePages, mergeDocuments } = require('../worker/op-merge.js');
const { readLabels, writeLabels } = require('../worker/op-page-labels.js');
const { runMerge, runTask, describeLoadFailure } = require('../worker/pdf-task.js');
const { fixturePath } = require('./fixtures/build.js');

const TOOLS = { PDFDocument, PDFName, PDFHexString };

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-merge-'));
  return {
    dir,
    copyIn: (name, as = name) => {
      const to = path.join(dir, as);
      fs.copyFileSync(fixturePath(name), to);
      return to;
    },
    file: (name) => path.join(dir, name),
    write: async (name, doc) => {
      const to = path.join(dir, name);
      fs.writeFileSync(to, await doc.save({ addDefaultPage: false }));
      return to;
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

async function makeDoc(pageCount, { rotate = {} } = {}) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage([200 + index, 200]);
    if (rotate[index] !== undefined)
      page.setRotation({ type: 'degrees', angle: rotate[index] });
  }
  return doc;
}

async function roundTrip(doc) {
  return PDFDocument.load(await doc.save({ addDefaultPage: false }), { updateMetadata: false });
}

const entry = (doc, pages = null, name = 'x.pdf') => ({ name, pages, load: async () => doc });

// ---- resolvePages ----

test('resolvePages は null を全ページに広げ、範囲外を断る', () => {
  assert.deepEqual(resolvePages(null, 3), { pages: [0, 1, 2] });
  assert.deepEqual(resolvePages([2, 0], 3), { pages: [2, 0] });
  assert.equal(typeof resolvePages([3], 3).error, 'string');
  assert.equal(typeof resolvePages([-1], 3).error, 'string');
  assert.equal(typeof resolvePages('1', 3).error, 'string');
});

// ---- mergeDocuments ----

test('入力の順に、選んだページだけが並ぶ', async () => {
  const a = await makeDoc(3);
  const b = await makeDoc(2);
  const result = await mergeDocuments([entry(a, [2, 0]), entry(b)], TOOLS);
  assert.equal(result.ok, true);
  assert.equal(result.pages, 4);
  const out = await roundTrip(result.doc);
  // 幅で並びを見る（a は 200,201,202、b は 200,201）。
  assert.deepEqual(out.getPages().map((page) => page.getWidth()), [202, 200, 200, 201]);
});

test('/Rotate は複製に付いてくる', async () => {
  const a = await makeDoc(2, { rotate: { 1: 90 } });
  const b = await makeDoc(1, { rotate: { 0: 270 } });
  const out = await roundTrip((await mergeDocuments([entry(a), entry(b)], TOOLS)).doc);
  assert.deepEqual(out.getPages().map((page) => page.getRotation().angle), [0, 90, 270]);
});

test('同じページを2回書けば2回入り、同じ文書を2回入れても壊れない', async () => {
  const a = await makeDoc(2);
  const result = await mergeDocuments([entry(a, [1, 1]), entry(a)], TOOLS);
  assert.equal(result.pages, 4);
  const out = await roundTrip(result.doc);
  assert.deepEqual(out.getPages().map((page) => page.getWidth()), [201, 201, 200, 201]);
});

test('ページラベルは連結され、持たない入力のページは空になる', async () => {
  const a = await makeDoc(2);
  writeLabels(a, ['i', 'ii'], TOOLS);
  const b = await makeDoc(2);
  const result = await mergeDocuments([entry(b, [1]), entry(a, [1, 0])], TOOLS);
  assert.equal(result.labeled, true);
  assert.deepEqual(readLabels(await roundTrip(result.doc)), ['', 'ii', 'i']);
});

test('どの入力もラベルを持たなければ書かない', async () => {
  const result = await mergeDocuments([entry(await makeDoc(1)), entry(await makeDoc(1))], TOOLS);
  assert.equal(result.labeled, false);
  assert.equal(readLabels(await roundTrip(result.doc)), null);
});

test('入力欄の抜け殻と内部リンクは落とし、外部リンクは残す', async () => {
  const a = await makeDoc(1);
  const page = a.getPage(0);
  const ctx = a.context;
  const widget = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 10, 10] }));
  const goto = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], Dest: [page.ref, 'Fit'] }));
  const uri = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10],
    A: ctx.obj({ S: 'URI', URI: PDFString.of('https://example.com/') }),
  }));
  page.node.set(PDFName.of('Annots'), ctx.obj([widget, goto, uri]));

  const out = await roundTrip((await mergeDocuments([entry(a)], TOOLS)).doc);
  const annots = out.context.lookup(out.getPage(0).node.get(PDFName.of('Annots')));
  assert.equal(annots.asArray().length, 1);
  const kept = out.context.lookup(annots.asArray()[0]);
  assert.equal(out.context.lookup(kept.get(PDFName.of('A'))).get(PDFName.of('S')).asString(), '/URI');
});

test('しおりは付いてこない（仕様として固定）', async () => {
  const a = await PDFDocument.load(fs.readFileSync(fixturePath('three-pages.pdf')), { updateMetadata: false });
  const ctx = a.context;
  const outlines = ctx.register(ctx.obj({ Type: 'Outlines', Count: 0 }));
  a.catalog.set(PDFName.of('Outlines'), outlines);
  const out = await roundTrip((await mergeDocuments([entry(a)], TOOLS)).doc);
  assert.equal(out.catalog.get(PDFName.of('Outlines')), undefined);
});

test('0ページなら断る', async () => {
  const result = await mergeDocuments([entry(await makeDoc(2), [])], TOOLS);
  assert.equal(result.error, '結合するページがありません。');
  assert.deepEqual(await mergeDocuments([], TOOLS), { error: '結合するファイルがありません。' });
});

test('読めない入力はファイル名を添えて断り、範囲外の指定も断る', async () => {
  const broken = { name: 'b.pdf', pages: null, load: async () => { throw new Error('encrypted'); } };
  const result = await mergeDocuments([entry(await makeDoc(1)), broken], TOOLS, { describeLoadFailure });
  assert.equal(result.error, '「b.pdf」パスワードで保護された PDF は保存できません。');

  const outside = await mergeDocuments([entry(await makeDoc(1), [5], 'c.pdf')], TOOLS);
  assert.match(outside.error, /^「c\.pdf」/);
});

test('複製し終えるごとに進捗が来る', async () => {
  const seen = [];
  await mergeDocuments([entry(await makeDoc(1)), entry(await makeDoc(1))], TOOLS, {
    onProgress: (done, total) => seen.push([done, total]),
  });
  assert.deepEqual(seen, [[1, 2], [2, 2]]);
});

// ---- runMerge / runTask（ファイルとして通す） ----

test('結合はファイルとして書き出され、入力は無傷である', async () => {
  const ws = workspace();
  try {
    const a = ws.copyIn('rotated.pdf');
    const seeded = await PDFDocument.load(fs.readFileSync(fixturePath('three-pages.pdf')), { updateMetadata: false });
    writeLabels(seeded, ['i', 'ii', 'iii'], TOOLS);
    const b = await ws.write('labelled.pdf', seeded);
    const beforeA = fs.readFileSync(a);
    const beforeB = fs.readFileSync(b);
    const target = ws.file('out.pdf');

    const result = await runMerge({
      kind: 'merge',
      inputs: [{ path: a, pages: [1] }, { path: b, pages: [2, 0] }],
      target,
    });
    assert.equal(result.ok, true);
    assert.equal(result.pages, 3);
    assert.equal(result.inputs, 2);
    assert.equal(result.labeled, true);

    const out = await PDFDocument.load(fs.readFileSync(target), { updateMetadata: false });
    assert.equal(out.getPageCount(), 3);
    assert.equal(out.getPage(0).getRotation().angle, 90, 'rotated.pdf の2ページ目');
    assert.deepEqual(readLabels(out), ['', 'iii', 'i']);
    assert.deepEqual(fs.readFileSync(a), beforeA);
    assert.deepEqual(fs.readFileSync(b), beforeB);
    assert.equal(fs.existsSync(`${a}.bak`), false, '退避は作らない');
  } finally { ws.cleanup(); }
});

test('進捗は read と apply がファイル単位で刻まれる', async () => {
  const ws = workspace();
  try {
    const a = ws.copyIn('three-pages.pdf', 'a.pdf');
    const b = ws.copyIn('one-page.pdf', 'b.pdf');
    const seen = [];
    const result = await runTask(
      { kind: 'merge', inputs: [{ path: a }, { path: b }], target: ws.file('out.pdf') },
      { send: (message) => seen.push([message.phase, message.done, message.total]) },
    );
    assert.equal(result.ok, true);
    assert.equal(result.pages, 4);
    assert.deepEqual(seen, [
      ['read', 0, 2], ['read', 1, 2], ['read', 2, 2],
      ['load', undefined, undefined],
      ['apply', 0, 2], ['apply', 1, 2], ['apply', 2, 2],
      ['save', undefined, undefined],
      ['write', undefined, undefined],
    ]);
  } finally { ws.cleanup(); }
});

test('壊れた入力・暗号化 PDF はファイル名を添えて止め、途中まで書かない', async () => {
  const ws = workspace();
  try {
    const good = ws.copyIn('three-pages.pdf');
    const target = ws.file('out.pdf');
    const broken = await runMerge({ inputs: [{ path: good }, { path: ws.copyIn('broken.pdf') }], target });
    assert.equal(broken.error, '「broken.pdf」この PDF は内容が壊れているため保存できません。');
    const locked = await runMerge({ inputs: [{ path: ws.copyIn('encrypted.pdf') }], target });
    assert.equal(locked.error, '「encrypted.pdf」パスワードで保護された PDF は保存できません。');
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.readdirSync(ws.dir).filter((name) => name.includes('out')).length, 0, '一時ファイルも残らない');
  } finally { ws.cleanup(); }
});

test('入力が無い・場所が無い・保存先が無いときは何もしない', async () => {
  const ws = workspace();
  try {
    assert.equal(typeof (await runMerge({ inputs: [], target: ws.file('o.pdf') })).error, 'string');
    assert.equal(typeof (await runMerge({ inputs: [{ path: ws.copyIn('one-page.pdf') }] })).error, 'string');
    assert.equal(typeof (await runMerge({ inputs: [{}], target: ws.file('o.pdf') })).error, 'string');
    const gone = await runMerge({ inputs: [{ path: ws.file('nothing.pdf') }], target: ws.file('o.pdf') });
    assert.match(gone.error, /^「nothing\.pdf」/);
  } finally { ws.cleanup(); }
});
