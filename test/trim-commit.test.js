'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// トリミングを当てる・外す plan の作り替え（spec-4b-6a 確定事項14・18・19）。枠や右パネルを通さず、trim-commit.js を直に呼ぶ。

const A = 'C:\\work\\a.pdf';
const BOX = [100, 200, 400, 600];

async function withDocument(t, pdfjs = createPdfjsStub()) {
  const shell = await createShell({ pdfjs, files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  return shell;
}

function crops(shell) {
  return Array.from(shell.SigK.viewer.getPlan(), (page) => (page.crop === undefined ? null : [...page.crop]));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('apply はそのページだけを切り、見える範囲からはみ出した箱は重なりに収める', async (t) => {
  const shell = await withDocument(t);
  assert.deepEqual(plain(shell.SigK.trimCommit.apply(1, [-50, 100, 300, 2000], 'page')), { count: 1, small: 0, inserted: 0 });
  assert.deepEqual(crops(shell), [null, [0, 100, 300, A4.height], null]);
});

test('apply は重ならない箱・今の見える範囲と同じ箱では何も積まない', async (t) => {
  const shell = await withDocument(t);
  const depth = shell.SigK.pageEdit.getHistoryState().depth;
  assert.equal(shell.SigK.trimCommit.apply(0, [700, 0, 900, 100], 'page').count, 0);
  assert.equal(shell.SigK.trimCommit.apply(0, [0, 0, A4.width, A4.height], 'all').count, 0);
  assert.equal(shell.SigK.pageEdit.getHistoryState().depth, depth);
});

test('すべてのページ: 枠を引いたページが回してあっても、画面の向きの余白でほかのページを切る（plan の回転も数える）', async (t) => {
  const shell = await withDocument(t, createPdfjsStub({ rotations: [90, 0, 0] }));
  const { SigK } = shell;
  // 3 ページ目は画面で 90° 回しただけ（ファイルの /Rotate は 0）。
  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [2], 90));
  SigK.trimCommit.apply(0, BOX, 'all');

  // 1 ページ目（/Rotate 90）の画面の余白は 上 100・右 241.89・下 195.28・左 200。
  assert.deepEqual(crops(shell), [BOX, [200, 195.28, 353.39, 741.89], BOX]);
});

test('statusOf は、外せるページの数と、そのページが切ってあるか・見える範囲・回転を返す', async (t) => {
  const shell = await withDocument(t, createPdfjsStub({ rotations: [0, 270, 0] }));
  const { SigK } = shell;
  assert.deepEqual(plain(SigK.trimCommit.statusOf(1, 'page')), { count: 0, page: { cropped: false, box: [0, 0, A4.width, A4.height], rotation: 270 } });
  SigK.trimCommit.apply(1, BOX, 'page');

  assert.deepEqual(plain(SigK.trimCommit.statusOf(1, 'page')), { count: 1, page: { cropped: true, box: BOX, rotation: 270 } });
  assert.deepEqual(plain(SigK.trimCommit.statusOf(0, 'page')), { count: 0, page: { cropped: false, box: [0, 0, A4.width, A4.height], rotation: 0 } });
  assert.equal(SigK.trimCommit.statusOf(0, 'all').count, 1);
  assert.deepEqual(plain(SigK.trimCommit.statusOf(9, 'page')), { count: 0, page: null });
});

test('remove は紙全体を読めていればその箱に、読めていなければファイルの見える範囲に戻す', async (t) => {
  const pdfjs = createPdfjsStub({ sizes: [{ width: 400, height: 500 }, A4, A4], views: [[50, 60, 450, 560]] });
  const shell = await withDocument(t, pdfjs);
  const { SigK } = shell;
  SigK.trimCommit.apply(0, [100, 100, 300, 300], 'page');
  // まだ読んでいない: ファイルの見える範囲（crop の欄を消す）。
  assert.equal(SigK.trimCommit.remove(0, 'page'), 1);
  assert.deepEqual(crops(shell), [null, null, null]);

  shell.boxesResults.push({ ok: true, boxes: [[0, 0, 600, 700], [0, 0, A4.width, A4.height], [0, 0, A4.width, A4.height]] });
  await SigK.pageBoxes.load(SigK.viewer.getState().file);
  assert.equal(SigK.trimCommit.remove(0, 'page'), 1);
  assert.deepEqual(crops(shell), [[0, 0, 600, 700], null, null]);
  assert.equal(SigK.trimCommit.remove(0, 'page'), 0);
});
