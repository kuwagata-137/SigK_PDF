'use strict';

// シートの画像を作る前後の純粋な部分（docs/spec-7-7-print-dialog.md）。
// renderer/print-page-region.js（ページの部分を PDF の座標の箱に直す）・print-comments.js（注釈とフォーム(M) の隠し方）・
// print-summary.js（注釈の一覧(T) の一覧ページ）・print-send.js（送る順番と用紙の指定）。画素そのものは起動確認で見る。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/print-page-region.js');
require('../renderer/print-comments.js');
require('../renderer/print-summary.js');
require('../renderer/print-send.js');

const SigK = globalThis.SigK;
const region = SigK.printPageRegion;

// ---- ページの部分（print-page-region.js） ----

const VIEW = [0, 0, 600, 800];
const TOP_LEFT_QUARTER = { x: 0, y: 0, width: 0.5, height: 0.5 };

test('回転なしのページの左上の 4 分の 1 は、PDF の座標では上半分の左（y は下から上）', () => {
  assert.deepEqual(region.regionBox(VIEW, 0, TOP_LEFT_QUARTER), [0, 400, 300, 800]);
  assert.deepEqual(region.regionBox([100, 50, 700, 850], 0, region.FULL), [100, 50, 700, 850]);
});

test('回したページの見た目の左上の 4 分の 1 を、回転を外した PDF の座標に直す（pdf.js の viewport と同じ向き）', () => {
  // 90 度: 見た目の左上は PDF の左下。見た目の横は PDF の上向き、見た目の縦は PDF の右向き。
  assert.deepEqual(region.regionBox(VIEW, 90, TOP_LEFT_QUARTER), [0, 0, 300, 400]);
  // 180 度: 見た目の左上は PDF の右下。
  assert.deepEqual(region.regionBox(VIEW, 180, TOP_LEFT_QUARTER), [300, 0, 600, 400]);
  // 270 度: 見た目の左上は PDF の右上。
  assert.deepEqual(region.regionBox(VIEW, 270, TOP_LEFT_QUARTER), [300, 400, 600, 800]);
  assert.deepEqual(region.regionBox(VIEW, -90, TOP_LEFT_QUARTER), region.regionBox(VIEW, 270, TOP_LEFT_QUARTER));
});

test('割合の範囲の中の範囲（現在の表示範囲の中のタイル）', () => {
  assert.deepEqual(region.within({ x: 0.5, y: 0.2, width: 0.5, height: 0.4 }, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }), { x: 0.75, y: 0.4, width: 0.25, height: 0.2 });
});

test('用紙に入る部分と、それがページのどの範囲か（回したページは元の向きの範囲に直す）', () => {
  const sheet = { width: 210000, height: 297000 };
  const item = { x: -10000, y: 0, width: 100000, height: 50000, rotation: 0, clip: null };
  const { dest, part } = region.visiblePart(item, sheet);
  assert.deepEqual(dest, { x: 0, y: 0, width: 90000, height: 50000 });
  assert.deepEqual(part, { x: 0.1, y: 0, width: 0.9, height: 1 });
  // 時計回りに 90 度回して置いたページの、枠の右半分は、ページの上半分。
  const turned = { x: 0, y: 0, width: 100000, height: 50000, rotation: 90, clip: { x: 50000, y: 0, width: 50000, height: 50000 } };
  assert.deepEqual(region.visiblePart(turned, sheet).part, { x: 0, y: 0, width: 1, height: 0.5 });
  assert.equal(region.visiblePart({ x: 300000, y: 0, width: 10, height: 10, rotation: 0, clip: null }, sheet), null);
});

// ---- 注釈とフォーム(M)（print-comments.js） ----

const ANNOTS = [
  { id: '10R', subtype: 'Widget' }, { id: '11R', subtype: 'Highlight' }, { id: '12R', subtype: 'Stamp' },
  { id: '13R', subtype: 'Link' }, { id: '14R', subtype: 'Popup' }, { id: '15R', subtype: 'FreeText' },
];

test('隠す注釈: 文書は書き込みすべて、文書とスタンプはスタンプ以外、文書と注釈は無し。フォーム・リンク・ポップアップは隠さない', () => {
  const comments = SigK.printComments;
  assert.deepEqual(comments.idsToHide(ANNOTS, 'markups'), []);
  assert.deepEqual(comments.idsToHide(ANNOTS, 'document'), ['11R', '12R', '15R']);
  assert.deepEqual(comments.idsToHide(ANNOTS, 'stamps'), ['11R', '15R']);
  assert.deepEqual(comments.idsToHide(ANNOTS, 'forms'), ['11R', '12R', '15R']);
});

// pdf.js の AnnotationStorage と同じ口（getRawValue・setValue は中身を混ぜる・remove）。
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([key, value]) => [key, { ...value }]));
  return {
    map,
    getRawValue: (key) => map.get(key),
    setValue: (key, value) => map.set(key, { ...(map.get(key) ?? {}), ...value }),
    remove: (key) => map.delete(key),
  };
}

test('描いている間だけ noView で隠し、描き終えたら元に戻す（もともと noView の自前の書き込みは触らない）', async () => {
  const storage = fakeStorage({ '11R': { noView: true }, '15R': { value: 'x' } });
  let during = null;
  await SigK.printComments.withHidden(storage, ['11R', '12R', '15R'], async () => {
    during = Object.fromEntries([...storage.map].map(([key, value]) => [key, { ...value }]));
  });
  assert.deepEqual(during, { '11R': { noView: true }, '15R': { value: 'x', noView: true }, '12R': { noView: true } });
  assert.deepEqual(Object.fromEntries(storage.map), { '11R': { noView: true }, '15R': { value: 'x', noView: undefined } });
});

test('描く途中で失敗しても元に戻す', async () => {
  const storage = fakeStorage();
  await assert.rejects(SigK.printComments.withHidden(storage, ['12R'], async () => { throw new Error('描けない'); }));
  assert.equal(storage.map.size, 0);
});

// ---- 注釈の一覧(T)（print-summary.js） ----

test('PDF の日付を「年/月/日 時:分:秒」にする', () => {
  assert.equal(SigK.printSummary.formatPdfDate("D:20261113102030+09'00'"), '2026/11/13 10:20:30');
  assert.equal(SigK.printSummary.formatPdfDate('D:2026'), '2026/01/01 00:00:00');
  assert.equal(SigK.printSummary.formatPdfDate('不明'), null);
});

test('本文は全角 1 字・半角 0.55 字で数えて折り返す', () => {
  assert.deepEqual(SigK.printSummary.wrap('あいうえお', 2), ['あい', 'うえ', 'お']);
  assert.deepEqual(SigK.printSummary.wrap('abcd\nえ', 1.2), ['ab', 'cd', 'え']);
});

test('書き込みのあるページの後ろに、同じ大きさの一覧ページを入れる', () => {
  SigK.annotationIndex = { labelOf: (entry) => ({ note: 'ノート', highlight: 'ハイライト' })[entry.kind] };
  const entries = {
    2: [
      { kind: 'highlight', rect: [0, 0, 10, 100], text: '' },
      { kind: 'note', rect: [0, 0, 10, 700], text: '確認してください', author: '試験 太郎', ref: '9R' },
    ],
  };
  const pages = SigK.printSummary.withSummaries([{ number: 1, width: 595, height: 842 }, { number: 2, width: 595, height: 842 }], {
    fileName: '見本.pdf',
    entriesOf: (number) => entries[number] ?? [],
    detailsOf: () => ({ '9R': { date: '2026/11/13 10:20:30' } }),
  });
  assert.deepEqual(pages.map((page) => [page.number, Array.isArray(page.summary)]), [[1, false], [2, false], [2, true]]);
  assert.equal(pages[2].width, 595);
  const text = pages[2].summary.map((line) => line.text);
  assert.deepEqual(text.slice(0, 2), ['注釈の一覧 :見本.pdf', 'ページ :2']);
  // 紙の上から順（ノートが上）。作成者と日付は分かる時だけ書く。
  assert.equal(text[3], '番号 : 1 作成者 : 試験 太郎 タイトル : ノート 日付 : 2026/11/13 10:20:30');
  assert.equal(text[4], '確認してください');
  assert.equal(text[6], '番号 : 2 タイトル : ハイライト');
});

test('一覧ページに収まらない行は、次の一覧ページに送る', () => {
  const lines = Array.from({ length: 100 }, (_v, i) => ({ text: String(i), size: 10, indent: 0 }));
  // 842 pt の高さから上下の余白 54 pt を引き、行の高さ 15 pt で割ると 48 行。
  assert.deepEqual(SigK.printSummary.paginate(lines, 842).map((chunk) => chunk.length), [48, 48, 4]);
});

// ---- 送る順番と用紙の指定（print-send.js） ----

test('部単位で 2 部以上を、用紙サイズで分けた印刷で送る時は、1 部ずつ全部を送る', () => {
  const jobs = [{ name: 'A4' }, { name: 'A3' }];
  const order = (options) => SigK.printSend.sendOrder(jobs, options).map((entry) => `${entry.job.name}x${entry.copies}`);
  assert.deepEqual(order({ copies: 2, collate: true }), ['A4x1', 'A3x1', 'A4x1', 'A3x1']);
  assert.deepEqual(order({ copies: 2, collate: false }), ['A4x2', 'A3x2']);
  assert.deepEqual(SigK.printSend.sendOrder([jobs[0]], { copies: 3, collate: true }).map((entry) => entry.copies), [3]);
});

test('用紙がプリンターの既定と同じ時は用紙を指定しない。違う時は縦の寸法（µm）で指定する', () => {
  const A4 = { width: 210000, height: 297000 };
  const options = { deviceName: '試験用プリンター', collate: true, color: false, duplexMode: 'longEdge', defaultPaper: A4 };
  assert.deepEqual(SigK.printSend.printOptions({ paper: A4 }, 2, options), {
    silent: true, deviceName: '試験用プリンター', copies: 2, collate: true, color: false, duplexMode: 'longEdge', landscape: false,
  });
  assert.deepEqual(SigK.printSend.printOptions({ paper: { width: 297000, height: 420000 } }, 1, options).pageSize, { width: 297000, height: 420000 });
});
