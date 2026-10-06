'use strict';

// トリミングの保存（spec-4b-6a 確定事項9・21〜24）。ワーカーの runSave・runTask をファイルで回す。
//   - plan の crop が /CropBox になり、保存して開き直す往復を 3 回くり返しても変わらない
//   - ページ木の中間の /Pages から箱を受け継ぐ PDF を保存しても、紙と見える範囲が変わらない（事前調査 C の不具合の直し）
//   - 抽出にも乗る、page-boxes は受け継いだ MediaBox を返す

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument, PDFName } = require('pdf-lib');
const { runSave, runTask } = require('../worker/pdf-task.js');
const { readSignature } = require('../pdf-write.js');

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-trim-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { file: (name) => path.join(dir, name) };
}

async function plainPdf(count = 2) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < count; index += 1)
    doc.addPage([600, 800]);
  return doc.save();
}

// 根 → 中間の /Pages（MediaBox・CropBox）→ ページ 2 枚。
async function inheritedPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  doc.addPage([600, 800]);
  const ctx = doc.context;
  const pages = doc.getPages();
  const mid = ctx.obj({ Type: 'Pages', Parent: doc.catalog.get(PDFName.of('Pages')), Kids: pages.map((page) => page.ref), Count: 2,
    MediaBox: [0, 0, 600, 800], CropBox: [100, 200, 400, 600] });
  const midRef = ctx.register(mid);
  for (const page of pages) {
    page.node.delete(PDFName.of('MediaBox'));
    page.node.set(PDFName.of('Parent'), midRef);
  }
  doc.catalog.Pages().set(PDFName.of('Kids'), ctx.obj([midRef]));
  return doc.save();
}

async function boxesOf(file) {
  const doc = await PDFDocument.load(fs.readFileSync(file));
  return doc.getPages().map((page) => {
    const media = page.getMediaBox();
    const crop = page.getCropBox();
    return { media: [media.x, media.y, media.x + media.width, media.y + media.height], crop: [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height] };
  });
}

async function save(file, pages) {
  const result = await runSave({ kind: 'save', source: file, target: file, pages, makeBackup: false, expect: await readSignature(file) });
  assert.equal(result.ok, true, result.error);
  return result;
}

test('plan の crop は /CropBox になり、保存して開き直す往復を 3 回くり返しても変わらない', async (t) => {
  const ws = workspace(t);
  const file = ws.file('a.pdf');
  fs.writeFileSync(file, await plainPdf());
  await save(file, [{ src: 0, rotate: 0, crop: [50.5, 60.25, 300, 700] }, { src: 1, rotate: 90 }]);
  const first = await boxesOf(file);
  assert.deepEqual(first[0], { media: [0, 0, 600, 800], crop: [50.5, 60.25, 300, 700] });
  assert.deepEqual(first[1].crop, [0, 0, 600, 800]);
  for (let round = 0; round < 3; round += 1) {
    await save(file, [{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }]);
    assert.deepEqual(await boxesOf(file), first, `${round + 1} 回目`);
  }
});

test('紙全体と同じ crop は /CropBox を消す（トリミングを外す）', async (t) => {
  const ws = workspace(t);
  const file = ws.file('a.pdf');
  fs.writeFileSync(file, await plainPdf(1));
  await save(file, [{ src: 0, rotate: 0, crop: [10, 10, 200, 200] }]);
  await save(file, [{ src: 0, rotate: 0, crop: [0, 0, 600, 800] }]);
  const doc = await PDFDocument.load(fs.readFileSync(file));
  assert.equal(doc.getPages()[0].node.get(PDFName.of('CropBox')), undefined);
});

test('中間の /Pages から箱を受け継ぐ PDF を保存しても、紙と見える範囲が変わらない', async (t) => {
  const ws = workspace(t);
  const file = ws.file('inherited.pdf');
  fs.writeFileSync(file, await inheritedPdf());
  const before = await boxesOf(file);
  assert.deepEqual(before[0], { media: [0, 0, 600, 800], crop: [100, 200, 400, 600] });
  // 並べ替えて保存（組み直しで親が根に付け替わる）。
  await save(file, [{ src: 1, rotate: 0 }, { src: 0, rotate: 90 }]);
  assert.deepEqual(await boxesOf(file), before);
});

test('切り方の正しくない plan は保存を断り、ファイルを変えない', async (t) => {
  const ws = workspace(t);
  const file = ws.file('a.pdf');
  const bytes = await plainPdf(1);
  fs.writeFileSync(file, bytes);
  const result = await runSave({ kind: 'save', source: file, target: file, pages: [{ src: 0, rotate: 0, crop: [700, 0, 900, 10] }], expect: await readSignature(file) });
  assert.match(result.error, /切り方が正しくありません/);
  assert.deepEqual(fs.readFileSync(file), Buffer.from(bytes));
});

test('抽出にも crop が乗る', async (t) => {
  const ws = workspace(t);
  const file = ws.file('a.pdf');
  const target = ws.file('out.pdf');
  fs.writeFileSync(file, await plainPdf(2));
  const result = await runSave({ kind: 'extract', source: file, target, pages: [{ src: 1, rotate: 0, crop: [20, 30, 220, 330] }] });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(await boxesOf(target), [{ media: [0, 0, 600, 800], crop: [20, 30, 220, 330] }]);
});

test('page-boxes は受け継いだ MediaBox をページ順に返し、外から書き換えられていたら読まない', async (t) => {
  const ws = workspace(t);
  const file = ws.file('inherited.pdf');
  fs.writeFileSync(file, await inheritedPdf());
  const expect = await readSignature(file);
  // runTask は掛かった時間（ms）を足して返すので、それを除いて比べる。
  const plain = async (spec) => { const { ms: _ms, ...rest } = await runTask(spec); return rest; };
  assert.deepEqual(await plain({ kind: 'page-boxes', source: file, expect: { size: expect.size, mtimeMs: expect.mtimeMs } }),
    { ok: true, boxes: [[0, 0, 600, 800], [0, 0, 600, 800]] });
  assert.deepEqual(await plain({ kind: 'page-boxes', source: file, expect: { size: expect.size + 1, mtimeMs: expect.mtimeMs } }),
    { ok: false, reason: 'changed' });
  assert.deepEqual(await plain({ kind: 'page-boxes', source: file }), { ok: false, reason: 'invalid' });
});
