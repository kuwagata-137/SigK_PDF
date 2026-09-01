'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/print.js');
const print = globalThis.SigK.print;

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// 印刷（spec-1-4 E）。
//
// 前半はページ範囲の解釈だけを見る。DOM も pdf.js も要らない。
// 後半はダイアログの経路で、実際に紙へ送る手前までを確かめる。
// jsdom には 2D コンテキストが無いので画像そのものは作れない。寸法と枚数までを
// ここで見て、PNG のバイト数と見た目は起動確認（SIGK_SMOKE_PRINT）に残す。

// ---- ページ範囲の解釈（確定事項34・35）----

test('「1-5, 8」を6ページとして読む', () => {
  assert.deepEqual(print.parsePageList('1-5, 8', 10), { pages: [1, 2, 3, 4, 5, 8] });
});

test('全角のカンマ・ハイフン・数字も受け付ける', () => {
  assert.deepEqual(print.parsePageList('１－３，７', 10), { pages: [1, 2, 3, 7] });
  // 読点と各種ダッシュも同じ扱いにする。
  assert.deepEqual(print.parsePageList('1—2、5', 10), { pages: [1, 2, 5] });
});

test('重なった指定はまとめ、順に並べ直す', () => {
  assert.deepEqual(print.parsePageList('5,1-3,2', 10), { pages: [1, 2, 3, 5] });
});

test('逆順の範囲は理由を返す', () => {
  const result = print.parsePageList('5-1', 10);

  assert.equal(result.pages, undefined);
  assert.match(result.error, /終わりのページが始まりより前/);
});

test('範囲外のページは理由を返す', () => {
  assert.match(print.parsePageList('0-3', 10).error, /1 〜 10 の範囲/);
  assert.match(print.parsePageList('9-12', 10).error, /1 〜 10 の範囲/);
});

test('数字でないものは理由を返す', () => {
  assert.match(print.parsePageList('あ', 10).error, /数字で指定/);
  assert.match(print.parsePageList('1-2-3', 10).error, /数字で指定/);
  assert.match(print.parsePageList('1,,2', 10).error, /読み取れません/);
});

test('空の指定は理由を返す', () => {
  assert.match(print.parsePageList('', 10).error, /指定してください/);
  assert.match(print.parsePageList('   ', 10).error, /指定してください/);
});

// ---- 範囲の解決と上限（確定事項33）----

test('「すべてのページ」は1からページ数までを返す', () => {
  assert.deepEqual(print.resolvePages({ mode: 'all', pageCount: 3 }), { pages: [1, 2, 3] });
});

test('「現在のページ」は0起点の現在位置を1起点へ直す', () => {
  assert.deepEqual(print.resolvePages({ mode: 'current', pageCount: 5, current: 2 }), { pages: [3] });
  assert.deepEqual(print.resolvePages({ mode: 'current', pageCount: 5, current: 0 }), { pages: [1] });
  // 範囲の外にいることは無いはずだが、外へはみ出させない。
  assert.deepEqual(print.resolvePages({ mode: 'current', pageCount: 2, current: 9 }), { pages: [2] });
});

test('100ページを超える指定は印刷しない', () => {
  assert.equal(print.MAX_PAGES, 100);
  assert.equal(print.resolvePages({ mode: 'all', pageCount: 100 }).pages.length, 100);

  const over = print.resolvePages({ mode: 'all', pageCount: 101 });
  assert.equal(over.pages, undefined);
  assert.match(over.error, /100 ページまで/);
  assert.match(print.resolvePages({ mode: 'custom', text: '1-200', pageCount: 300 }).error, /100 ページまで/);
});

test('文書が開かれていなければ理由を返す', () => {
  assert.match(print.resolvePages({ mode: 'all', pageCount: 0 }).error, /文書が開かれていません/);
});

test('150dpi 相当の倍率を持つ', () => {
  assert.equal(print.PRINT_DPI, 150);
  assert.equal(print.PRINT_SCALE, 150 / 72);
});

// ---- ダイアログの経路 ----

async function withDocument(t, options = {}) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  await shell.SigK.viewer.open(makeSource({ path: 'C:\\work\\a.pdf' }));
  await shell.flush();
  return shell;
}

test('文書を開いていなければ印刷ダイアログは開かない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());

  assert.equal(shell.SigK.print.open(), false);
  assert.equal(shell.document.getElementById('print-dialog').hasAttribute('open'), false);
});

test('印刷ダイアログは「すべてのページ」で開く', async (t) => {
  const { SigK, document } = await withDocument(t);

  assert.equal(SigK.print.open(), true);
  assert.equal(document.getElementById('print-mode-all').checked, true);
  assert.equal(document.getElementById('print-pages').value, '');
  assert.equal(document.getElementById('print-error').hidden, true);
});

test('ページを画像にする準備が、指定した枚数だけ走る', async (t) => {
  const { SigK } = await withDocument(t);
  SigK.print.open();

  const result = await SigK.print.prepare({ mode: 'custom', text: '1,3' });

  assert.equal(result.ok, true);
  assert.deepEqual([...result.pages], [1, 3]);
  assert.equal(result.images.length, 2);
  // A4 を 150dpi で描くと 1240×1754px になる（確定事項31・32）。
  assert.deepEqual({ ...result.images[0] }, { width: 1240, height: 1754, bytes: 0 });
});

test('範囲がおかしければ、押す前にダイアログの中で理由が出る', async (t) => {
  const { SigK, document } = await withDocument(t);
  SigK.print.open();

  const result = await SigK.print.prepare({ mode: 'custom', text: '9-1' });

  assert.equal(result.ok, undefined);
  assert.equal(document.getElementById('print-error').hidden, false);
  assert.match(document.getElementById('print-error').textContent, /終わりのページが始まりより前/);
});

test('中止すると準備は無効になり、作りかけを残さない', async (t) => {
  const sizes = Array.from({ length: 12 }, () => A4);
  const { SigK, document } = await withDocument(t, { pdfjs: createPdfjsStub({ sizes }) });
  SigK.print.open();

  const pending = SigK.print.prepare({ mode: 'all' });
  // 準備の途中で閉じる。世代が上がるので、飛んでいる分は捨てられる。
  SigK.print.close();
  const result = await pending;

  assert.equal(result.canceled, true);
  assert.equal(document.querySelectorAll('#print-area img').length, 0);
  assert.equal(SigK.print.isBusy(), false);
});

test('印刷を実行するとメイン側へ渡り、ダイアログが閉じる', async (t) => {
  const shell = await withDocument(t);
  shell.SigK.print.open();

  const result = await shell.SigK.print.run({ mode: 'current' });

  assert.equal(result.ok, true);
  assert.equal(shell.printCalls.length, 1);
  assert.deepEqual({ ...shell.printCalls[0] }, { silent: false });
  assert.equal(shell.document.getElementById('print-dialog').hasAttribute('open'), false);
  assert.equal(shell.document.querySelectorAll('#print-area img').length, 0);
});

test('印刷が失敗したら理由をダイアログに残す', async (t) => {
  const shell = await withDocument(t, { printResult: { ok: false, canceled: false, reason: 'プリンタが見つかりません' } });
  shell.SigK.print.open();

  await shell.SigK.print.run({ mode: 'current' });

  const error = shell.document.getElementById('print-error');
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /プリンタが見つかりません/);
  assert.equal(shell.document.getElementById('print-dialog').hasAttribute('open'), true, '直せるように開いたままにする');
});

test('printAPI が無くても落ちない', async (t) => {
  const shell = await withDocument(t);
  delete shell.window.printAPI;
  shell.SigK.print.open();

  const result = await shell.SigK.print.run({ mode: 'current' });

  assert.match(result.error, /印刷の機能が使えません/);
  assert.match(shell.document.getElementById('print-error').textContent, /印刷の機能が使えません/);
});

// 開いている <dialog> に showModal() をもう一度呼ぶと InvalidStateError になる。
test('印刷ダイアログを続けて開いても落ちない', async (t) => {
  const { SigK, document } = await withDocument(t);

  assert.equal(SigK.print.open(), true);
  document.getElementById('print-mode-custom').checked = true;
  assert.equal(SigK.print.open(), true, '2度目も落ちない');
  // 開き直しでも中身は初期状態へ戻す。
  assert.equal(document.getElementById('print-mode-all').checked, true);
  assert.equal(document.getElementById('print-dialog').hasAttribute('open'), true);
});

test('Ctrl+P で印刷ダイアログが開く', async (t) => {
  const shell = await withDocument(t);

  shell.document.dispatchEvent(new shell.window.KeyboardEvent('keydown', {
    key: 'p', ctrlKey: true, bubbles: true, cancelable: true,
  }));

  assert.equal(shell.document.getElementById('print-dialog').hasAttribute('open'), true);
});

test('ツールバーの印刷ボタンは文書を開くまで押せない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const button = shell.document.getElementById('btn-print');

  assert.equal(button.getAttribute('aria-disabled'), 'true');
  button.dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(shell.document.getElementById('print-dialog').hasAttribute('open'), false);

  await shell.SigK.viewer.open(makeSource());
  await shell.flush();
  assert.equal(button.hasAttribute('aria-disabled'), false);
  button.dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(shell.document.getElementById('print-dialog').hasAttribute('open'), true);
});
