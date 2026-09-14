'use strict';

// 画像→PDF の計画（spec-3-1 確定事項11〜15・20・21）。純関数なので jsdom を要さない。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/paper-size.js');
require('../renderer/convert-plan.js');

const { MAX_INPUTS, planPage, describePage, stem, outputNames, duplicateNames, defaultSingleName, totalPages, planConvert } = globalThis.SigK.convertPlan;

const A4 = { width: 595.28, height: 841.89 };
const round = (value) => Math.round(value * 100) / 100;
const WIDE = { width: 1200, height: 800 };
const TALL = { width: 600, height: 900 };

// ---- 紙と箱（確定事項10〜15） ----

test('A4・自動・標準余白: 横長の画像は横向きの紙に 20mm の箱', () => {
  const planned = planPage(WIDE, { paper: 'a4', orientation: 'auto', margin: 'normal' });
  assert.deepEqual(planned.page, { width: A4.height, height: A4.width });
  assert.equal(planned.orientation, 'landscape');
  const m = globalThis.SigK.paperSize.mmToPt(20);
  assert.equal(round(planned.box.x), 56.69);
  assert.equal(round(planned.box.y), 56.69);
  assert.equal(round(planned.box.width), round(A4.height - 2 * m));
  assert.equal(round(planned.box.height), round(A4.width - 2 * m));
  assert.equal(planned.allowUpscale, true, '用紙指定では拡大する（ユーザー確定④）');
});

test('縦長は縦向き。余白なしなら箱は紙いっぱい', () => {
  const planned = planPage(TALL, { paper: 'a4', orientation: 'auto', margin: 'none' });
  assert.deepEqual(planned.page, A4);
  assert.deepEqual(planned.box, { x: 0, y: 0, ...A4 });
});

test('向きの指定は画像の縦横より優先する', () => {
  assert.equal(planPage(WIDE, { paper: 'b5', orientation: 'portrait', margin: 'narrow' }).page.width, 515.91);
  assert.equal(planPage(TALL, { paper: 'letter', orientation: 'landscape', margin: 'narrow' }).page.width, 792);
});

test('画像サイズに合わせる: 1px = 1pt、余白は無視、拡大しない', () => {
  const planned = planPage(WIDE, { paper: 'image', orientation: 'portrait', margin: 'normal' });
  assert.deepEqual(planned.page, { width: 1200, height: 800 });
  assert.deepEqual(planned.box, { x: 0, y: 0, width: 1200, height: 800 });
  assert.equal(planned.allowUpscale, false);
});

test('不正な値と読めない寸法は誤り', () => {
  assert.match(planPage(WIDE, { paper: 'a5', orientation: 'auto', margin: 'normal' }).error, /用紙/);
  assert.match(planPage(WIDE, { paper: 'a4', orientation: 'flip', margin: 'normal' }).error, /向き/);
  assert.match(planPage(WIDE, { paper: 'a4', orientation: 'auto', margin: 'huge' }).error, /余白/);
  assert.match(planPage({ width: 0, height: 10 }, { paper: 'a4', orientation: 'auto', margin: 'normal' }).error, /大きさ/);
  assert.match(planPage(null, { paper: 'a4', orientation: 'auto', margin: 'normal' }).error, /大きさ/);
});

test('行に出す「この紙」', () => {
  assert.equal(describePage(planPage(WIDE, { paper: 'a4', orientation: 'auto', margin: 'normal' }), 'a4'), 'A4 横');
  assert.equal(describePage(planPage(TALL, { paper: 'letter', orientation: 'auto', margin: 'normal' }), 'letter'), 'レター 縦');
  assert.equal(describePage(planPage(WIDE, { paper: 'image', orientation: 'auto', margin: 'normal' }), 'image'), '1200×800 pt');
  assert.equal(describePage({ error: 'x' }, 'a4'), '');
});

// ---- ファイル名（確定事項19〜21） ----

test('拡張子を落とす。大文字も受ける', () => {
  assert.equal(stem('photo.jpg'), 'photo');
  assert.equal(stem('scan.PNG'), 'scan');
  assert.equal(stem('a.b.jpeg'), 'a.b');
  assert.equal(stem('noext'), 'noext');
  assert.deepEqual(['x.bmp', 'x.gif', 'x.tif', 'x.TIFF'].map(stem), ['x', 'x', 'x', 'x'], 'spec-3-2 確定事項32');
  assert.deepEqual(outputNames([{ name: 'a.jpg' }, { name: 'b.png' }]), ['a.pdf', 'b.pdf']);
  assert.equal(defaultSingleName([{ name: 'IMG_4021.jpg' }]), 'IMG_4021.pdf');
  assert.equal(defaultSingleName([]), 'images.pdf');
});

test('同じ出力名になる組を見つける（大文字小文字は区別しない）', () => {
  assert.deepEqual(duplicateNames(['a.pdf', 'b.pdf']), []);
  assert.deepEqual(duplicateNames(['a.pdf', 'A.pdf', 'b.pdf', 'a.pdf']), ['A.pdf', 'a.pdf']);
});

// ---- 計画（確定事項15・20） ----

const row = (name, pixels, extra = {}) => ({ name, width: pixels.width, height: pixels.height, pending: false, blocked: null, ...extra });
const SETTINGS = { paper: 'a4', orientation: 'auto', margin: 'normal', output: 'single' };

test('行が無い・読んでいる途中・読めない行があれば ready にならない', () => {
  assert.deepEqual(planConvert([], SETTINGS), { ready: false, error: null });
  assert.deepEqual(planConvert([row('a.jpg', WIDE, { pending: true })], SETTINGS), { ready: false, error: null });
  assert.deepEqual(planConvert([row('a.jpg', WIDE), row('b.gif', { width: 0, height: 0 }, { blocked: 'GIF はまだ' })], SETTINGS), { ready: false, error: null });
});

test('組めれば行ごとの紙と箱、出力名を返す', () => {
  const planned = planConvert([row('a.jpg', WIDE), row('b.png', TALL)], SETTINGS);
  assert.equal(planned.ready, true);
  assert.equal(planned.pages.length, 2);
  assert.equal(planned.totalPages, 2);
  assert.deepEqual(planned.pages[0].map((layout) => layout.page), [{ width: A4.height, height: A4.width }]);
  assert.deepEqual(planned.pages[1].map((layout) => layout.page), [A4]);
  assert.deepEqual(planned.names, ['a.pdf', 'b.pdf']);
});

test('複数ページの TIFF はページごとに紙を決め、ページ数で数える（spec-3-2 確定事項30）', () => {
  const scan = row('scan.tif', WIDE, { frames: [WIDE, TALL, { width: 64, height: 64 }] });
  const planned = planConvert([scan, row('b.png', TALL)], SETTINGS);
  assert.equal(planned.ready, true);
  assert.equal(planned.totalPages, 4);
  assert.deepEqual(planned.pages[0].map((layout) => layout.page), [{ width: A4.height, height: A4.width }, A4, A4], 'ページごとに向き「自動」が効く');
  assert.equal(planned.pages[1].length, 1);
  assert.equal(totalPages([scan, row('b.png', TALL)]), 4);
  // ファイル数は上限内でも、ページの合計が上限を超えれば組めない
  const long = row('long.tif', WIDE, { frames: Array.from({ length: MAX_INPUTS }, () => WIDE) });
  assert.match(planConvert([long, row('b.png', TALL)], SETTINGS).error, /100 ページまで/);
  assert.equal(planConvert([long], SETTINGS).ready, true, 'ちょうど 100 ページは通る');
});

test('「画像ごと」で出力名が衝突すれば誤り。「まとめる」なら衝突は問わない', () => {
  const rows = [row('a.jpg', WIDE), row('a.png', TALL)];
  assert.equal(planConvert(rows, SETTINGS).ready, true);
  const each = planConvert(rows, { ...SETTINGS, output: 'each' });
  assert.equal(each.ready, false);
  assert.match(each.error, /出力名が重なります: a\.pdf/);
});

test('上限を超えれば誤り', () => {
  const rows = Array.from({ length: MAX_INPUTS + 1 }, (_value, index) => row(`p${index}.jpg`, WIDE));
  assert.match(planConvert(rows, SETTINGS).error, /100 ファイルまで/);
});
