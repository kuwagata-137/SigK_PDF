'use strict';

// ページラベルの層のテスト（spec-1-6 確定事項41〜46）。
//
// 「正しく書けたか」は生バイトを grep しても分からない。pdf-lib の既定
// （useObjectStreams: true）で /Nums は圧縮され、生バイトに現れないためである。
// pdf.js の getPageLabels() を正とする（確定事項46）。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString } = require('pdf-lib');
const {
  toRoman,
  toLetters,
  numeralFor,
  readLabels,
  writeLabels,
  rebuildLabels,
} = require('../worker/op-page-labels.js');
const { applyPlan } = require('../worker/op-pages.js');

const TOOLS = { PDFName, PDFHexString };

// pdf.js（legacy ビルド）は Node から読める。読み込みが重いので1回だけ。
let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs === null) {
    const entry = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
    pdfjs = await import(pathToFileURL(entry).href);
  }
  return pdfjs;
}

async function labelsViaPdfjs(bytes) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const labels = await doc.getPageLabels();
  await task.destroy();
  return labels;
}

async function makeDoc(pageCount) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1)
    doc.addPage([200, 200]);
  return doc;
}

// 範囲の列で /PageLabels を持つ文書を作る。ranges は [開始ページ, {S,P,St}] の並び。
async function seedWithRanges(pageCount, ranges) {
  const doc = await makeDoc(pageCount);
  const nums = [];
  for (const [start, spec] of ranges) {
    nums.push(start);
    const entry = {};
    if (spec.S !== undefined) entry.S = PDFName.of(spec.S);
    if (spec.P !== undefined) entry.P = PDFHexString.fromText(spec.P);
    if (spec.St !== undefined) entry.St = PDFNumber.of(spec.St);
    nums.push(doc.context.obj(entry));
  }
  doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: nums }));
  return doc;
}

test('ローマ数字と英字の作り方', () => {
  assert.equal(toRoman(1), 'i');
  assert.equal(toRoman(4), 'iv');
  assert.equal(toRoman(1987), 'mcmlxxxvii');
  assert.equal(toRoman(0), '');
  assert.equal(toLetters(1), 'a');
  assert.equal(toLetters(26), 'z');
  // PDF の英字ラベルは 27 番目が aa になる（26 進法ではない）。
  assert.equal(toLetters(27), 'aa');
  assert.equal(toLetters(53), 'aaa');
  assert.equal(toLetters(0), '');
});

test('様式ごとの数字の出し方', () => {
  assert.equal(numeralFor('/D', 12), '12');
  assert.equal(numeralFor('/r', 4), 'iv');
  assert.equal(numeralFor('/R', 4), 'IV');
  assert.equal(numeralFor('/a', 2), 'b');
  assert.equal(numeralFor('/A', 2), 'B');
  // /S が無いエントリは接頭辞だけになる。
  assert.equal(numeralFor(null, 3), '');
});

test('ラベルを持たない文書では null を返す', async () => {
  const doc = await makeDoc(3);
  assert.equal(readLabels(doc), null);
});

test('範囲の列を1ページずつへ展開する', async () => {
  const doc = await seedWithRanges(7, [[0, { S: 'r' }], [3, { S: 'D', St: 1 }]]);
  assert.deepEqual(readLabels(doc), ['i', 'ii', 'iii', '1', '2', '3', '4']);
});

test('接頭辞だけ・開始番号・英字が混じっても展開できる', async () => {
  const doc = await seedWithRanges(9, [
    [0, { S: 'r' }],
    [2, { P: 'App-' }],                 // /S 無し。接頭辞だけ
    [4, { S: 'A', P: 'Sec ', St: 3 }],
    [6, { S: 'a', St: 26 }],
  ]);
  assert.deepEqual(readLabels(doc), ['i', 'ii', 'App-', 'App-', 'Sec C', 'Sec D', 'z', 'aa', 'bb']);
});

test('最初のエントリより前のページはラベル無しになる', async () => {
  const doc = await seedWithRanges(5, [[2, { S: 'D', St: 1 }]]);
  assert.deepEqual(readLabels(doc), ['', '', '1', '2', '3']);
});

test('number tree が Kids で枝分かれしていても辿る', async () => {
  const doc = await makeDoc(6);
  const context = doc.context;
  const leafA = context.register(context.obj({ Nums: [0, context.obj({ S: PDFName.of('r') })] }));
  const leafB = context.register(context.obj({ Nums: [3, context.obj({ S: PDFName.of('D'), St: PDFNumber.of(1) })] }));
  doc.catalog.set(PDFName.of('PageLabels'), context.obj({ Kids: [leafA, leafB] }));
  assert.deepEqual(readLabels(doc), ['i', 'ii', 'iii', '1', '2', '3']);
});

test('書いたラベルを pdf.js が読む', async () => {
  const doc = await makeDoc(6);
  writeLabels(doc, ['i', 'ii', '1', '2', '3', '4'], TOOLS);
  const bytes = await doc.save({ addDefaultPage: false });
  assert.deepEqual(await labelsViaPdfjs(bytes), ['i', 'ii', '1', '2', '3', '4']);
});

test('日本語や括弧の入ったラベルが往復する', async () => {
  // 素の JS 文字列や PDFString.of ではここが壊れる（PDFName に化ける／文字が潰れる）。
  const labels = ['第1部-1', '第1部-2', 'a(b)c', '01'];
  const doc = await makeDoc(4);
  writeLabels(doc, labels, TOOLS);
  const bytes = await doc.save({ addDefaultPage: false });
  assert.deepEqual(await labelsViaPdfjs(bytes), labels);
});

test('素の JS 文字列を接頭辞に使うとラベル全体が消える（使ってはいけない形の確認）', async () => {
  const doc = await makeDoc(2);
  doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({
    Nums: [0, doc.context.obj({ P: '付-' })],     // わざと間違えた書き方
  }));
  const bytes = await doc.save({ addDefaultPage: false });
  // 例外は出ない。pdf.js が黙って null を返す。
  assert.equal(await labelsViaPdfjs(bytes), null);
});

test('plan の並びに合わせて作り直す', async () => {
  const doc = await seedWithRanges(6, [[0, { S: 'r' }], [3, { S: 'D', St: 1 }]]);
  const before = readLabels(doc);
  assert.deepEqual(before, ['i', 'ii', 'iii', '1', '2', '3']);

  // 逆順にする plan。
  const plan = [5, 4, 3, 2, 1, 0].map((src) => ({ src, rotate: 0 }));
  assert.equal(rebuildLabels(doc, plan, before, TOOLS), true);

  const bytes = await doc.save({ addDefaultPage: false });
  assert.deepEqual(await labelsViaPdfjs(bytes), ['3', '2', '1', 'iii', 'ii', 'i']);
});

test('削除を含む plan でもラベルがページに付いて回る', async () => {
  const doc = await seedWithRanges(6, [[0, { S: 'r' }], [3, { S: 'D', St: 1 }]]);
  const before = readLabels(doc);
  const plan = [{ src: 4 }, { src: 0 }, { src: 1 }];
  // ラベルの作り直しは applyPlan の**あと**でなければならない。先に書くと、
  // 残ったページ数に対してエントリが足りず、最後のラベルが引き延ばされる。
  assert.equal(applyPlan(doc, plan).ok, true);
  rebuildLabels(doc, plan, before, TOOLS);
  const bytes = await doc.save({ addDefaultPage: false });
  assert.deepEqual(await labelsViaPdfjs(bytes), ['2', 'i', 'ii']);
});

test('挿入したページにはラベルを付けない', async () => {
  const doc = await seedWithRanges(3, [[0, { S: 'r' }]]);
  const before = readLabels(doc);
  const plan = [{ src: 0 }, { insert: 0 }, { src: 1 }];
  rebuildLabels(doc, plan, before, TOOLS);
  const bytes = await doc.save({ addDefaultPage: false });
  assert.deepEqual(await labelsViaPdfjs(bytes), ['i', '', 'ii']);
});

test('元がラベルを持たなければ作り直さない', async () => {
  const doc = await makeDoc(3);
  assert.equal(rebuildLabels(doc, [{ src: 0 }], null, TOOLS), false);
  const bytes = await doc.save({ addDefaultPage: false });
  assert.equal(await labelsViaPdfjs(bytes), null, 'ラベルの無い文書に勝手に生やさない');
});

test('作り直しても保存後にもう一度読み直せる', async () => {
  const doc = await seedWithRanges(4, [[0, { S: 'R' }]]);
  const before = readLabels(doc);
  assert.deepEqual(before, ['I', 'II', 'III', 'IV']);
  const plan = [{ src: 3 }, { src: 0 }];
  assert.equal(applyPlan(doc, plan).ok, true);
  rebuildLabels(doc, plan, before, TOOLS);
  const bytes = await doc.save({ addDefaultPage: false });
  const reopened = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.deepEqual(readLabels(reopened), ['IV', 'I']);
});

test('PDFString で書いた接頭辞も読める（他のアプリが作った文書のため）', async () => {
  const doc = await makeDoc(2);
  doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({
    Nums: [0, doc.context.obj({ S: PDFName.of('D'), P: PDFString.of('A-'), St: PDFNumber.of(5) })],
  }));
  assert.deepEqual(readLabels(doc), ['A-5', 'A-6']);
});
