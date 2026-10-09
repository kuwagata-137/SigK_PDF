'use strict';

// 分割の盤のサムネイルを描く層（spec-2-2b 確定事項D1〜D8）。対象の PDF を 1 回だけ読んで開いたまま持ち、頼まれたページだけ描き、
// 上限を超えたら手放し、畳むときは全部手放して文書を閉じる。jsdom には 2D コンテキストが無いので、描いたかどうかは pdf.js の偽物の
// viewportCalls、手放したかどうかは cleanups と documents[].destroyed で見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, A4 } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

async function createThumbShell(t, { sizes = [A4, A4, A4, A4, A4, A4], password = null } = {}) {
  const pdfjs = createPdfjsStub({ sizes, password });
  const shell = await createShell({ pdfjs, files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) } });
  t.after(() => shell.cleanup());
  await shell.flush();
  return { shell, pdfjs, sizes, thumbs: shell.SigK.splitThumbs };
}

const settle = async (shell) => {
  for (let i = 0; i < 6; i += 1)
    await shell.flush();
};

test('open は 1 回だけ読み、ページ数と名前を返して文書を開いたまま持つ', async (t) => {
  const { shell, pdfjs, thumbs } = await createThumbShell(t);
  assert.deepEqual(structuredClone(await thumbs.open(A)), { pageCount: 6, name: 'a.pdf' });
  assert.equal(pdfjs.documents.length, 1);
  assert.equal(pdfjs.documents[0].destroyed, false);
  assert.equal(thumbs.getState().open, true);
  assert.equal(thumbs.getState().path, A);
  assert.ok(shell);
});

test('頼まれたページだけを、紙の枠に収まる倍率で描く', async (t) => {
  const { shell, pdfjs, thumbs } = await createThumbShell(t);
  await thumbs.open(A);
  pdfjs.viewportCalls.length = 0;
  thumbs.want([0, 2], { cap: 72 });
  await settle(shell);
  const layout = shell.SigK.splitLayout;
  const scale = layout.thumbScale({ cell: layout.cellOf('mid'), pageWidth: A4.width, pageHeight: A4.height, devicePixelRatio: 1 });
  const drawnAt = pdfjs.viewportCalls.filter((call) => call.scale === scale).map((call) => call.page);
  assert.deepEqual([...new Set(drawnAt)].sort(), [1, 3]);
  assert.deepEqual(structuredClone(thumbs.getState().drawn), [0, 2]);
});

test('上限を超えたページと、頼まれなくなったページは手放す（canvas と page.cleanup）', async (t) => {
  const { shell, pdfjs, thumbs } = await createThumbShell(t);
  await thumbs.open(A);
  thumbs.want([0, 1, 2], { cap: 2 });
  await settle(shell);
  assert.deepEqual(structuredClone(thumbs.getState().drawn), [0, 1]);
  pdfjs.cleanups.length = 0;
  thumbs.want([4, 5], { cap: 2 });
  await settle(shell);
  assert.deepEqual(structuredClone(thumbs.getState().drawn), [4, 5]);
  assert.deepEqual([...pdfjs.cleanups].sort(), [1, 2]);
});

test('大きさを変えると全部手放し、次に頼まれたときに新しい倍率で描き直す', async (t) => {
  const { shell, pdfjs, thumbs } = await createThumbShell(t);
  await thumbs.open(A);
  thumbs.want([0], { cap: 72 });
  await settle(shell);
  pdfjs.cleanups.length = 0;
  thumbs.setSize('large');
  assert.deepEqual(structuredClone(thumbs.getState().drawn), []);
  assert.deepEqual(pdfjs.cleanups, [1]);
  pdfjs.viewportCalls.length = 0;
  thumbs.want([0], { cap: 36 });
  await settle(shell);
  const layout = shell.SigK.splitLayout;
  const scale = layout.thumbScale({ cell: layout.cellOf('large'), pageWidth: A4.width, pageHeight: A4.height, devicePixelRatio: 1 });
  assert.ok(pdfjs.viewportCalls.some((call) => call.page === 1 && call.scale === scale));
});

test('描けたページは onDrawn で知らせる', async (t) => {
  const { shell, thumbs } = await createThumbShell(t);
  const seen = [];
  thumbs.onDrawn((page) => seen.push(page));
  await thumbs.open(A);
  thumbs.want([3, 1], { cap: 72 });
  await settle(shell);
  assert.deepEqual(seen.sort(), [1, 3]);
});

test('畳むと全部手放して文書を閉じ、広げると読み直す。書き換わっていなければ changed は false', async (t) => {
  const { shell, pdfjs, thumbs } = await createThumbShell(t);
  await thumbs.open(A);
  thumbs.want([0, 1], { cap: 72 });
  await settle(shell);
  pdfjs.cleanups.length = 0;
  await thumbs.fold();
  assert.equal(pdfjs.documents[0].destroyed, true);
  assert.deepEqual([...pdfjs.cleanups].sort(), [1, 2]);
  assert.equal(thumbs.getState().folded, true);
  assert.deepEqual(structuredClone(await thumbs.unfold()), { ok: true, changed: false, pageCount: 6, previousPageCount: 6 });
  assert.equal(pdfjs.documents.length, 2);
  assert.equal(pdfjs.documents[1].destroyed, false);
  assert.equal(thumbs.getState().folded, false);
});

test('畳んでいる間に書き換わっていれば changed、ページ数が変わっていればそれも返す（確定事項D7）', async (t) => {
  const { shell, sizes, thumbs } = await createThumbShell(t);
  await thumbs.open(A);
  await thumbs.fold();
  shell.files[A] = makeSource({ path: A, size: 4096, mtimeMs: 2 });
  sizes.push(A4, A4);
  assert.deepEqual(structuredClone(await thumbs.unfold()), { ok: true, changed: true, pageCount: 8, previousPageCount: 6 });
});

test('isChanged は読まずに大きさと更新日時だけを照らす', async (t) => {
  const { shell, pdfjs, thumbs } = await createThumbShell(t);
  await thumbs.open(A);
  assert.equal(await thumbs.isChanged(), false);
  shell.files[A] = makeSource({ path: A, mtimeMs: 9 });
  assert.equal(await thumbs.isChanged(), true);
  assert.equal(pdfjs.documents.length, 1, '読み直さない');
});

test('別のファイルを開くと前の文書を閉じる。読んでいる途中で替わったら、遅れて開いた文書も閉じる', async (t) => {
  const { pdfjs, thumbs } = await createThumbShell(t);
  const first = thumbs.open(A);
  const second = thumbs.open(B);
  const results = await Promise.all([first, second]);
  assert.equal(results[1].pageCount, 6);
  assert.equal(thumbs.getState().path, B);
  assert.equal(pdfjs.documents.filter((document) => !document.destroyed).length, 1);
  thumbs.close();
  await Promise.resolve();
  assert.equal(pdfjs.documents.every((document) => document.destroyed), true);
  assert.equal(thumbs.getState().open, false);
});

test('パスワード付きの PDF は聞かずに断り、文書を閉じる', async (t) => {
  const { pdfjs, thumbs } = await createThumbShell(t, { password: 'secret' });
  assert.deepEqual(structuredClone(await thumbs.open(A)), { reason: 'encrypted', error: '保存できない PDF です（パスワード付き）' });
  assert.equal(thumbs.getState().open, false);
  assert.equal(pdfjs.passwordAttempts.length, 0);
});
