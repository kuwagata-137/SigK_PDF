'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-range.js');
require('../renderer/split-plan.js');
require('../renderer/image-export-plan.js');
const plan = globalThis.SigK.imageExportPlan;

// PDF→画像の計画を組む純関数（spec-3-3 確定事項6〜11）。画面には触らない。

const A4 = { width: 595.28, height: 841.89 };
const A1 = { width: 1683.78, height: 2383.94 };

function source({ pageCount = 12, sizes = null, name = 'report.pdf' } = {}) {
  return { name, pageCount, sizes: sizes ?? Array.from({ length: pageCount }, () => A4), pending: false, blocked: null };
}

// ---- 解像度と画素数（確定事項7・9）----

test('dpi は 72・150・300 の 3 択で、既定は 150。scale は dpi / 72', () => {
  assert.deepEqual(plan.DPI_CHOICES, [72, 150, 300]);
  assert.equal(plan.DEFAULT_DPI, 150);
  assert.equal(plan.scaleFor(150), 150 / 72);
  assert.equal(plan.scaleFor(72), 1);
});

test('画素数は viewport と同じ丸めで出す（A4 150dpi = 1240×1754）', () => {
  assert.deepEqual(plan.pixelSizeFor(A4, 150), { width: 1240, height: 1754 });
  assert.deepEqual(plan.pixelSizeFor(A4, 300), { width: 2480, height: 3508 });
  assert.deepEqual(plan.pixelSizeFor(A4, 72), { width: 595, height: 842 });
});

test('画素の上限は 40M。A2 300dpi は入り、A1 300dpi は入らない', () => {
  assert.equal(plan.MAX_PIXELS, 40_000_000);
  const a2 = { width: 1190.55, height: 1683.78 };
  assert.deepEqual(plan.oversizedPages([A4, a2, A1], [0, 1, 2], 300), [3]);
  assert.deepEqual(plan.oversizedPages([A4, a2, A1], [0, 1, 2], 150), []);
});

// ---- ページの解決（確定事項6・8）----

test('「すべて」は 0 始まりの全ページ', () => {
  assert.deepEqual(plan.resolvePages({ mode: 'all' }, 3), { pages: [0, 1, 2] });
});

test('範囲は page-range.js の記法で読み、重複を畳んで昇順に並べる', () => {
  assert.deepEqual(plan.resolvePages({ mode: 'range', range: '5, 1-3, 2' }, 10), { pages: [0, 1, 2, 4] });
  assert.deepEqual(plan.resolvePages({ mode: 'range', range: '８－' }, 10), { pages: [7, 8, 9] });
});

test('範囲が空ならすべて、読めなければ理由を返す', () => {
  assert.deepEqual(plan.resolvePages({ mode: 'range', range: '' }, 3), { pages: [0, 1, 2] });
  assert.match(plan.resolvePages({ mode: 'range', range: 'あ' }, 3).error, /1-3,5 のように/);
  assert.equal(plan.resolvePages({ mode: 'range', range: 'あ' }, 3).errorKind, 'range');
  assert.match(plan.resolvePages({ mode: 'range', range: '9' }, 3).error, /3ページまで/);
});

test('1 回に書き出せるのは 500 ページまで（分割の MAX_OUTPUTS と同じ）', () => {
  assert.equal(plan.MAX_PAGES, 500);
  assert.equal(plan.MAX_PAGES, globalThis.SigK.splitPlan.MAX_OUTPUTS);
  const result = plan.resolvePages({ mode: 'all' }, 501);
  assert.match(result.error, /500 ページまで/);
  assert.match(result.error, /501 ページが指定/);
  assert.equal(result.errorKind, 'limit');
  assert.equal(plan.resolvePages({ mode: 'all' }, 500).pages.length, 500);
});

// ---- 出力名（確定事項10・11）----

test('出力名は <元の名前>_<ページ番号>.png。桁は総ページ数の桁で最低 3 桁', () => {
  assert.deepEqual(plan.outputNames('report.pdf', [0, 1, 2, 4], 12, 'png'),
    ['report_001.png', 'report_002.png', 'report_003.png', 'report_005.png']);
  assert.deepEqual(plan.outputNames('a.PDF', [0], 5, 'jpeg'), ['a_001.jpg']);
  // 1,000 ページを超えれば 4 桁になる。
  assert.deepEqual(plan.outputNames('big.pdf', [999], 1000, 'png'), ['big_1000.png']);
  assert.deepEqual(plan.outputNames('big.pdf', [0], 1000, 'png'), ['big_0001.png']);
});

test('形式は PNG（既定）と JPEG。JPEG の品質は 0.9 で固定', () => {
  assert.equal(plan.DEFAULT_FORMAT, 'png');
  assert.deepEqual(plan.FORMATS.png, { type: 'image/png', ext: 'png', label: 'PNG' });
  assert.deepEqual(plan.FORMATS.jpeg, { type: 'image/jpeg', ext: 'jpg', label: 'JPEG', quality: 0.9 });
});

// ---- 計画（確定事項6〜11 のまとめ）----

test('対象が無い・読んでいる・読めないなら ready: false で error は null', () => {
  assert.deepEqual(plan.planExport({ mode: 'all', format: 'png', dpi: 150 }, null), { ready: false, error: null });
  assert.deepEqual(plan.planExport({ mode: 'all', format: 'png', dpi: 150 }, { ...source(), pending: true }), { ready: false, error: null });
  assert.deepEqual(plan.planExport({ mode: 'all', format: 'png', dpi: 150 }, { ...source(), blocked: 'だめ' }), { ready: false, error: null });
});

test('組めれば pages・names・画素数・形式・scale が揃う', () => {
  const result = plan.planExport({ mode: 'range', range: '1-3,5', format: 'png', dpi: 150 }, source());

  assert.equal(result.ready, true);
  assert.equal(result.error, null);
  assert.deepEqual(result.pages, [0, 1, 2, 4]);
  assert.deepEqual(result.names, ['report_001.png', 'report_002.png', 'report_003.png', 'report_005.png']);
  assert.deepEqual(result.pixel, { width: 1240, height: 1754 });
  assert.equal(result.format.type, 'image/png');
  assert.equal(result.format.quality, undefined);
  assert.equal(result.dpi, 150);
  assert.equal(result.scale, 150 / 72);
});

test('JPEG なら拡張子が .jpg で品質が付く', () => {
  const result = plan.planExport({ mode: 'all', format: 'jpeg', dpi: 72 }, source({ pageCount: 2 }));

  assert.deepEqual(result.names, ['report_001.jpg', 'report_002.jpg']);
  assert.equal(result.format.quality, 0.9);
  assert.deepEqual(result.pixel, { width: 595, height: 842 });
});

test('範囲の誤り・上限・画素の上限は ready: false と理由', () => {
  const s = source();
  assert.match(plan.planExport({ mode: 'range', range: 'x', format: 'png', dpi: 150 }, s).error, /1-3,5 のように/);
  assert.match(plan.planExport({ mode: 'all', format: 'png', dpi: 150 }, source({ pageCount: 600 })).error, /500 ページまで/);

  const big = source({ pageCount: 3, sizes: [A4, A1, A1] });
  const result = plan.planExport({ mode: 'all', format: 'png', dpi: 300 }, big);
  assert.equal(result.ready, false);
  assert.equal(result.errorKind, 'pixels');
  assert.match(result.error, /2 ページが 300dpi では大きすぎます/);
  assert.match(result.error, /150dpi 以下/);
  // 150dpi なら通る。
  assert.equal(plan.planExport({ mode: 'all', format: 'png', dpi: 150 }, big).ready, true);
});

test('不正な形式・解像度は既定へ寄せずに断る', () => {
  assert.match(plan.planExport({ mode: 'all', format: 'gif', dpi: 150 }, source()).error, /形式/);
  assert.equal(plan.planExport({ mode: 'all', format: 'gif', dpi: 150 }, source()).errorKind, 'settings');
  assert.match(plan.planExport({ mode: 'all', format: 'png', dpi: 96 }, source()).error, /解像度/);
});
