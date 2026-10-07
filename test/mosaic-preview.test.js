'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// モザイクの下見を画面の経路へ通す（spec-4b-6b 確定事項7・9・27）。plan の mosaic を当てると、範囲に重なる行は文字の層で
// 空になり（選択・コピーできない）、検索で当たらず、印刷にはモザイクの並びが渡る。jsdom には 2D コンテキストが無いので、
// 塗りそのものは mosaic-paint.test.js と起動確認が見る。

// 1 ページ目: 「秘密の行」（y 700）と「残る行」（y 600）。2 ページ目にも「秘密の行」がある。
function line(str, y) {
  return { str, transform: [10, 0, 0, 10, 70, y], width: 200, height: 10, fontName: 'F1' };
}

const PAGE_TEXT = [[line('秘密の行', 700), line('残る行', 600)], [line('秘密の行', 700)]];
const MOSAIC = [{ box: [60, 690, 300, 720], block: 8 }];

async function withMosaic(t) {
  const shell = await createShell({ pdfjs: createPdfjsStub({ pageTextItems: PAGE_TEXT, sizes: [{ width: 595, height: 842 }, { width: 595, height: 842 }] }) });
  t.after(() => shell.cleanup());
  await shell.SigK.viewer.open(makeSource({ path: 'C:\\work\\a.pdf' }));
  await shell.flush();
  const { SigK } = shell;
  SigK.viewer.applyPlan(SigK.pagePlan.editPages(SigK.viewer.getPlan(), new Map([[0, (entry) => ({ ...entry, mosaic: MOSAIC })]])));
  await shell.flush();
  return shell;
}

function spans(document, index) {
  return [...document.querySelectorAll('#view-pages .pdf-page')[index].querySelectorAll('.textLayer span')].map((span) => span.textContent);
}

test('文字の層では、範囲に重なる行の文字が空になり、span の数は変わらない', async (t) => {
  const { document } = await withMosaic(t);
  assert.deepEqual(spans(document, 0), ['', '残る行']);
  assert.deepEqual(spans(document, 1), ['秘密の行']);
});

test('検索は範囲に重なる行で当たらず、ほかのページと範囲の外の行では当たる', async (t) => {
  const { SigK } = await withMosaic(t);
  const secret = await SigK.find.run('秘密の行');
  assert.equal(secret.total, 1);
  // page は 0 始まり（2 ページ目）。
  assert.equal(secret.page, 1);
  assert.equal((await SigK.find.run('残る行')).total, 1);
});

test('モザイクを外すと、文字の層と検索が元に戻る', async (t) => {
  const { SigK, document, flush } = await withMosaic(t);
  await SigK.find.run('秘密の行');
  SigK.viewer.applyPlan(SigK.pagePlan.editPages(SigK.viewer.getPlan(), new Map([[0, (entry) => SigK.pageMosaic.withoutMosaic(entry)]])));
  await flush();
  assert.deepEqual(spans(document, 0), ['秘密の行', '残る行']);
  assert.equal((await SigK.find.run('秘密の行')).total, 2);
});

test('印刷は、そのページのモザイクの並びを描く部品へ渡す', async (t) => {
  const { SigK } = await withMosaic(t);
  const calls = [];
  const original = SigK.pageImage.renderToCanvas;
  SigK.pageImage.renderToCanvas = (doc, page, options) => {
    calls.push(options.mosaic);
    return original(doc, page, options);
  };
  t.after(() => { SigK.pageImage.renderToCanvas = original; });
  SigK.print.open();
  const prepared = await SigK.print.prepare({ mode: 'all' });
  assert.equal(prepared.ok, true);
  // jsdom の中の配列は、こちらの配列と deepEqual で比べられないので、写してから比べる。
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [MOSAIC, null]);
});
