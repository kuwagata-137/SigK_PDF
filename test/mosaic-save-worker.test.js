'use strict';

// モザイクの保存と抽出をワーカーの runSave で回す（spec-4b-6b 確定事項20〜25）。
//   - 保存したファイルに 1 ページ目の元の文字が残らない（.bak も消える）、2 ページ目と書き込みは残る
//   - 並べ替えた plan でも、モザイクは元のページ番号（src）のページに当たる
//   - 開き直して保存する往復を 3 回くり返しても、画像のページと書き込みが変わらない
//   - 抽出でも画像に置き換わる

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');
const { runSave } = require('../worker/pdf-task.js');
const { readSignature, backupPathFor } = require('../pdf-write.js');
const { IMAGE_NAME } = require('../worker/op-mosaic.js');
const { SECRETS, KEEPS, scan, buildMosaicSample, pngBytes } = require('./fixtures/mosaic-sample.js');

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-mosaic-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: (name) => path.join(dir, name) };
}

const MOSAIC = { src: 0, kind: 'png', box: [0, 0, 595, 842] };

async function seed(ws) {
  const file = ws.file('a.pdf');
  fs.writeFileSync(file, await buildMosaicSample());
  return file;
}

function xobjectNames(page) {
  return page.node.Resources().lookup(PDFName.of('XObject'), PDFDict)?.keys().map((key) => key.decodeText()) ?? [];
}

test('上書き保存: 1 ページ目の元の文字はファイルに残らず、前の .bak も消え、2 ページ目と書き込みは残る', async (t) => {
  const ws = workspace(t);
  const file = await seed(ws);
  fs.writeFileSync(backupPathFor(file), 'ひとつ前の内容');
  const result = await runSave({
    kind: 'save', source: file, target: file, pages: [{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }],
    mosaics: [{ ...MOSAIC, bytes: pngBytes() }], makeBackup: false, dropBackup: true, expect: await readSignature(file),
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.backupLeft, false);
  assert.equal(fs.existsSync(backupPathFor(file)), false);
  const counts = scan(fs.readFileSync(file), [...SECRETS, ...KEEPS]);
  for (const word of SECRETS)
    assert.equal(counts[word], 0, word);
  for (const word of KEEPS)
    assert.ok(counts[word] > 0, word);
});

test('並べ替えた plan でも、モザイクは元のページ番号のページに当たる', async (t) => {
  const ws = workspace(t);
  const file = await seed(ws);
  const result = await runSave({
    kind: 'save', source: file, target: file, pages: [{ src: 1, rotate: 0 }, { src: 0, rotate: 0 }],
    mosaics: [{ ...MOSAIC, bytes: pngBytes() }], makeBackup: false, dropBackup: true, expect: await readSignature(file),
  });
  assert.equal(result.ok, true, result.error);
  const doc = await PDFDocument.load(fs.readFileSync(file));
  assert.deepEqual(xobjectNames(doc.getPages()[1]), [IMAGE_NAME]);
  assert.notDeepEqual(xobjectNames(doc.getPages()[0]), [IMAGE_NAME]);
  assert.equal(scan(fs.readFileSync(file), ['SECRET-ONE'])['SECRET-ONE'], 0);
});

test('開き直して保存する往復を 3 回くり返しても、画像のページと書き込み・回転は変わらない', async (t) => {
  const ws = workspace(t);
  const file = await seed(ws);
  const pages = [{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }];
  await runSave({ kind: 'save', source: file, target: file, pages, mosaics: [{ ...MOSAIC, bytes: pngBytes() }], dropBackup: true, expect: await readSignature(file) });
  for (let round = 0; round < 3; round += 1) {
    const result = await runSave({ kind: 'save', source: file, target: file, pages, makeBackup: true, expect: await readSignature(file) });
    assert.equal(result.ok, true, result.error);
  }
  const doc = await PDFDocument.load(fs.readFileSync(file));
  const page = doc.getPages()[0];
  assert.deepEqual(xobjectNames(page), [IMAGE_NAME]);
  assert.equal(page.node.Annots().size(), 1);
  assert.equal(page.getRotation().angle, 90);
  assert.equal(scan(fs.readFileSync(file), SECRETS)['SECRET-ONE'], 0);
});

test('名前を付けて保存では元のファイルを変えず、保存先にだけ画像を書く', async (t) => {
  const ws = workspace(t);
  const file = await seed(ws);
  const before = fs.readFileSync(file);
  const target = ws.file('b.pdf');
  const result = await runSave({ kind: 'save', source: file, target, pages: [{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }], mosaics: [{ ...MOSAIC, bytes: pngBytes() }], makeBackup: false });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(scan(fs.readFileSync(target), ['SECRET-ONE'])['SECRET-ONE'], 0);
  assert.equal(fs.existsSync(backupPathFor(file)), false);
});

test('抽出でも、モザイクのページは画像に置き換わって書き出され、元のファイルは変わらない', async (t) => {
  const ws = workspace(t);
  const file = await seed(ws);
  const before = fs.readFileSync(file);
  const target = ws.file('extract.pdf');
  const result = await runSave({ kind: 'extract', source: file, target, pages: [{ src: 0, rotate: 0 }], mosaics: [{ ...MOSAIC, bytes: pngBytes() }], makeBackup: false });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(fs.readFileSync(file), before);
  const counts = scan(fs.readFileSync(target), [...SECRETS, 'ANNOTKEEP']);
  for (const word of SECRETS)
    assert.equal(counts[word], 0, word);
  assert.ok(counts.ANNOTKEEP > 0);
  const doc = await PDFDocument.load(fs.readFileSync(target));
  assert.deepEqual(xobjectNames(doc.getPages()[0]), [IMAGE_NAME]);
});

test('モザイクの指定が正しくなければ保存を断り、元のファイルは変わらない', async (t) => {
  const ws = workspace(t);
  const file = await seed(ws);
  const before = fs.readFileSync(file);
  const result = await runSave({ kind: 'save', source: file, target: file, pages: [{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }], mosaics: [{ ...MOSAIC, src: 5, bytes: pngBytes() }], expect: await readSignature(file) });
  assert.ok(result.error);
  assert.deepEqual(fs.readFileSync(file), before);
});

// コードの点検で足したもの。
test('plan でモザイクのあるページの画像が来ていなければ、保存も抽出も断り、何も書かない', async (t) => {
  const ws = workspace(t);
  const file = await seed(ws);
  const before = fs.readFileSync(file);
  const marked = { src: 1, rotate: 0, mosaic: [{ box: [0, 0, 100, 100], block: 8 }] };
  const saved = await runSave({ kind: 'save', source: file, target: file, pages: [{ src: 0, rotate: 0 }, marked], mosaics: [{ ...MOSAIC, bytes: pngBytes() }], dropBackup: true, expect: await readSignature(file) });
  assert.match(saved.error ?? '', /画像がそろっていない/);
  assert.deepEqual(fs.readFileSync(file), before);
  const target = ws.file('extract.pdf');
  const extracted = await runSave({ kind: 'extract', source: file, target, pages: [marked], mosaics: [] });
  assert.match(extracted.error ?? '', /画像がそろっていない/);
  assert.equal(fs.existsSync(target), false);
});

test('名前を付けて保存で開いているファイル自身（区切りの字が違う書き方）を選んでも、モザイクがあれば前の控えを消す', async (t) => {
  const ws = workspace(t);
  const file = await seed(ws);
  fs.writeFileSync(backupPathFor(file), 'ひとつ前の内容');
  const result = await runSave({ kind: 'save', source: file, target: file.replace(/\\/g, '/'), pages: [{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }],
    mosaics: [{ ...MOSAIC, bytes: pngBytes() }], makeBackup: false, expect: await readSignature(file) });
  assert.equal(result.ok, true, result.error);
  assert.equal(fs.existsSync(backupPathFor(file)), false);
  assert.equal(scan(fs.readFileSync(file), ['SECRET-ONE'])['SECRET-ONE'], 0);
});

test('モザイクがあるとき、元のファイルが開いたときの印と違えば、保存も抽出も読む前に断る', async (t) => {
  const ws = workspace(t);
  const file = await seed(ws);
  const opened = await readSignature(file);
  fs.appendFileSync(file, '\n% changed elsewhere\n');
  const before = fs.readFileSync(file);
  const pages = [{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }];
  const saved = await runSave({ kind: 'save', source: file, target: file, pages, mosaics: [{ ...MOSAIC, bytes: pngBytes() }], dropBackup: true, expect: null, expectSource: opened });
  assert.match(saved.error ?? '', /開いたあとで元のファイルが別のアプリで変更された/);
  assert.deepEqual(fs.readFileSync(file), before);
  const target = ws.file('extract.pdf');
  const extracted = await runSave({ kind: 'extract', source: file, target, pages: [pages[0]], mosaics: [{ ...MOSAIC, bytes: pngBytes() }], expectSource: opened });
  assert.match(extracted.error ?? '', /開いたあとで元のファイルが別のアプリで変更された/);
  assert.equal(fs.existsSync(target), false);
  const same = await runSave({ kind: 'save', source: file, target, pages, mosaics: [{ ...MOSAIC, bytes: pngBytes() }], expectSource: await readSignature(file) });
  assert.equal(same.ok, true, '同じ印なら通る');
});
