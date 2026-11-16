'use strict';

// 用紙 1 枚ごとの配置の計算（renderer/print-sheet-*.js。docs/spec-7-7-print-dialog.md「配置の計算」）。
// 長さは µm、ページの大きさは pt。シートの向きが横の時は、印刷する画像を時計回りに 90 度回して縦の用紙に載せる。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/print-sheet-geometry.js');
require('../renderer/print-sheet-multi.js');
require('../renderer/print-sheet-poster.js');
require('../renderer/print-sheet-plan.js');

const plan = globalThis.SigK.printSheetPlan;
const geometry = globalThis.SigK.printSheetGeometry;

const A4 = { id: 'psk:ISOA4', name: 'A4', width: 210000, height: 297000 };
const A3 = { id: 'psk:ISOA3', name: 'A3', width: 297000, height: 420000 };
const A5 = { id: 'psk:ISOA5', name: 'A5', width: 148000, height: 210000 };
const ENVELOPE = { id: 'psk:JapanChou3Envelope', name: '封筒 長形 3 号', width: 120000, height: 235000 };
// 四辺 4.23 mm（spec-7-7 確定事項C3 の初期値）。
const AREA = { x: 4230, y: 4230, width: 201540, height: 288540 };
const pt = (mm) => (mm / 25.4) * 72;
const page = (number, widthMm, heightMm) => ({ number, width: pt(widthMm), height: pt(heightMm) });
const pagesOf = (count, widthMm = 210, heightMm = 297) => Array.from({ length: count }, (_v, i) => page(i + 1, widthMm, heightMm));

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= 1, `${message ?? ''} ${actual} は ${expected} に近くない`);
}

function build(pages, options, extra = {}) {
  return plan.build({ pages, paper: A4, imageable: AREA, options, paperSizes: [A4, A3, A5, ENVELOPE], ...extra });
}

// ---- サイズ ----

test('合わせる: 16:9 のページを A4 に印刷すると、自動の向きで横になり、倍率 113%（Acrobat の画面写真 1 と同じ）', () => {
  const result = build([page(1, 254, 142.875)], { mode: 'size', size: { fit: 'fit' }, orientation: 'auto' });
  const [sheet] = result.sheets;
  assert.equal(sheet.landscape, true);
  assert.equal(sheet.width, 297000);
  assert.equal(sheet.height, 210000);
  assert.equal(sheet.scalePercent, 113);
  const [item] = sheet.items;
  near(item.x, 4230);
  near(item.width, 288540);
  near(item.height, 162303);
  near(item.y, 23848, '印刷可能領域の中で上下の中央');
  assert.equal(item.rotation, 0);
});

test('合わせる: A4 のページを A4 に印刷すると、印刷可能領域に収まるように縮小する（倍率 95%）', () => {
  const [sheet] = build([page(1, 210, 297)], { mode: 'size', size: { fit: 'fit' } }).sheets;
  assert.equal(sheet.landscape, false);
  assert.equal(sheet.scalePercent, 95);
  near(sheet.items[0].width, 201540);
});

test('実際のサイズは 100% で用紙の中央に置く。はみ出た所は印刷しない（プリンターが切る）', () => {
  const [sheet] = build([page(1, 297, 420)], { mode: 'size', size: { fit: 'actual' }, orientation: 'portrait' }).sheets;
  assert.equal(sheet.scalePercent, 100);
  near(sheet.items[0].x, -43500);
  near(sheet.items[0].y, -61500);
});

test('特大ページを縮小は、印刷可能領域より大きいページだけを縮小する', () => {
  const small = build([page(1, 148, 210)], { mode: 'size', size: { fit: 'shrink' } }).sheets[0];
  assert.equal(small.scalePercent, 100);
  near(small.items[0].x, 31000, '縮小しないページは用紙の中央');
  const large = build([page(1, 297, 420)], { mode: 'size', size: { fit: 'shrink' }, orientation: 'portrait' }).sheets[0];
  assert.equal(large.scalePercent, 67);
});

test('カスタム倍率は 1〜1000% に収め、用紙の中央に置く', () => {
  assert.equal(build([page(1, 100, 100)], { mode: 'size', size: { fit: 'custom', scale: 150 } }).sheets[0].scalePercent, 150);
  assert.equal(build([page(1, 100, 100)], { mode: 'size', size: { fit: 'custom', scale: 5000 } }).sheets[0].scalePercent, 1000);
  assert.equal(build([page(1, 100, 100)], { mode: 'size', size: { fit: 'custom', scale: 0 } }).sheets[0].scalePercent, 1);
});

test('向きの縦・横は、ページの形に関係なく用紙の向きを固定する', () => {
  const portrait = build([page(1, 254, 142.875)], { mode: 'size', size: { fit: 'fit' }, orientation: 'portrait' }).sheets[0];
  assert.equal(portrait.landscape, false);
  assert.equal(portrait.scalePercent, 79);
  const landscape = build([page(1, 210, 297)], { mode: 'size', size: { fit: 'fit' }, orientation: 'landscape' }).sheets[0];
  assert.equal(landscape.landscape, true);
});

test('PDF のページサイズに合わせて用紙を選択: ページが 100% で収まる最小の用紙を、決まったサイズの中から選ぶ', () => {
  const result = build([page(1, 210, 297), page(2, 297, 420), page(3, 148, 210), page(4, 600, 800), page(5, 100, 200)],
    { mode: 'size', size: { fit: 'fit', choosePaper: true } });
  assert.deepEqual(result.sheets.map((sheet) => sheet.paper.name), ['A4', 'A3', 'A5', 'A3', 'A5']);
  assert.equal(result.sheets[1].scalePercent, 97, 'A3 の用紙（余白は A4 と同じ 4.23 mm）に合わせる');
  // 封筒は寸法が収まっても選ばない（用紙サイズ一覧の封筒・写真用紙を避ける）。
  assert.ok(result.sheets.every((sheet) => sheet.paper.id !== ENVELOPE.id));
});

test('用紙サイズが変わる所で印刷を分ける', () => {
  const result = build([page(1, 210, 297), page(2, 210, 297), page(3, 297, 420), page(4, 210, 297)], { mode: 'size', size: { fit: 'fit', choosePaper: true } });
  assert.deepEqual(plan.groupJobs(result.sheets).map((job) => [job.paper.name, job.sheets.length]), [['A4', 2], ['A3', 1], ['A4', 1]]);
});

test('横のシートの印刷可能領域は、縦の用紙の余白を回して当てる（上 = 縦の右、左 = 縦の上）', () => {
  const sheet = geometry.makeSheet(A4, { x: 3000, y: 5000, width: 200000, height: 288000 }, true);
  // 縦の余白: 左 3・上 5・右 7・下 4 mm。
  assert.deepEqual(sheet.area, { x: 5000, y: 7000, width: 288000, height: 200000 });
});

// ---- 複数 ----

test('複数: 1 枚あたり 2 ページは、縦のページなら横の用紙に 2 列 1 行で並べる（Acrobat が向きを選ぶ）', () => {
  assert.equal(plan.bestMultipleOrientation(pagesOf(1), A4, AREA, 2), 'landscape');
  assert.equal(plan.bestMultipleOrientation(pagesOf(1), A4, AREA, 4), 'portrait');
  assert.equal(plan.bestMultipleOrientation([page(1, 297, 210)], A4, AREA, 2), 'portrait');
  const result = build(pagesOf(21), { mode: 'multiple', orientation: 'landscape', multiple: { perSheet: 2 } });
  assert.equal(result.sheets.length, 11);
  assert.deepEqual(result.sheets[10].items.map((item) => item.page), [21]);
  const [first, second] = result.sheets[0].items;
  near(first.width, 142503);
  near(first.x, 5114);
  near(second.x, 4230 + 144270 + 884);
  assert.equal(result.sheets[0].scalePercent, 67);
});

test('複数: ページの順序 4 種（横・横（右から左）・縦・縦（右から左））', () => {
  const corners = (order) => {
    const [sheet] = build(pagesOf(4), { mode: 'multiple', orientation: 'portrait', multiple: { perSheet: 4, order } }).sheets;
    return sheet.items.map((item) => `${item.x < 105000 ? '左' : '右'}${item.y < 148500 ? '上' : '下'}`);
  };
  assert.deepEqual(corners('horizontal'), ['左上', '右上', '左下', '右下']);
  assert.deepEqual(corners('horizontalReversed'), ['右上', '左上', '右下', '左下']);
  assert.deepEqual(corners('vertical'), ['左上', '左下', '右上', '右下']);
  assert.deepEqual(corners('verticalReversed'), ['右上', '右下', '左上', '左下']);
});

test('複数: 6・9・16 ページと、カスタム（列 x 行。1〜99）', () => {
  const six = build(pagesOf(6), { mode: 'multiple', orientation: 'portrait', multiple: { perSheet: 6 } }).sheets[0];
  assert.deepEqual([six.grid.cols, six.grid.rows], [2, 3]);
  const sixWide = build(pagesOf(6), { mode: 'multiple', orientation: 'landscape', multiple: { perSheet: 6 } }).sheets[0];
  assert.deepEqual([sixWide.grid.cols, sixWide.grid.rows], [3, 2]);
  assert.equal(build(pagesOf(20), { mode: 'multiple', orientation: 'portrait', multiple: { perSheet: 16 } }).sheets.length, 2);
  const custom = build(pagesOf(7), { mode: 'multiple', orientation: 'portrait', multiple: { perSheet: 'custom', cols: 3, rows: 1 } });
  assert.equal(custom.sheets.length, 3);
  assert.deepEqual([custom.sheets[0].grid.cols, custom.sheets[0].grid.rows], [3, 1]);
  const clamped = build(pagesOf(1), { mode: 'multiple', orientation: 'portrait', multiple: { perSheet: 'custom', cols: 500, rows: 0 } }).sheets[0];
  assert.deepEqual([clamped.grid.cols, clamped.grid.rows], [99, 1]);
});

test('複数: ページ境界線を印刷と、各シート内でページを自動回転', () => {
  const plain = build([page(1, 297, 210), page(2, 297, 210)], { mode: 'multiple', orientation: 'portrait', multiple: { perSheet: 4, border: true } }).sheets[0];
  assert.equal(plain.items[0].border, true);
  assert.equal(plain.items[0].rotation, 0);
  const rotated = build([page(1, 297, 210), page(2, 297, 210)], { mode: 'multiple', orientation: 'portrait', autoRotate: true, multiple: { perSheet: 2 } }).sheets[0];
  // 縦の用紙の 1 列 2 行の枠は横長なので、横のページは回さない。縦の枠（4 ページ）なら回す。
  assert.equal(rotated.items[0].rotation, 0);
  const four = build([page(1, 297, 210)], { mode: 'multiple', orientation: 'portrait', autoRotate: true, multiple: { perSheet: 4 } }).sheets[0];
  assert.equal(four.items[0].rotation, 90, '2 x 2 の縦長の枠には、横のページを回して大きく置く');
  const off = build([page(1, 297, 210)], { mode: 'multiple', orientation: 'portrait', autoRotate: false, multiple: { perSheet: 4 } }).sheets[0];
  assert.equal(off.items[0].rotation, 0);
  const tall = build([page(1, 297, 105)], { mode: 'multiple', orientation: 'landscape', autoRotate: true, multiple: { perSheet: 'custom', cols: 4, rows: 1 } }).sheets[0];
  assert.equal(tall.items[0].rotation, 90);
  assert.equal(tall.items[0].width < tall.items[0].height, true, '回したページの枠は縦長');
});

// ---- 小冊子 ----

const sidePages = (result) => result.sheets.map((sheet) => sheet.items.map((item) => item.page));

test('小冊子: 左綴じは、1 枚目の表が［最後・1］、裏が［2・最後から 2 番目］。両面は短辺を綴じる', () => {
  const result = build(pagesOf(8), { mode: 'booklet', booklet: { method: 'both', binding: 'left' } });
  assert.deepEqual(sidePages(result), [[8, 1], [2, 7], [6, 3], [4, 5]]);
  assert.deepEqual(result.sheets.map((sheet) => sheet.side), ['front', 'back', 'front', 'back']);
  assert.equal(result.duplexMode, 'shortEdge');
  assert.equal(result.sheets[0].landscape, true);
  // 綴じる所（用紙の中央）に寄せる。
  const [left, right] = result.sheets[0].items;
  near(left.x + left.width, 148500);
  near(right.x, 148500);
});

test('小冊子: 4 の倍数に満たない分は白紙。右綴じは左右を入れ替える', () => {
  assert.deepEqual(sidePages(build(pagesOf(5), { mode: 'booklet', booklet: { binding: 'left' } })), [[null, 1], [2, null], [null, 3], [4, 5]]);
  assert.deepEqual(sidePages(build(pagesOf(8), { mode: 'booklet', booklet: { binding: 'right' } })), [[1, 8], [7, 2], [3, 6], [5, 4]]);
});

test('小冊子: 縦長左・縦長右は、縦の用紙に上下 2 ページを並べる', () => {
  const tall = build(pagesOf(4, 297, 210), { mode: 'booklet', booklet: { binding: 'leftTall' } });
  assert.equal(tall.sheets[0].landscape, false);
  assert.deepEqual(sidePages(tall), [[4, 1], [2, 3]]);
  const [top, bottom] = tall.sheets[0].items;
  near(top.y + top.height, 148500);
  near(bottom.y, 148500);
  assert.deepEqual(sidePages(build(pagesOf(4, 297, 210), { mode: 'booklet', booklet: { binding: 'rightTall' } })), [[1, 4], [3, 2]]);
});

test('小冊子: 片面で印刷（表側）・（裏側）と、開始ページ・終了ページ（紙の枚数で数える）', () => {
  assert.deepEqual(sidePages(build(pagesOf(8), { mode: 'booklet', booklet: { method: 'front' } })), [[8, 1], [6, 3]]);
  assert.deepEqual(sidePages(build(pagesOf(8), { mode: 'booklet', booklet: { method: 'back' } })), [[2, 7], [4, 5]]);
  assert.equal(build(pagesOf(8), { mode: 'booklet', booklet: { method: 'front' } }).duplexMode, 'simplex');
  assert.equal(build(pagesOf(1), { mode: 'size' }).duplexMode, null, '小冊子のほかは、用紙の両面に印刷(B) の指定に従う');
  assert.deepEqual(sidePages(build(pagesOf(8), { mode: 'booklet', booklet: { from: 2, to: 2 } })), [[6, 3], [4, 5]]);
  assert.deepEqual(sidePages(build(pagesOf(8), { mode: 'booklet', booklet: { from: 5, to: 9 } })), [[6, 3], [4, 5]], '範囲は紙の枚数に収める');
  assert.equal(plan.bookletSheetCount(9), 3);
});

// ---- ポスター ----

test('ポスター: 倍率 200% の A4 ページは、縦の A4 で 3 x 3 枚、横の A4 で 2 x 3 枚に分ける', () => {
  const portrait = build([page(1, 210, 297)], { mode: 'poster', orientation: 'portrait', poster: { scale: 200 } });
  assert.equal(portrait.sheets.length, 9);
  const landscape = build([page(1, 210, 297)], { mode: 'poster', orientation: 'landscape', poster: { scale: 200 } });
  assert.equal(landscape.sheets.length, 6);
  assert.deepEqual(landscape.sheets.map((sheet) => [sheet.tile.col, sheet.tile.row]).slice(0, 3), [[1, 1], [2, 1], [1, 2]]);
});

test('ポスター: 重なりの幅だけ隣のタイルと重ね、全体を中央に置く', () => {
  const result = build([page(1, 210, 297)], { mode: 'poster', orientation: 'portrait', poster: { scale: 200, overlap: 10 } });
  assert.equal(result.sheets.length, 9);
  const [first, second] = result.sheets;
  // 1 枚目と 2 枚目の間で、ページの左端の位置が（タイルの幅 - 重なり）だけずれる。
  near(first.items[0].x - second.items[0].x, 201540 - 10000);
  // 3 列の全体の幅（3 x 191.54 + 10 mm）の中央に、幅 420 mm のページを置く。
  near(first.items[0].x, 4230 + (3 * 191540 + 10000 - 420000) / 2);
  assert.deepEqual(first.items[0].clip, first.area, '印刷可能領域の外は描かない');
});

test('ポスター: 大きいページのみを分割・タイルマーク・ラベル', () => {
  const small = build([page(1, 100, 100)], { mode: 'poster', orientation: 'portrait', poster: { scale: 100, largeOnly: true, tileMarks: true, labels: true } });
  assert.equal(small.sheets.length, 1);
  assert.equal(small.sheets[0].tile, null, '分割しないページにはタイルマークとラベルを付けない');
  const tiled = build([page(3, 210, 297)], { mode: 'poster', orientation: 'portrait', poster: { scale: 200, tileMarks: true, labels: true } });
  assert.equal(tiled.sheets[0].tile.marks, true);
  assert.deepEqual(tiled.sheets[4].tile.label, { page: 3, col: 2, row: 2 });
  // ラベルの分だけ、タイルの高さを下で空ける。
  assert.ok(tiled.sheets[0].items[0].clip.height < AREA.height);
});

// ---- 共通 ----

test('用紙が多すぎる時と、ページが無い時は理由を返す', () => {
  // A0 のページを 1000% にすると、縦の A4 で 42 x 42 枚。
  assert.match(build([page(1, 841, 1189)], { mode: 'poster', poster: { scale: 1000 } }).error, /用紙が 1764 枚になります。一度に印刷できる用紙は 300 枚までです。/);
  assert.match(build([], { mode: 'size' }).error, /印刷するページがありません/);
});
