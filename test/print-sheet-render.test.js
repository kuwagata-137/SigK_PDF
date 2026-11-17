'use strict';

// シートの画像を作る前後の純粋な部分（docs/spec-7-7-print-dialog.md）。
// renderer/print-page-region.js（ページの部分を PDF の座標の箱に直す）・print-comments.js（注釈とフォーム(M) の隠し方）・
// print-summary.js（注釈の一覧(T) の一覧ページ）・print-send.js（送る順番と用紙の指定）・print-sheet-render.js（画素数上限と、
// 画素単位にそろえて貼る処理。決定97 ②⑤）・print-preview.js（プレビューに表示する canvas の大きさ。決定97 ②）。画素そのものは起動確認で見る。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-image.js');
require('../renderer/mosaic-save.js');
require('../renderer/print-page-region.js');
require('../renderer/print-comments.js');
require('../renderer/print-summary.js');
require('../renderer/print-send.js');
require('../renderer/print-sheet-render.js');
require('../renderer/print-preview.js');

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

// ---- 画素数上限（シート画像。print-sheet-render.js の cappedDpi。決定97 ⑤） ----

const render = SigK.printSheetRender;

test('300 dpi のシート画像は A4 で 2480 × 3508 画素。上限（1 枚 4,000 万画素・1 辺 16,384 画素）に収まる用紙は 300 dpi のまま', () => {
  const a4 = { width: 210000, height: 297000 };
  assert.deepEqual(render.sheetPixels(a4, 300), { width: 2480, height: 3508 });
  assert.equal(render.cappedDpi(a4, 300), 300);
  assert.equal(render.cappedDpi({ width: 420000, height: 594000 }, 300), 300, 'A2（4961 × 7016 画素。約 3,481 万画素）も 300 dpi のまま');
});

test('上限を超える用紙は、その用紙だけ解像度を下げて、上限の近くに収める（モザイクを入れたページの保存と同じ上限）', () => {
  const { MAX_PIXELS, MAX_SIDE } = SigK.mosaicSave;
  assert.deepEqual([MAX_PIXELS, MAX_SIDE], [40_000_000, 16_384]);
  // A1（594 × 841 mm）は 300 dpi で約 6,969 万画素になる。
  const a1 = { width: 594000, height: 841000 };
  const dpi = render.cappedDpi(a1, 300);
  const size = render.sheetPixels(a1, dpi);
  assert.ok(dpi < 300);
  assert.ok(size.width * size.height <= MAX_PIXELS && size.width * size.height > MAX_PIXELS * 0.99, `${size.width} × ${size.height}`);
  // 細長い用紙（100 × 1,500 mm）は、画素数は上限に収まるが、長い辺が 300 dpi で 17,717 画素になる。
  const strip = { width: 100000, height: 1500000 };
  const side = render.sheetPixels(strip, render.cappedDpi(strip, 300)).height;
  assert.ok(side <= MAX_SIDE && side > MAX_SIDE * 0.99, `${side}`);
});

// ---- 画素単位にそろえて貼る（print-sheet-render.js の snapRect・composeSheet。決定97 ②） ----

test('小数を含む矩形を、四辺をそれぞれ四捨五入して画素単位にそろえる。隣り合う矩形の間に隙間も重なりも作らない', () => {
  assert.deepEqual(render.snapRect({ x: 10.4, y: 0.6, width: 100.2, height: 50.5 }), { x: 10, y: 1, width: 101, height: 50 });
  const left = render.snapRect({ x: 0.3, y: 0, width: 10.4, height: 1 });
  const right = render.snapRect({ x: 10.7, y: 0, width: 10.4, height: 1 });
  assert.equal(left.x + left.width, right.x);
});

// 2D コンテキストのある document のふり。描画命令（translate・transform・drawImage）を順に記録する。
// 貼った画像は、貼った後で捨てられる（大きさが 0 になる）ので、貼った時の大きさを記録する。
function recordingDoc() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const ctx = {
    save() {}, restore() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
    translate: record('translate'), transform: record('transform'), rotate: record('rotate'),
    drawImage: (image, ...args) => calls.push(['drawImage', { width: image.width, height: image.height }, ...args]),
  };
  return {
    calls,
    defaultView: { CanvasRenderingContext2D: function CanvasRenderingContext2D() {} },
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
}

const UM_PER_PX_300 = 25400 / 300;
const PAGE = { number: 1, width: 595.28, height: 841.89 };

// A4 のページを、位置と大きさが 300 dpi の画素単位で小数になるように置いた枠。rotation が 90 なら時計回りに回して置く。
function pageItem({ rotation = 0, scale = 0.9597, x = 4230, y = 5982 } = {}) {
  const turned = rotation === 90;
  const um = 25400 / 72;
  return {
    page: 1, source: PAGE, x, y, rotation, scale, border: false, clip: null,
    width: (turned ? PAGE.height : PAGE.width) * um * scale,
    height: (turned ? PAGE.width : PAGE.height) * um * scale,
  };
}

// ページの一部を、pageImage.renderToCanvas と同じく四捨五入した大きさで描いたふり（画像は大きさだけを持つ）。
const renderPart = async (source, part, pxPerPt) => {
  const width = Math.round(part.width * source.width * pxPerPt);
  const height = Math.round(part.height * source.height * pxPerPt);
  return { canvas: { width, height }, width, height, rotation: 0, box: null, scale: pxPerPt, sourcePage: 1 };
};

const A4_SHEET = { width: 210000, height: 297000, landscape: false, tile: null };

test('ページ画像は、画素単位にそろえた位置に、拡大縮小せずに貼る（回転 0 度。描いた画像と貼る先の大きさの差は 1 画素以内）', async () => {
  const doc = recordingDoc();
  const item = pageItem();
  await render.composeSheet(doc, { ...A4_SHEET, items: [item] }, { dpi: 300, forPrint: true, renderPart });
  const dest = render.snapRect({ x: item.x / UM_PER_PX_300, y: item.y / UM_PER_PX_300, width: item.width / UM_PER_PX_300, height: item.height / UM_PER_PX_300 });
  assert.notEqual(item.x / UM_PER_PX_300, dest.x, '置いた位置は画素単位で小数');
  const draws = doc.calls.filter(([name]) => name === 'drawImage');
  assert.equal(draws.length, 1);
  const [, image, ...args] = draws[0];
  assert.deepEqual(args, [0, 0], '大きさを指定しない（拡大縮小しない）');
  assert.deepEqual(doc.calls.find(([name]) => name === 'translate'), ['translate', dest.x, dest.y]);
  assert.ok(Math.abs(image.width - dest.width) <= 1 && Math.abs(image.height - dest.height) <= 1, `${image.width}×${image.height} / ${dest.width}×${dest.height}`);
});

test('時計回りに 90 度回したページも、画素単位にそろえて拡大縮小せずに貼る（回転行列は成分を直接指定する）', async () => {
  const doc = recordingDoc();
  const item = pageItem({ rotation: 90, scale: 0.6789 });
  await render.composeSheet(doc, { ...A4_SHEET, items: [item] }, { dpi: 300, forPrint: true, renderPart });
  const dest = render.snapRect({ x: item.x / UM_PER_PX_300, y: item.y / UM_PER_PX_300, width: item.width / UM_PER_PX_300, height: item.height / UM_PER_PX_300 });
  assert.deepEqual(doc.calls.find(([name]) => name === 'transform'), ['transform', 0, 1, -1, 0, dest.x + dest.width, dest.y]);
  const [, image, ...args] = doc.calls.find(([name]) => name === 'drawImage');
  assert.deepEqual(args, [0, 0]);
  // 回したページ画像の幅は、貼る先の高さに当たる。
  assert.ok(Math.abs(image.width - dest.height) <= 1 && Math.abs(image.height - dest.width) <= 1, `${image.width}×${image.height} / ${dest.width}×${dest.height}`);
});

test('印刷する横のシートは、成分を直接指定した回転行列で時計回りに 90 度回し、縦の用紙の向きにする（画素の位置がずれない）', async () => {
  const doc = recordingDoc();
  await render.composeSheet(doc, { width: 297000, height: 210000, landscape: true, tile: null, items: [] }, { dpi: 300, forPrint: true, renderPart });
  // canvas は縦（2480 × 3508）。シートの左上を canvas の右上へ置く。
  assert.deepEqual(doc.calls[0], ['transform', 0, 1, -1, 0, 2480, 0]);
});

test('描いた画像が貼る先より 1 画素を超えて小さい時（画素数上限で倍率を下げた時）だけ、貼る先の大きさに伸ばす。大きさ 0 の部分は貼らない', async () => {
  const doc = recordingDoc();
  const item = pageItem();
  const half = async (source, part, pxPerPt) => renderPart(source, part, pxPerPt / 2);
  await render.composeSheet(doc, { ...A4_SHEET, items: [item] }, { dpi: 300, forPrint: true, renderPart: half });
  const dest = render.snapRect({ x: item.x / UM_PER_PX_300, y: item.y / UM_PER_PX_300, width: item.width / UM_PER_PX_300, height: item.height / UM_PER_PX_300 });
  const [, , ...args] = doc.calls.find(([name]) => name === 'drawImage');
  assert.deepEqual(args, [0, 0, dest.width, dest.height]);
  // 幅 0.2 画素の細い部分は、画素単位にそろえると幅 0 になる（drawImage は大きさ 0 の画像を受け付けない）。
  const thin = recordingDoc();
  const sliver = { ...pageItem({ x: 10.1 * UM_PER_PX_300 }), width: 0.2 * UM_PER_PX_300 };
  await render.composeSheet(thin, { ...A4_SHEET, items: [sliver] }, { dpi: 300, forPrint: true, renderPart });
  assert.equal(thin.calls.filter(([name]) => name === 'drawImage').length, 0);
});

// ---- プレビューに表示する canvas の大きさ（print-preview.js の paperLayout。決定97 ②） ----

const PREVIEW_PAPERS = {
  'A4 縦': { width: 210000, height: 297000 },
  'A4 横': { width: 297000, height: 210000 },
  A3: { width: 297000, height: 420000 },
  'B5 (JIS) 縦': { width: 182000, height: 257000 },
  レター: { width: 215900, height: 279400 },
};
const PIXEL_RATIOS = [1, 1.25, 1.5, 1.75, 2];

test('プレビューに表示する canvas は、表示画素数（CSS px × devicePixelRatio）が canvas の画素数と一致する（devicePixelRatio 1〜2・用紙 5 種）', () => {
  const { paperLayout, BOX } = SigK.printPreview;
  const inner = { width: BOX.width - BOX.border * 2, height: BOX.height - BOX.border * 2 };
  for (const [name, sheet] of Object.entries(PREVIEW_PAPERS)) {
    const ratio = Math.min(inner.width / sheet.width, inner.height / sheet.height);
    for (const dpr of PIXEL_RATIOS) {
      const label = `${name}・devicePixelRatio ${dpr}`;
      const layout = paperLayout(sheet, dpr);
      // canvas の画素数は、シート画像を描く canvas（print-sheet-render.js の sheetCanvas）と同じく四捨五入する。
      assert.deepEqual(layout.pixels, render.sheetPixels(sheet, layout.dpi), label);
      assert.ok(Math.abs(layout.css.width * dpr - layout.pixels.width) < 1e-9, `${label}: 幅`);
      assert.ok(Math.abs(layout.css.height * dpr - layout.pixels.height) < 1e-9, `${label}: 高さ`);
      // 用紙を枠に収めた大きさ（端数のまま）との差は 1 画素未満。
      assert.ok(Math.abs(layout.pixels.width - sheet.width * ratio * dpr) < 1, `${label}: 幅 ${layout.pixels.width}`);
      assert.ok(Math.abs(layout.pixels.height - sheet.height * ratio * dpr) < 1, `${label}: 高さ ${layout.pixels.height}`);
    }
    // devicePixelRatio が 1 の時、枠の内側は以前と同じく、収めた大きさを四捨五入した整数。
    const css = paperLayout(sheet, 1).css;
    assert.deepEqual(css, { width: Math.round(sheet.width * ratio), height: Math.round(sheet.height * ratio) }, name);
  }
});
