'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

const A = 'C:\\書類\\報告書.pdf';

const FULL_INFO = {
  PDFFormatVersion: '1.7',
  Title: '月次報告',
  Author: '総務課',
  Creator: '作成アプリ名',
  Producer: '変換アプリ名',
  CreationDate: "D:20260831120000+09'00'",
  ModDate: "D:20260901083000+09'00'",
};

async function withShell(t, options = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, size: 2560 }) }, ...options });
  t.after(() => shell.cleanup());
  return shell;
}

async function withDocInfo(t, info = FULL_INFO) {
  const shell = await withShell(t, { pdfjs: createPdfjsStub({ info }) });
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  await shell.SigK.docInfo.open(shell.document);
  return shell;
}

function rows(document) {
  const body = document.getElementById('doc-info-body');
  const labels = [...body.querySelectorAll('dt')].map((el) => el.textContent);
  const values = [...body.querySelectorAll('dd')].map((el) => el.textContent);
  return Object.fromEntries(labels.map((label, i) => [label, values[i]]));
}

// ---- 整形（純関数） ----

test('PDF の日付を年月日と時分まで出す', async (t) => {
  const { SigK } = await withShell(t);

  assert.equal(SigK.docInfo.formatPdfDate("D:20260831120000+09'00'"), '2026-08-31 12:00');
  assert.equal(SigK.docInfo.formatPdfDate('D:20260831120000Z'), '2026-08-31 12:00');
  // 途中までしか無い日付も読む。PDF の仕様では年だけでも正しい。
  assert.equal(SigK.docInfo.formatPdfDate('D:2026'), '2026-01-01 00:00');
  assert.equal(SigK.docInfo.formatPdfDate('D:202608'), '2026-08-01 00:00');
});

test('読めない日付は元の文字列のまま見せる', async (t) => {
  const { SigK } = await withShell(t);

  assert.equal(SigK.docInfo.formatPdfDate('2026年8月31日'), '2026年8月31日');
  assert.equal(SigK.docInfo.formatPdfDate(''), SigK.docInfo.UNKNOWN);
  assert.equal(SigK.docInfo.formatPdfDate(undefined), SigK.docInfo.UNKNOWN);
  assert.equal(SigK.docInfo.formatPdfDate(20260831), SigK.docInfo.UNKNOWN);
});

test('暗号化は採用されたフィルター名で判定する', async (t) => {
  const { SigK } = await withShell(t);

  assert.equal(SigK.docInfo.describeEncryption({ EncryptFilterName: 'Standard' }), 'あり（Standard）');
  assert.equal(SigK.docInfo.describeEncryption({}), 'なし');
  assert.equal(SigK.docInfo.describeEncryption(null), 'なし');
  assert.equal(SigK.docInfo.describeEncryption({ EncryptFilterName: '' }), 'なし');
});

test('取れない項目は埋めずに「—」を出す', async (t) => {
  const { SigK } = await withShell(t);
  const built = SigK.docInfo.buildRows({ file: { name: 'a.pdf' }, pageCount: 3, info: {} });
  const table = Object.fromEntries([...built].map(([label, value]) => [label, value]));

  assert.equal(table['ファイル名'], 'a.pdf');
  assert.equal(table['ページ数'], '3 ページ');
  assert.equal(table['場所'], SigK.docInfo.UNKNOWN);
  assert.equal(table['ファイルサイズ'], SigK.docInfo.UNKNOWN);
  assert.equal(table['PDF バージョン'], SigK.docInfo.UNKNOWN);
  assert.equal(table['タイトル'], SigK.docInfo.UNKNOWN);
  assert.equal(table['作成日時'], SigK.docInfo.UNKNOWN);
  assert.equal(table['暗号化'], 'なし');
});

test('空白だけの項目も未取得として扱う', async (t) => {
  const { SigK } = await withShell(t);
  const built = SigK.docInfo.buildRows({ file: { name: 'a.pdf' }, pageCount: 1, info: { Title: '   ' } });
  const table = Object.fromEntries([...built].map(([label, value]) => [label, value]));

  assert.equal(table['タイトル'], SigK.docInfo.UNKNOWN);
});

// ---- 画面 ----

test('文書情報を開くと、値が並んだモーダルが出る', async (t) => {
  const { document } = await withDocInfo(t);
  const table = rows(document);

  assert.equal(document.getElementById('doc-info').hasAttribute('open'), true);
  assert.equal(table['ファイル名'], '報告書.pdf');
  assert.equal(table['場所'], A);
  assert.equal(table['ページ数'], '3 ページ');
  assert.equal(table['ファイルサイズ'], '2.5 KB');
  assert.equal(table['PDF バージョン'], '1.7');
  assert.equal(table['タイトル'], '月次報告');
  assert.equal(table['作成者'], '総務課');
  assert.equal(table['作成日時'], '2026-08-31 12:00');
  assert.equal(table['更新日時'], '2026-09-01 08:30');
  assert.equal(table['暗号化'], 'なし');
});

test('閉じるボタンでモーダルが閉じる', async (t) => {
  const { document } = await withDocInfo(t);

  document.getElementById('doc-info-close').dispatchEvent(
    new document.defaultView.MouseEvent('click', { bubbles: true }),
  );
  assert.equal(document.getElementById('doc-info').hasAttribute('open'), false);
});

test('ステータスバーのファイル名から開ける', async (t) => {
  const shell = await withShell(t, { pdfjs: createPdfjsStub({ info: FULL_INFO }) });
  await shell.SigK.tabs.openPath(A);
  await shell.flush();

  shell.document.getElementById('status-file').dispatchEvent(
    new shell.window.MouseEvent('click', { bubbles: true }),
  );
  await shell.flush();

  assert.equal(shell.document.getElementById('doc-info').hasAttribute('open'), true);
});

test('メニューの合図からも開ける', async (t) => {
  const shell = await withShell(t, { pdfjs: createPdfjsStub({ info: FULL_INFO }) });
  await shell.SigK.tabs.openPath(A);
  await shell.flush();

  shell.fireDocInfoRequest();
  await shell.flush();

  assert.equal(shell.document.getElementById('doc-info').hasAttribute('open'), true);
});

test('文書が開いていなければ、文書情報は出さない', async (t) => {
  const shell = await withShell(t);

  const opened = await shell.SigK.docInfo.open(shell.document);

  assert.equal(opened, false);
  assert.equal(shell.document.getElementById('doc-info').hasAttribute('open'), false);
});

test('切り替えたタブの情報を出す', async (t) => {
  const B = 'C:\\書類\\見積書.pdf';
  const shell = await withShell(t, {
    pdfjs: createPdfjsStub({ info: FULL_INFO }),
    files: {
      [A]: makeSource({ path: A, size: 2560 }),
      [B]: makeSource({ path: B, size: 5120 }),
    },
  });
  await shell.SigK.tabs.openPath(A);
  await shell.SigK.tabs.openPath(B);
  await shell.flush();

  await shell.SigK.docInfo.open(shell.document);
  assert.equal(rows(shell.document)['ファイル名'], '見積書.pdf');

  shell.SigK.tabs.activate(shell.SigK.tabs.list()[0].id);
  await shell.flush();
  await shell.SigK.docInfo.open(shell.document);
  assert.equal(rows(shell.document)['ファイル名'], '報告書.pdf');
});

test('メタデータが読めなくても、名前とページ数は出す', async (t) => {
  const shell = await withShell(t);
  await shell.SigK.tabs.openPath(A);
  await shell.flush();

  // pdf.js 側が投げる状況を作る。
  const state = shell.SigK.viewer.getState();
  assert.equal(state.open, true);
  shell.SigK.viewer.getMetadata = () => Promise.reject(new Error('メタデータなし'));

  await shell.SigK.docInfo.open(shell.document);
  const table = rows(shell.document);

  assert.equal(table['ファイル名'], '報告書.pdf');
  assert.equal(table['ページ数'], '3 ページ');
  assert.equal(table['PDF バージョン'], shell.SigK.docInfo.UNKNOWN);
  assert.equal(shell.logs.length, 1, '読めなかったことはログへ残す');
});
