'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub } = require('./harness.js');

// テキストレイヤー（spec-1-3 確定事項17〜27）。
//
// jsdom は CSS を解釈せず、本物の TextLayer は canvas の 2D コンテキストで
// フォントの高さを測るため動かない。ここで確かめるのは「いつ作って、いつ
// 捨てるか」だけである。文字の位置が合っているかは npm start の実測で見る
// （確定事項27）。

function source(overrides = {}) {
  return {
    ok: true,
    path: 'C:\\書類\\three-pages.pdf',
    name: 'three-pages.pdf',
    size: 1463,
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    ...overrides,
  };
}

async function withOpenDocument(t, options = {}) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  await shell.SigK.viewer.open(source());
  await shell.flush();
  return shell;
}

function textLayersIn(document) {
  return [...document.querySelectorAll('.pdf-page .textLayer')];
}

test('描いたページに文字の層が乗る', async (t) => {
  const { document } = await withOpenDocument(t);
  const layers = textLayersIn(document);

  // 見えている範囲の前後1ページまで描く。3ページの文書なら 0・1 の2枚。
  assert.equal(layers.length, 2);
  // ハーネスのスタブが返すテキストは2件。
  assert.equal(layers[0].querySelectorAll('span').length, 2);
  assert.equal(layers[0].textContent, 'あいうえおかきくけこ');
});

// canvas の後ろ＝重なりで上。これが逆だと文字を掴めない（確定事項20）。
test('文字の層はページ枠の中、canvas の後ろに置く', async (t) => {
  const { document } = await withOpenDocument(t);
  const page = document.querySelector('.pdf-page');

  assert.equal(page.lastElementChild.className, 'textLayer');
});

// setLayerDimensions() が round(down, var(--total-scale-factor) * Npx, …) と
// して寸法を書き込む。未定義だと寸法が無効になる（確定事項19）。
test('ページ枠に倍率の CSS 変数が入る', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const page = document.querySelector('.pdf-page');
  const zoom = SigK.viewer.getState().zoom;

  assert.equal(page.style.getPropertyValue('--total-scale-factor'), String(zoom * SigK.viewerLayout.CSS_UNITS));
  assert.equal(page.style.getPropertyValue('--scale-round-x'), '1px');
  assert.equal(page.style.getPropertyValue('--scale-round-y'), '1px');
});

test('倍率を変えると CSS 変数も追従する', async (t) => {
  const { document, SigK, flush } = await withOpenDocument(t);

  SigK.viewer.setZoom(2);
  await flush();
  const page = document.querySelector('.pdf-page');

  assert.equal(page.style.getPropertyValue('--total-scale-factor'), String(2 * SigK.viewerLayout.CSS_UNITS));
});

// 文字の層は canvas と同じ寿命にする（確定事項21）。
test('ページを捨てると文字の層も cancel される', async (t) => {
  const { SigK, pdfjs } = await withOpenDocument(t);

  assert.equal(pdfjs.textLayers.length, 2);
  assert.deepEqual(pdfjs.textLayers.map((layer) => layer.canceled), [false, false]);

  SigK.viewer.close();
  assert.deepEqual(pdfjs.textLayers.map((layer) => layer.canceled), [true, true]);
});

test('倍率を変えると前の文字の層は捨てて作り直す', async (t) => {
  const { SigK, pdfjs, flush } = await withOpenDocument(t);
  const before = [...pdfjs.textLayers];

  SigK.viewer.setZoom(2);
  await flush();

  assert.deepEqual(before.map((layer) => layer.canceled), [true, true], '前の層が残っている');
  assert.ok(pdfjs.textLayers.length > before.length, '作り直していない');
});

// 遅れて届いた層が、もう見ていないページに乗らないこと（確定事項21）。
test('待っている間に文書が変われば貼らない', async (t) => {
  const { document, SigK, pdfjs, flush } = await withOpenDocument(t);
  const openedLayers = pdfjs.textLayers.length;

  // open は世代番号を進める。前の文書のために飛んでいた層は捨てられる。
  await SigK.viewer.open(source({ path: 'C:\\書類\\other.pdf', name: 'other.pdf' }));
  await flush();

  const layers = textLayersIn(document);
  assert.equal(layers.length, 2, '新しい文書の分だけが乗っている');
  assert.deepEqual(
    pdfjs.textLayers.slice(0, openedLayers).map((layer) => layer.canceled),
    [true, true],
    '前の文書の層が生きたまま残っている',
  );
});

// pdf.js を読み込めていない環境でも、絵と枠は出したい。
test('TextLayer が無くてもページの描画は止まらない', async (t) => {
  const { document, logs } = await withOpenDocument(t, { pdfjs: createPdfjsStub({ textItems: null }) });

  assert.equal(document.querySelectorAll('.pdf-page').length, 3);
  assert.equal(textLayersIn(document).length, 0);
  assert.deepEqual(logs, [], '記録すべきでない失敗を記録している');
});
