'use strict';

// 分割の盤の配置（spec-2-2b 確定事項C9・C10・D2・D3）。位置は CSS に任せず純関数で決める（見えている所だけ DOM を組むため）。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/split-plan.js');
require('../renderer/split-board-model.js');
require('../renderer/split-board-layout.js');

const board = globalThis.SigK.splitBoard;
const layout = globalThis.SigK.splitLayout;

const boxesOf = (pageCount, cuts = []) => board.boxes({ pageCount, cuts, skipped: [] });

// 2026-10-23 から、紙の大きさはツールモードの紙の倍率で決まる（docs/07 決定83。前の「大きさ 小・中・大」は無くした。100% は前の「中」）。
test('紙の幅は 104px×倍率で、縦は √2 倍の枠（確定事項C9 を決定83 で改めた）', () => {
  assert.equal(layout.SHEET_WIDTH, 104);
  assert.deepEqual(layout.cellOf(1), { sheetWidth: 104, sheetHeight: 147, width: 110, height: 173 });
  assert.deepEqual(layout.cellOf(), layout.cellOf(1));
  assert.deepEqual([layout.cellOf(0.5).sheetWidth, layout.cellOf(0.5).sheetHeight], [52, 74]);
  assert.deepEqual([layout.cellOf(3).sheetWidth, layout.cellOf(3).sheetHeight], [312, 441]);
});

test('入りきらない箱は盤の幅いっぱいにしてページを折り返す。後ろの ✂ が入る分を空けて列を決める', () => {
  const placed = layout.layout({ boxes: boxesOf(12), contentWidth: 600, zoom: 1 });
  const [box] = placed.boxes;
  assert.deepEqual({ x: box.x, y: box.y, width: box.width, columns: box.columns, rows: box.rows }, { x: 0, y: 0, width: 600, columns: 4, rows: 3 });
  assert.equal(box.height, 600);
  assert.equal(placed.totalHeight, 600);
});

test('入りきる箱は中身の幅（見出しが入る 240px 以上）で、小さい箱は横に並べる（決定77 ②）', () => {
  const placed = layout.layout({ boxes: boxesOf(5, [1, 2, 3, 4]), contentWidth: 600, zoom: 1 });
  assert.deepEqual(placed.boxes.map(({ x, y, width }) => ({ x, y, width })), [
    { x: 0, y: 0, width: 240 }, { x: 252, y: 0, width: 240 },
    { x: 0, y: 270, width: 240 }, { x: 252, y: 270, width: 240 },
    { x: 0, y: 540, width: 240 },
  ]);
  // 狭い箱（420px 未満）は見出しが 2 行。箱の高さ＝上の枠 1＋余白 9＋見出し 62＋紙の段 173＋余白 12＋下の枠 1＝258。段の間は 12。
  assert.equal(placed.totalHeight, 540 + 258);
  assert.equal(placed.boxes[0].narrow, true);
  assert.deepEqual(layout.pageRect(placed, 0), { x: 13, y: 72, width: 110, height: 173 });
});

test('2 ページの箱は ✂ を挟んだ幅になる', () => {
  const placed = layout.layout({ boxes: boxesOf(4, [2]), contentWidth: 900, zoom: 1.5 });
  // 倍率 150% の紙の枠 162（紙 156＋余白 6）＋ ✂ 26 ＋ 162 ＋ 左右の余白 26 = 376
  assert.deepEqual(placed.boxes.map(({ x, width }) => ({ x, width })), [{ x: 0, width: 376 }, { x: 388, width: 376 }]);
});

test('ページと ✂ の位置。行の頭のページの ✂ は、前の行の末尾に置く', () => {
  const placed = layout.layout({ boxes: boxesOf(12), contentWidth: 600, zoom: 1 });
  assert.deepEqual(layout.pageRect(placed, 0), { x: 13, y: 44, width: 110, height: 173 });
  assert.deepEqual(layout.pageRect(placed, 5), { x: 13 + 136, y: 44 + 185, width: 110, height: 173 });
  assert.deepEqual(layout.cutRect(placed, 1), { x: 123, y: 44, width: 26, height: 173 });
  // 5 ページ目（0 始まりの 4）は 2 行目の頭なので、✂ は 1 行目の 4 ページ目の後ろ。
  assert.deepEqual(layout.cutRect(placed, 4), { x: 13 + 3 * 136 + 110, y: 44, width: 26, height: 173 });
  assert.equal(layout.cutRect(placed, 0), null);
});

test('箱の境目には ✂ を置かない（確定事項C1）', () => {
  const placed = layout.layout({ boxes: boxesOf(8, [4]), contentWidth: 900, zoom: 1 });
  assert.equal(layout.cutRect(placed, 4), null);
  assert.notEqual(layout.cutRect(placed, 5), null);
});

test('見えている範囲のページだけを返す。5,000 ページでも数は窓の大きさで頭打ちになる', () => {
  for (const cuts of [[], Array.from({ length: 4999 }, (_value, index) => index + 1)]) {
    const placed = layout.layout({ boxes: boxesOf(5000, cuts), contentWidth: 600, zoom: 1 });
    const middle = Math.round(placed.totalHeight / 2);
    const seen = layout.windowOf(placed, { scrollTop: middle, viewportHeight: 500, overscan: 500 });
    assert.ok(seen.pages.length > 0 && seen.pages.length <= 60, `${seen.pages.length}`);
    assert.ok(seen.boxes.length >= 1);
    assert.ok(seen.pages.every((page) => {
      const rect = layout.pageRect(placed, page);
      return rect.y + rect.height >= middle - 500 && rect.y <= middle + 1000;
    }));
  }
});

test('pageAt: ページの上はそのページ、隙間や余白は近いページ、箱の外は近い箱', () => {
  const placed = layout.layout({ boxes: boxesOf(12, [8]), contentWidth: 600, zoom: 1 });
  const center = (page) => {
    const rect = layout.pageRect(placed, page);
    return [rect.x + rect.width / 2, rect.y + rect.height / 2];
  };
  assert.equal(layout.pageAt(placed, ...center(6)), 6);
  const rect5 = layout.pageRect(placed, 5);
  assert.equal(layout.pageAt(placed, rect5.x + rect5.width + 5, rect5.y + 20), 5);    // ✂ の左半分
  assert.equal(layout.pageAt(placed, rect5.x + rect5.width + 20, rect5.y + 20), 6);   // ✂ の右半分
  assert.equal(layout.pageAt(placed, 590, 10), 3);                                    // 見出しの右端（1 行目の右端のページが近い）
  const second = placed.boxes[1];
  assert.equal(layout.pageAt(placed, 50, second.y - 3), 8);                           // 箱の間（下の箱に近い）
  assert.equal(layout.pageAt(placed, 50, placed.totalHeight + 100), 8);               // 末尾の先
});

test('scrollTopFor: 見えていれば今のまま、上なら上端、下なら下端に合わせる', () => {
  const placed = layout.layout({ boxes: boxesOf(40), contentWidth: 600, zoom: 1 });
  const rect = layout.pageRect(placed, 20);
  assert.equal(layout.scrollTopFor(placed, 20, { scrollTop: rect.y - 10, viewportHeight: 400 }), rect.y - 10);
  assert.equal(layout.scrollTopFor(placed, 20, { scrollTop: rect.y + 50, viewportHeight: 400 }), rect.y - 12);
  assert.equal(layout.scrollTopFor(placed, 20, { scrollTop: 0, viewportHeight: 400 }), rect.y + rect.height + 12 - 400);
  assert.equal(layout.boxTop(placed, 0), 0);
});

test('thumbScale: 紙の枠に収まる倍率。devicePixelRatio は 2 まで', () => {
  const cell = layout.cellOf(1);
  // A4 の縦横比（1.415）は枠（147 / 104＝1.413）より少し縦長なので、縦で当たる。
  assert.equal(layout.thumbScale({ cell, pageWidth: 595, pageHeight: 842, devicePixelRatio: 1 }), 147 / 842);
  assert.equal(layout.thumbScale({ cell, pageWidth: 842, pageHeight: 595, devicePixelRatio: 1 }), 104 / 842);
  assert.equal(layout.thumbScale({ cell, pageWidth: 595, pageHeight: 842, devicePixelRatio: 3 }), (147 / 842) * 2);
  assert.equal(layout.thumbScale({ cell, pageWidth: 100, pageHeight: 1000, devicePixelRatio: 1 }), 147 / 1000);
});

test('描く枚数の上限は面積で数え、100% で 72 枚（確定事項D4 を決定83 で改めた。前の小 120・大 36 とほぼ同じ）', () => {
  assert.deepEqual([0.5, 0.75, 1, 1.5, 2, 3].map((zoom) => layout.renderCap(zoom)), [288, 128, 72, 32, 18, 8]);
  assert.equal(layout.renderCap(), 72);
});
