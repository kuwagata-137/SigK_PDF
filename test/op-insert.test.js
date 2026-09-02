'use strict';

// 差し込みの層のテスト（spec-1-6 確定事項53〜65）。
//
// いちばん確かめたいのは**画素の寸法をそのまま紙にしない**ことである（確定事項59）。
// 1pt = 1/72 インチなので、素直に作るとスマホ写真が 1422×1067mm の紙になる。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { PDFDocument, PDFPage, PDFName, PDFString, rgb } = require('pdf-lib');
const { toBytes } = require('../file-io.js');
const {
  MAX_PIXELS,
  effectiveSize,
  baseSizeFor,
  fitInside,
  cleanInsertedPage,
  prepareInserts,
} = require('../worker/op-insert.js');
const { applyPlan } = require('../worker/op-pages.js');
const { runSave } = require('../worker/pdf-task.js');
const { makePng, makeJpeg, GIF87A, BMP, WEBP } = require('./fixtures/images.js');

const TOOLS = { PDFDocument, PDFPage, PDFName, rgb };
const A4 = { width: 595.28, height: 841.89 };

// 差し込み元の読み込みを差し替える。ディスクを触らずに形式ごとの分岐を見る。
function readerFor(files) {
  return {
    readFile: async (target) => {
      if (!(target in files))
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return toBytes(files[target]);
    },
  };
}

// ページの描画命令を読む。pdf-lib は内容ストリームを Flate で圧縮するので、
// 生バイトを grep しても見つからない（ページラベルと同じ事情である）。
function contentStreamOf(doc, index) {
  const contents = doc.context.lookup(doc.getPage(index).node.get(PDFName.of('Contents')));
  const streams = typeof contents.asArray === 'function'
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  return streams
    .map((stream) => zlib.inflateSync(Buffer.from(stream.getContents())).toString('latin1'))
    .join('\n');
}

async function makeDoc(pageCount, size = [A4.width, A4.height]) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1)
    doc.addPage(size);
  return doc;
}

// plan と inserts を組み立てて差し込み、出来上がった文書を返す。
async function insertInto(doc, plan, inserts, files) {
  const prepared = await prepareInserts(doc, doc.getPages(), plan, inserts, TOOLS, readerFor(files));
  if (prepared.ok !== true)
    return prepared;
  const applied = applyPlan(doc, plan, { inserted: prepared.pages });
  return applied.ok === true ? { ok: true, doc } : applied;
}

// ---- 大きさの決め方（確定事項59〜61） ----

test('内接させる。拡大はしない', () => {
  // 横長の絵を A4 へ。幅いっぱいで、上下に余白が付く。
  const wide = fitInside({ width: 1000, height: 500 }, A4);
  assert.equal(Math.round(wide.width), Math.round(A4.width));
  assert.equal(Math.round(wide.height), Math.round(A4.width / 2));
  assert.equal(Math.round(wide.x), 0);
  assert.ok(wide.y > 0, '上下に余白が残る');

  // 小さい絵は原寸のまま中央に置く（確定事項61）。
  const icon = fitInside({ width: 64, height: 64 }, A4);
  assert.deepEqual([icon.width, icon.height], [64, 64]);
  assert.equal(Math.round(icon.x), Math.round((A4.width - 64) / 2));

  assert.equal(fitInside({ width: 0, height: 10 }, A4), null);
  assert.equal(fitInside(null, A4), null);
});

test('90／270 度回ったページは、幅と高さを入れ替えて測る', async () => {
  const doc = await makeDoc(1, [400, 800]);
  const page = doc.getPage(0);

  assert.deepEqual(effectiveSize(page, 0), { width: 400, height: 800 });
  assert.deepEqual(effectiveSize(page, 90), { width: 800, height: 400 });
  assert.deepEqual(effectiveSize(page, 180), { width: 400, height: 800 });
  // 元ページ自身が回っていても同じである。
  page.setRotation({ type: 'degrees', angle: 270 });
  assert.deepEqual(effectiveSize(page, 0), { width: 800, height: 400 });
  assert.deepEqual(effectiveSize(page, 90), { width: 400, height: 800 });
});

test('基準は挿入位置の直前。先頭へ挿すときは直後', async () => {
  const doc = await makeDoc(2, [400, 800]);
  doc.getPage(1).setSize(200, 300);
  const original = doc.getPages();
  const plan = [{ src: 0 }, { insert: 0 }, { src: 1 }];

  assert.deepEqual(baseSizeFor(original, plan, 1), { width: 400, height: 800 }, '直前のページ');
  assert.deepEqual(baseSizeFor(original, [{ insert: 0 }, { src: 1 }], 0),
    { width: 200, height: 300 }, '先頭なら直後のページ');
  // 差し込みが続いているときは、その先の元ページまで遡る。
  assert.deepEqual(baseSizeFor(original, [{ src: 1 }, { insert: 0 }, { insert: 1 }], 2),
    { width: 200, height: 300 });
});

test('元ページが1つも無ければ A4 に落とす', () => {
  const size = baseSizeFor([], [{ insert: 0 }], 0);
  assert.equal(Math.round(size.width), Math.round(A4.width));
});

// ---- 差し込み（確定事項57・58・62・64） ----

test('画像は基準ページと同じ大きさの紙になる', async () => {
  const doc = await makeDoc(2, [400, 800]);
  const result = await insertInto(doc, [{ src: 0 }, { insert: 0 }, { src: 1 }], [{ path: 'a.png' }],
    { 'a.png': makePng({ width: 100, height: 50 }) });
  assert.equal(result.ok, true);

  const pages = result.doc.getPages();
  assert.equal(pages.length, 3);
  // 画素の寸法（100×50）ではなく、基準ページの寸法になる。
  assert.deepEqual(pages[1].getSize(), { width: 400, height: 800 });
});

test('差し込んだページは白い紙になっている', async () => {
  // 透過 PNG の /SMask は保たれるが、下地が無いとビューアの背景色が透ける
  // （確定事項62）。ページ全体を白で塗ってから絵を載せる。
  const doc = await makeDoc(1, [200, 200]);
  const result = await insertInto(doc, [{ src: 0 }, { insert: 0 }], [{ path: 'a.png' }],
    { 'a.png': makePng({ width: 10, height: 10, alpha: 0x00 }) });
  assert.equal(result.ok, true);

  const back = await PDFDocument.load(await result.doc.save(), { updateMetadata: false });
  const drawn = contentStreamOf(back, 1);
  assert.match(drawn, /1 1 1 rg/, '白で塗ってから');
  assert.match(drawn, /\bDo\b/, '絵を載せている');
});

test('画素数の上限を超える画像は断る', async () => {
  const doc = await makeDoc(1);
  // 実物を作ると 4,000万画素ぶんのメモリが要る。ヘッダーだけの JPEG で足りる。
  const huge = makeJpeg({ width: 9000, height: 5000 });
  assert.ok(9000 * 5000 > MAX_PIXELS);

  const result = await insertInto(doc, [{ src: 0 }, { insert: 0 }], [{ path: 'big.jpg' }], { 'big.jpg': huge });
  assert.match(result.error, /画像が大きすぎます/);
});

test('0画素の画像は断る', async () => {
  // embedPng は 0×0 でも成功し、pdf.js は US Letter の白紙として描く（実測）。
  const doc = await makeDoc(1);
  const result = await insertInto(doc, [{ src: 0 }, { insert: 0 }], [{ path: 'z.png' }],
    { 'z.png': makePng({ width: 0, height: 0 }) });
  assert.match(result.error, /大きさを読み取れませんでした/);
});

test('受け付けない形式は、断る理由まで返す', async () => {
  const doc = await makeDoc(1);
  const at = (file, bytes) => insertInto(doc, [{ src: 0 }, { insert: 0 }], [{ path: file }], { [file]: bytes });

  assert.match((await at('a.gif', GIF87A)).error, /GIF は挿入できません/);
  assert.match((await at('a.bmp', BMP)).error, /BMP は挿入できません/);
  assert.match((await at('a.webp', WEBP)).error, /対応していない形式です/);
  assert.match((await at('a.jpg', makeJpeg({ marker: 0xc2 }))).error, /プログレッシブ形式/);
});

test('読めないファイルは、その旨を返す', async () => {
  const doc = await makeDoc(1);
  const result = await insertInto(doc, [{ src: 0 }, { insert: 0 }], [{ path: 'ない.png' }], {});
  assert.match(result.error, /差し込むファイルを読めませんでした/);
});

test('差し込む番号が無ければ断る', async () => {
  const doc = await makeDoc(1);
  const result = await insertInto(doc, [{ src: 0 }, { insert: 3 }], [{ path: 'a.png' }],
    { 'a.png': makePng() });
  assert.match(result.error, /見つかりません/);
});

test('同じファイルを2ページぶん差し込んでも、読むのは1回だけである', async () => {
  const doc = await makeDoc(1);
  const reads = [];
  const files = { 'a.png': makePng({ width: 10, height: 10 }) };
  const reader = {
    readFile: async (target) => {
      reads.push(target);
      return toBytes(files[target]);
    },
  };

  const plan = [{ src: 0 }, { insert: 0 }, { insert: 1 }];
  const prepared = await prepareInserts(doc, doc.getPages(), plan,
    [{ path: 'a.png' }, { path: 'a.png' }], TOOLS, reader);

  assert.equal(prepared.ok, true);
  assert.deepEqual(reads, ['a.png']);
  assert.notEqual(prepared.pages[0], prepared.pages[1], '実体は別々に作る');
});

// ---- PDF の差し込み（確定事項63） ----

test('差し込んだ PDF から、入力欄と内部リンクを落とす', async () => {
  const source = await makeDoc(1, [200, 200]);
  const context = source.context;
  const page = source.getPage(0);
  const annot = (dict) => context.register(context.obj(dict));
  page.node.set(PDFName.of('Annots'), context.obj([
    annot({ Subtype: PDFName.of('Widget'), Rect: [0, 0, 10, 10] }),
    annot({ Subtype: PDFName.of('Link'), Rect: [0, 0, 10, 10], Dest: [page.ref, PDFName.of('Fit')] }),
    annot({
      Subtype: PDFName.of('Link'),
      Rect: [0, 0, 10, 10],
      A: context.obj({ S: PDFName.of('URI'), URI: PDFString.of('https://example.invalid/') }),
    }),
    annot({ Subtype: PDFName.of('Text'), Rect: [0, 0, 10, 10] }),
  ]));

  const doc = await makeDoc(1, [200, 200]);
  const result = await insertInto(doc, [{ src: 0 }, { insert: 0 }], [{ path: 'a.pdf' }],
    { 'a.pdf': Buffer.from(await source.save()) });
  assert.equal(result.ok, true);

  const kept = result.doc.context
    .lookup(result.doc.getPage(1).node.get(PDFName.of('Annots')))
    .asArray()
    .map((ref) => result.doc.context.lookup(ref).get(PDFName.of('Subtype')).asString());
  // 外部リンク（/URI）と注釈は残す。壊れていないためである。
  assert.deepEqual(kept, ['/Link', '/Text']);
});

test('cleanInsertedPage は注釈が無くても落ちない', async () => {
  const doc = await makeDoc(1);
  assert.equal(cleanInsertedPage(doc.getPage(0), { PDFName }), 0);
});

test('差し込む PDF に無いページを指したら断る', async () => {
  const source = await makeDoc(1, [200, 200]);
  const doc = await makeDoc(1);
  const result = await insertInto(doc, [{ src: 0 }, { insert: 0 }], [{ path: 'a.pdf', page: 5 }],
    { 'a.pdf': Buffer.from(await source.save()) });
  assert.match(result.error, /そのページがありません/);
});

test('差し込む PDF の大きさは元のままである', async () => {
  const source = await makeDoc(1, [200, 300]);
  const doc = await makeDoc(1, [400, 800]);
  const result = await insertInto(doc, [{ src: 0 }, { insert: 0 }], [{ path: 'a.pdf' }],
    { 'a.pdf': Buffer.from(await source.save()) });

  // 紙の大きさは中身である。画像と違い、内接させない。
  assert.deepEqual(result.doc.getPage(1).getSize(), { width: 200, height: 300 });
});

// ---- 回転（確定事項65） ----

test('差し込んだページも plan の rotate で回る', async () => {
  const doc = await makeDoc(1, [400, 800]);
  const result = await insertInto(doc, [{ src: 0 }, { insert: 0, rotate: 90 }], [{ path: 'a.png' }],
    { 'a.png': makePng({ width: 10, height: 10 }) });

  assert.equal(result.doc.getPage(1).getRotation().angle, 90);
});

// ---- 通し（確定事項55） ----

test('小さい JPEG も差し込める', async () => {
  // 【回帰】pdf-lib の JpegEmbedder は DataView の byteOffset を無視し、
  // readFileSync は 4KB 未満のファイルでプール Buffer（byteOffset≠0）を返す。
  // toBytes() を通し忘れると「小さい JPEG だけ挿入できない」不具合になる（確定事項55）。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-insert-'));
  try {
    const source = path.join(dir, 'base.pdf');
    fs.writeFileSync(source, await (await makeDoc(2, [400, 800])).save({ addDefaultPage: false }));
    const small = path.join(dir, 'small.jpg');
    fs.writeFileSync(small, makeJpeg({ width: 16, height: 8 }));
    assert.ok(fs.statSync(small).size < 4096, 'プール Buffer になる大きさである');

    const target = path.join(dir, 'out.pdf');
    const result = await runSave({
      source,
      target,
      pages: [{ src: 0, rotate: 0 }, { insert: 0, rotate: 0 }, { src: 1, rotate: 0 }],
      inserts: [{ path: small }],
      makeBackup: false,
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.pages, 3);

    const out = await PDFDocument.load(fs.readFileSync(target), { updateMetadata: false });
    assert.equal(out.getPageCount(), 3);
    assert.deepEqual(out.getPage(1).getSize(), { width: 400, height: 800 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
