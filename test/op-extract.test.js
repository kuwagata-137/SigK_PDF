'use strict';

// 抽出の層のテスト（spec-1-6 確定事項47〜52）。
//
// 抽出は「新規文書へ copyPages する」ので、保存（op-pages.js）とは失うものが違う。
// **しおり・名前付き宛先が消えることも仕様**（確定事項48。画面側で明記する）なので、
// 消えることをテストで固定する。黙って直したくなったときに気づけるようにするためである。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument, PDFName, PDFString, PDFHexString } = require('pdf-lib');
const { validateSelection, extractPages } = require('../worker/op-extract.js');
const { readLabels, writeLabels, rebuildLabels } = require('../worker/op-page-labels.js');
const { runSave } = require('../worker/pdf-task.js');
const { fixturePath } = require('./fixtures/build.js');

const TOOLS = { PDFName, PDFHexString };

async function makeDoc(pageCount) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1)
    doc.addPage([200, 200]);
  return doc;
}

// 保存して読み直す。抽出した文書が「ファイルとして」正しいかを見るため、
// 組み立て途中の状態ではなく往復後を確かめる。
async function roundTrip(doc) {
  const bytes = await doc.save({ addDefaultPage: false });
  return PDFDocument.load(bytes, { updateMetadata: false });
}

test('選んだページだけが plan の並びで入る', async () => {
  const source = await makeDoc(5);
  // 並びの証拠に回転を使う。元ページごとに違う角度を付けておく。
  source.getPages().forEach((page, index) => page.setRotation({ type: 'degrees', angle: index * 90 % 360 }));

  const result = await extractPages(source, [{ src: 3, rotate: 0 }, { src: 1, rotate: 0 }], { PDFDocument });
  assert.equal(result.ok, true);
  assert.equal(result.pages, 2);

  const out = await roundTrip(result.doc);
  assert.equal(out.getPageCount(), 2);
  assert.deepEqual(out.getPages().map((page) => page.getRotation().angle), [270, 90]);
});

test('plan の回転は複製したページの角度へ足される', async () => {
  const source = await makeDoc(2);
  source.getPage(1).setRotation({ type: 'degrees', angle: 90 });

  const result = await extractPages(source, [{ src: 1, rotate: 90 }, { src: 0, rotate: -90 }], { PDFDocument });
  const out = await roundTrip(result.doc);
  assert.deepEqual(out.getPages().map((page) => page.getRotation().angle), [180, 270]);
});

test('元の文書は変わらない', async () => {
  const source = await makeDoc(3);
  source.getPage(0).setRotation({ type: 'degrees', angle: 90 });

  await extractPages(source, [{ src: 0, rotate: 90 }], { PDFDocument });

  assert.equal(source.getPageCount(), 3, 'ページを取り上げてはいない');
  assert.equal(source.getPage(0).getRotation().angle, 90, '回転も触っていない');
});

test('選択が空なら断る', async () => {
  const source = await makeDoc(2);
  assert.match((await extractPages(source, [], { PDFDocument })).error, /選ばれていません/);
  assert.match((await extractPages(source, null, { PDFDocument })).error, /選ばれていません/);
});

test('元の文書に無いページは断る', async () => {
  const source = await makeDoc(2);
  assert.match((await extractPages(source, [{ src: 5 }], { PDFDocument })).error, /合いません/);
  assert.match((await extractPages(source, [{ src: -1 }], { PDFDocument })).error, /合いません/);
  assert.match((await extractPages(source, [{ rotate: 90 }], { PDFDocument })).error, /合いません/);
});

test('同じページを2回選んでも、回転は互いに影響しない', async () => {
  // op-pages.js が src の重複を弾くのは in-place で同じページ実体を2か所へ挿すため
  // である。複製はそれぞれ別の実体になるので（実測）、こちらでは弾かない。
  const source = await makeDoc(2);

  const result = await extractPages(source, [{ src: 0, rotate: 90 }, { src: 0, rotate: 180 }], { PDFDocument });
  const out = await roundTrip(result.doc);
  assert.deepEqual(out.getPages().map((page) => page.getRotation().angle), [90, 180]);
});

test('validateSelection は plan の形だけを見る', () => {
  assert.deepEqual(validateSelection([{ src: 0 }], 1), { ok: true });
  assert.equal(validateSelection([{ src: 0 }], 0).ok, undefined);
});

// 【注意】`worker/pdf-task.js` の applyForExtract を、ここで作った文書へ直に
// 当てることはできない。あちらは **vendor の pdf-lib**、ここは node_modules の
// pdf-lib で、`copyPages` が `srcDoc` の型を見て弾く。applyForExtract の結線は
// 末尾の通しのテスト（バイト列を渡すので realm をまたがない）で確かめる。
test('ページラベルは並びに合わせて引き継がれる', async () => {
  const source = await makeDoc(4);
  writeLabels(source, ['表紙', 'i', 'ii', '1'], TOOLS);
  const before = readLabels(source);

  const result = await extractPages(source, [{ src: 3, rotate: 0 }, { src: 0, rotate: 0 }], { PDFDocument });
  rebuildLabels(result.doc, [{ src: 3 }, { src: 0 }], before, TOOLS);

  assert.deepEqual(readLabels(await roundTrip(result.doc)), ['1', '表紙']);
});

test('ラベルを持たない文書には生やさない', async () => {
  const source = await makeDoc(3);

  const result = await extractPages(source, [{ src: 1, rotate: 0 }], { PDFDocument });
  rebuildLabels(result.doc, [{ src: 1 }], readLabels(source), TOOLS);

  assert.equal(readLabels(await roundTrip(result.doc)), null);
});

test('しおりと名前付き宛先は引き継がれない', async () => {
  // 消えることが仕様である（確定事項48）。画面側の確認ダイアログで明記する。
  const source = await makeDoc(3);
  const context = source.context;
  const item = context.obj({ Title: PDFString.of('2ページ目へ'), Dest: [source.getPage(1).ref, PDFName.of('Fit')] });
  const itemRef = context.register(item);
  source.catalog.set(PDFName.of('Outlines'),
    context.register(context.obj({ Type: PDFName.of('Outlines'), First: itemRef, Last: itemRef, Count: 1 })));
  source.catalog.set(PDFName.of('Names'),
    context.obj({ Dests: context.obj({ Names: [PDFString.of('章1'), context.obj([source.getPage(1).ref, PDFName.of('Fit')])] }) }));

  const result = await extractPages(source, [{ src: 1, rotate: 0 }], { PDFDocument });
  const out = await roundTrip(result.doc);

  assert.equal(out.catalog.get(PDFName.of('Outlines')), undefined);
  assert.equal(out.catalog.get(PDFName.of('Names')), undefined);
});

test('抽出はファイルとして書き出され、元ファイルは無傷である', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-extract-'));
  try {
    // ラベル付きの種を作る。ワーカーはバイト列から読み直すので、vendor と
    // node_modules の pdf-lib が混ざらない。
    const seeded = await PDFDocument.load(fs.readFileSync(fixturePath('three-pages.pdf')), { updateMetadata: false });
    writeLabels(seeded, ['i', 'ii', '1'], TOOLS);
    const source = path.join(dir, 'labelled.pdf');
    fs.writeFileSync(source, await seeded.save({ addDefaultPage: false }));
    const before = fs.statSync(source);
    const target = path.join(dir, 'out.pdf');

    const result = await runSave({
      kind: 'extract',
      source,
      target,
      pages: [{ src: 2, rotate: 90 }, { src: 0, rotate: 0 }],
      makeBackup: false,
    });

    assert.equal(result.ok, true);
    assert.equal(result.pages, 2);
    assert.equal(result.backup, null, '抽出では .bak を作らない');

    const out = await PDFDocument.load(fs.readFileSync(target), { updateMetadata: false });
    assert.equal(out.getPageCount(), 2);
    assert.equal(out.getPage(0).getRotation().angle, 90);
    assert.deepEqual(readLabels(out), ['1', 'i'], 'ラベルも並びに合わせて付いてくる');

    const after = fs.statSync(source);
    assert.equal(after.size, before.size, '元ファイルは書き換えていない');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
