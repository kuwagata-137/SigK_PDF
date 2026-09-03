'use strict';

// 分割の層のテスト（spec-2-2 確定事項24〜26・33〜36）。
//
// 結合（op-merge.test.js）と同じく新規文書へ複製するので、しおりが消えることも
// 仕様として固定する。fixture だけを使う（.claude/CLAUDE.md 付則C）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument, PDFName, PDFHexString, PDFString } = require('pdf-lib');
const { splitDocument } = require('../worker/op-split.js');
const { readLabels, writeLabels } = require('../worker/op-page-labels.js');
const { runSplit, runTask } = require('../worker/pdf-task.js');
const { tempPathFor } = require('../pdf-write.js');
const { fixturePath } = require('./fixtures/build.js');

const TOOLS = { PDFDocument, PDFName, PDFHexString };

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-split-'));
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

// onPart で受けた文書を溜めて返す。
async function collect(source, parts, options = {}) {
  const docs = [];
  const result = await splitDocument(source, parts, TOOLS, { ...options, onPart: async (_index, doc) => { docs.push(await roundTrip(doc)); } });
  return { result, docs };
}

// ---- splitDocument ----

test('part ごとに新しい文書ができ、ページは書いた順に並ぶ', async () => {
  const source = await makeDoc(5);
  const { result, docs } = await collect(source, [[0, 1], [4, 2]]);
  assert.deepEqual(result, { ok: true, written: 2, pages: [2, 2], labeled: false });
  assert.deepEqual(docs.map((doc) => doc.getPages().map((page) => page.getWidth())), [[200, 201], [204, 202]]);
  assert.equal(source.getPageCount(), 5, '元は変えない');
});

test('/Rotate は複製に付いてくる', async () => {
  const source = await makeDoc(3, { rotate: { 1: 90, 2: 270 } });
  const { docs } = await collect(source, [[0], [1, 2]]);
  assert.deepEqual(docs.map((doc) => doc.getPages().map((page) => page.getRotation().angle)), [[0], [90, 270]]);
});

test('ページラベルは part に入るぶんだけ引き継ぐ。元に無ければ書かない', async () => {
  const labelled = await makeDoc(4);
  writeLabels(labelled, ['i', 'ii', 'iii', 'iv'], TOOLS);
  const { result, docs } = await collect(labelled, [[0, 1], [3]]);
  assert.equal(result.labeled, true);
  assert.deepEqual(docs.map((doc) => readLabels(doc)), [['i', 'ii'], ['iv']]);

  const plain = await collect(await makeDoc(2), [[0], [1]]);
  assert.equal(plain.result.labeled, false);
  assert.deepEqual(plain.docs.map((doc) => readLabels(doc)), [null, null]);
});

test('入力欄の抜け殻と内部リンクは落とし、しおりは付いてこない', async () => {
  const source = await makeDoc(1);
  const page = source.getPage(0);
  const ctx = source.context;
  const widget = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 10, 10] }));
  const uri = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10],
    A: ctx.obj({ S: 'URI', URI: PDFString.of('https://example.com/') }),
  }));
  page.node.set(PDFName.of('Annots'), ctx.obj([widget, uri]));
  source.catalog.set(PDFName.of('Outlines'), ctx.register(ctx.obj({ Type: 'Outlines', Count: 0 })));

  const { docs } = await collect(source, [[0]]);
  const annots = docs[0].context.lookup(docs[0].getPage(0).node.get(PDFName.of('Annots')));
  assert.equal(annots.asArray().length, 1);
  assert.equal(docs[0].catalog.get(PDFName.of('Outlines')), undefined);
});

test('複製し終えるごとに進捗が来る', async () => {
  const seen = [];
  await splitDocument(await makeDoc(3), [[0], [1], [2]], TOOLS, { onProgress: (done, total) => seen.push([done, total]) });
  assert.deepEqual(seen, [[1, 3], [2, 3], [3, 3]]);
});

test('空の part・範囲外・parts が無いときは断る', async () => {
  const source = await makeDoc(2);
  assert.equal((await splitDocument(source, [], TOOLS)).error, '分割するページがありません。');
  assert.equal((await splitDocument(source, [[0], []], TOOLS)).error, '分割するページがありません。');
  assert.equal(typeof (await splitDocument(source, [[0, 5]], TOOLS)).error, 'string');
  assert.equal(typeof (await splitDocument(source, null, TOOLS)).error, 'string');
});

test('onPart が失敗を返したら、そこで止めて何本書けたかを返す', async () => {
  const source = await makeDoc(3);
  let count = 0;
  const result = await splitDocument(source, [[0], [1], [2]], TOOLS, {
    onPart: async () => {
      count += 1;
      return count === 2 ? { error: '書けません' } : { ok: true };
    },
  });
  assert.deepEqual(result, { error: '書けません', written: 1 });
});

// ---- runSplit / runTask（ファイルとして通す） ----

test('分割は本数ぶんのファイルになり、入力は無傷である', async () => {
  const ws = workspace();
  try {
    const seeded = await PDFDocument.load(fs.readFileSync(fixturePath('rotated.pdf')), { updateMetadata: false });
    writeLabels(seeded, Array.from({ length: seeded.getPageCount() }, (_value, index) => `L${index + 1}`), TOOLS);
    const source = await ws.write('src.pdf', seeded);
    const before = fs.readFileSync(source);
    const targets = [ws.file('src_001.pdf'), ws.file('src_002.pdf')];

    const result = await runSplit({
      kind: 'split',
      source,
      parts: [{ pages: [0], target: targets[0] }, { pages: [1, 2], target: targets[1] }],
      targets,
    });
    assert.equal(result.ok, true);
    assert.equal(result.written, 2);
    assert.deepEqual(result.targets, targets);
    assert.deepEqual(result.pages, [1, 2]);

    const first = await PDFDocument.load(fs.readFileSync(targets[0]), { updateMetadata: false });
    const second = await PDFDocument.load(fs.readFileSync(targets[1]), { updateMetadata: false });
    assert.equal(first.getPageCount(), 1);
    assert.equal(second.getPageCount(), 2);
    assert.equal(second.getPage(0).getRotation().angle, 90, 'rotated.pdf の2ページ目');
    assert.deepEqual(readLabels(second), ['L2', 'L3']);
    assert.deepEqual(fs.readFileSync(source), before);
    assert.equal(fs.existsSync(`${source}.bak`), false, '退避は作らない');
  } finally { ws.cleanup(); }
});

test('進捗は write が本数で刻まれる', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const targets = [ws.file('a.pdf'), ws.file('b.pdf'), ws.file('c.pdf')];
    const seen = [];
    const result = await runTask(
      { kind: 'split', source, parts: targets.map((target, index) => ({ pages: [index], target })), targets },
      { send: (message) => seen.push([message.phase, message.done, message.total]) },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(seen, [
      ['read', undefined, undefined],
      ['load', undefined, undefined],
      ['apply', undefined, undefined],
      ['save', undefined, undefined],
      ['write', 0, 3], ['write', 1, 3], ['write', 2, 3], ['write', 3, 3],
    ]);
  } finally { ws.cleanup(); }
});

test('壊れた入力・暗号化 PDF は書く前に止め、何も残さない', async () => {
  const ws = workspace();
  try {
    const target = ws.file('out_001.pdf');
    const broken = await runSplit({ source: ws.copyIn('broken.pdf'), parts: [{ pages: [0], target }], targets: [target] });
    assert.equal(broken.error, 'この PDF は内容が壊れているため保存できません。');
    const locked = await runSplit({ source: ws.copyIn('encrypted.pdf'), parts: [{ pages: [0], target }], targets: [target] });
    assert.equal(locked.error, 'パスワードで保護された PDF は保存できません。');
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(tempPathFor(target)), false);
  } finally { ws.cleanup(); }
});

test('途中の書き出しに失敗したら、そこで止めて書き終えた分は残す', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const ok = ws.file('a.pdf');
    // 2本目の出力先をフォルダーにして、rename を失敗させる。
    const blocked = ws.file('b.pdf');
    fs.mkdirSync(blocked);
    const never = ws.file('c.pdf');
    const result = await runSplit({
      source,
      parts: [{ pages: [0], target: ok }, { pages: [1], target: blocked }, { pages: [2], target: never }],
      targets: [ok, blocked, never],
    });
    assert.equal(typeof result.error, 'string');
    assert.match(result.error, /2 \/ 3/);
    assert.equal(result.written, 1);
    assert.equal(fs.existsSync(ok), true, '書き終えた分は残す');
    assert.equal(fs.existsSync(never), false);
    assert.equal(fs.existsSync(tempPathFor(blocked)), false);
  } finally { ws.cleanup(); }
});

test('元が無い・parts が無い・出力先が無いときは何もしない', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('one-page.pdf');
    assert.equal(typeof (await runSplit({ source: ws.file('nothing.pdf'), parts: [{ pages: [0], target: ws.file('x.pdf') }] })).error, 'string');
    assert.equal(typeof (await runSplit({ source, parts: [] })).error, 'string');
    assert.equal(typeof (await runSplit({ source, parts: [{ pages: [0] }] })).error, 'string');
    assert.equal(typeof (await runSplit({ parts: [{ pages: [0], target: ws.file('x.pdf') }] })).error, 'string');
    assert.equal(fs.readdirSync(ws.dir).length, 1);
  } finally { ws.cleanup(); }
});
