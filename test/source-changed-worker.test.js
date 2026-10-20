'use strict';

// 開いたあとでほかのアプリが元のファイルを書き換えたときの、ワーカーの保存と抽出（spec-6-1 タスク C。決定81 ①）。
//
// 画面の並びと書き込みは、開いたときの中身を前提にしている。ワーカーは読む前に元の印（大きさと更新時刻）を照らし、書き換えられていたら
// 何もせず { sourceChanged: true } を返す（C-2）。画面は開いたときのバイト列を鍵 'opened' の写しで渡してやり直し、ワーカーはそれを元にする
// （C-3・C-6）。書き換えは「3 ページの PDF を開いたあとで、1 ページの PDF に置き換えられた」で作る（ページの番号が当たらなくなる）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument } = require('pdf-lib');
const { runSave } = require('../worker/pdf-task.js');
const { readSignature } = require('../pdf-write.js');
const { NO_SOURCE, runCopy } = require('../worker/op-copy.js');
const { fixturePath } = require('./fixtures/build.js');

// 3 ページの PDF を開き（印を控える）、そのあとで 1 ページの PDF に書き換えられた、を作る。
async function changedAfterOpening(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-source-changed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'a.pdf');
  fs.copyFileSync(fixturePath('three-pages.pdf'), file);
  const openedBytes = new Uint8Array(fs.readFileSync(file));
  const opened = await readSignature(file);
  fs.copyFileSync(fixturePath('one-page.pdf'), file);
  return { dir, file, opened, openedBytes, changedBytes: fs.readFileSync(file) };
}

const pageCount = async (filePath) => (await PDFDocument.load(fs.readFileSync(filePath), { updateMetadata: false })).getPageCount();
const reordered = [{ src: 2, rotate: 0 }, { src: 0, rotate: 0 }, { src: 1, rotate: 0 }];

test('保存は、元が開いたときの印と違えば、読む前に止めて sourceChanged を返す（元のファイルは変えない）', async (t) => {
  const { file, opened, changedBytes } = await changedAfterOpening(t);
  const result = await runSave({ kind: 'save', source: file, target: file, pages: reordered, makeBackup: true, expect: opened, expectSource: opened });
  assert.deepEqual(result, { sourceChanged: true });
  assert.deepEqual(fs.readFileSync(file), changedBytes);
  assert.equal(fs.existsSync(`${file}.bak`), false, '控えも作らない');
});

test('抽出も、元が書き換えられていれば止め、行き先を作らない', async (t) => {
  const { dir, file, opened } = await changedAfterOpening(t);
  const target = path.join(dir, 'out.pdf');
  const result = await runSave({ kind: 'extract', source: file, target, pages: [{ src: 2, rotate: 0 }], expectSource: opened });
  assert.deepEqual(result, { sourceChanged: true });
  assert.equal(fs.existsSync(target), false);
});

test('開いたときのバイト列（鍵 opened の写し）を渡されたら、書き換えられたディスクを読まずにそれを元にする', async (t) => {
  const { dir, file, openedBytes } = await changedAfterOpening(t);
  const target = path.join(dir, 'b.pdf');
  const result = await runSave({ kind: 'save', source: file, target, pages: reordered, sourceCopy: 'opened', copies: { opened: openedBytes }, expect: null, expectSource: null });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.pages, 3);
  assert.equal(await pageCount(target), 3, '開いたときの 3 ページから作った');
  assert.equal(await pageCount(file), 1, '元のファイルは書き換えられたまま');
});

test('上書きのやり直し（照合を外す）も、開いたときのバイト列から書き、書き換えられた中身を控え（.bak）に残す', async (t) => {
  const { file, openedBytes, changedBytes } = await changedAfterOpening(t);
  const result = await runSave({ kind: 'save', source: file, target: file, pages: reordered, makeBackup: true, sourceCopy: 'opened', copies: { opened: openedBytes }, expect: null, expectSource: null });
  assert.equal(result.ok, true, result.error);
  assert.equal(await pageCount(file), 3);
  assert.deepEqual(fs.readFileSync(`${file}.bak`), changedBytes);
});

test('抽出のやり直しも、開いたときのページの番号のまま当たる', async (t) => {
  const { dir, file, openedBytes } = await changedAfterOpening(t);
  const target = path.join(dir, 'out.pdf');
  const result = await runSave({ kind: 'extract', source: file, target, pages: [{ src: 2, rotate: 0 }, { src: 1, rotate: 0 }], sourceCopy: 'opened', copies: { opened: openedBytes } });
  assert.equal(result.ok, true, result.error);
  assert.equal(await pageCount(target), 2, '書き換えられた 1 ページの PDF には 3 ページ目が無い');
});

test('写しの鍵を渡されてバイト列が無ければ、パスがあってもディスクへ落ちずに止める', async (t) => {
  const { dir, file } = await changedAfterOpening(t);
  const target = path.join(dir, 'b.pdf');
  const result = await runSave({ kind: 'save', source: file, target, pages: [{ src: 0, rotate: 0 }], sourceCopy: 'opened', copies: {} });
  assert.equal(result.error, NO_SOURCE);
  assert.equal(fs.existsSync(target), false);
});

test('元の印が開いたときのままなら、今のとおりディスクから読んで保存する', async (t) => {
  const { dir, file } = await changedAfterOpening(t);
  const target = path.join(dir, 'b.pdf');
  const result = await runSave({ kind: 'save', source: file, target, pages: [{ src: 0, rotate: 0 }], expectSource: await readSignature(file) });
  assert.equal(result.ok, true, result.error);
  assert.equal(await pageCount(target), 1);
});

test('名前を付けて保存で既にある別のファイルを選んでも、行き先の照合をしなければ置き換える（穴①はワーカーへ expect を渡さない形で直す）', async (t) => {
  const { dir, file } = await changedAfterOpening(t);
  const target = path.join(dir, 'existing.pdf');
  fs.copyFileSync(fixturePath('three-pages.pdf'), target);
  const result = await runSave({ kind: 'save', source: file, target, pages: [{ src: 0, rotate: 0 }], expect: null, expectSource: await readSignature(file) });
  assert.equal(result.ok, true, result.error);
  assert.equal(await pageCount(target), 1);
});

test('帯のページを写すときも、元が書き換えられていれば止め、開いたときの中身なら開いたときのページの番号で写せる', async (t) => {
  const { file, opened, openedBytes } = await changedAfterOpening(t);
  const spec = { kind: 'copy-pages', source: file, pages: [{ src: 2, rotate: 0 }], expectSource: opened };
  assert.deepEqual(await runCopy(spec, { fsLike: fs }), { sourceChanged: true });
  const redone = await runCopy({ ...spec, sourceCopy: 'opened', copies: { opened: openedBytes }, expectSource: null }, { fsLike: fs });
  assert.equal(redone.ok, true, redone.error);
  assert.equal(redone.sizes.length, 1);
});
