'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/viewer-layout.js');
const layout = globalThis.SigK.viewerLayout;

const A4 = { width: 595.28, height: 841.89 };
const A5 = { width: 419.53, height: 595.28 };

test('clampZoom は 25〜400% に収める', () => {
  assert.equal(layout.clampZoom(0.1), 0.25);
  assert.equal(layout.clampZoom(9), 4);
  assert.equal(layout.clampZoom(1.5), 1.5);
  assert.equal(layout.clampZoom(Number.NaN), 1);
  assert.equal(layout.clampZoom(undefined), 1);
});

test('段送りは上限と下限で止まる', () => {
  assert.equal(layout.nextZoom(4), 4);
  assert.equal(layout.prevZoom(0.25), 0.25);
  assert.equal(layout.nextZoom(1), 1.25);
  assert.equal(layout.prevZoom(1), 0.75);
});

// 「幅に合わせる」の結果は段の間の値になる。そこから押しても同じ段に留まると
// 「押しても変わらない」になるため、必ず隣の段へ動くことを確かめる。
test('段の間の倍率からでも段送りは必ず動く', () => {
  const between = 1.137;

  assert.equal(layout.nextZoom(between), 1.25);
  assert.equal(layout.prevZoom(between), 1);
  assert.notEqual(layout.nextZoom(between), between);
});

test('fitWidthZoom はページの幅を視野の幅に合わせる', () => {
  const zoom = layout.fitWidthZoom({ pageWidth: A4.width, viewportWidth: 900 });
  const drawnWidth = A4.width * zoom * layout.CSS_UNITS;

  assert.equal(Math.round(drawnWidth), 900 - layout.SIDE_MARGIN * 2);
});

test('fitPageZoom は縦にも収まる倍率を選ぶ', () => {
  const zoom = layout.fitPageZoom({
    pageWidth: A4.width,
    pageHeight: A4.height,
    viewportWidth: 900,
    viewportHeight: 700,
  });
  const drawnHeight = A4.height * zoom * layout.CSS_UNITS;

  assert.ok(drawnHeight <= 700, `縦にはみ出している: ${drawnHeight}`);
  assert.ok(zoom < layout.fitWidthZoom({ pageWidth: A4.width, viewportWidth: 900 }));
});

test('視野が取れないときは 100% に落ちる', () => {
  assert.equal(layout.fitWidthZoom({ pageWidth: A4.width, viewportWidth: 0 }), 1);
  assert.equal(layout.fitPageZoom({ pageWidth: A4.width, pageHeight: 0, viewportWidth: 0, viewportHeight: 0 }), 1);
});

test('layoutPages はページを上から順に間隔を空けて積む', () => {
  const { pages, totalHeight } = layout.layoutPages({ sizes: [A4, A4, A4], zoom: 1 });

  assert.equal(pages.length, 3);
  assert.equal(pages[0].top, layout.PAGE_MARGIN);
  assert.equal(pages[1].top, pages[0].top + pages[0].height + layout.PAGE_GAP);
  assert.equal(totalHeight, pages[2].top + pages[2].height + layout.PAGE_MARGIN);
});

test('layoutPages は幅の違うページを中央へ寄せる', () => {
  const { pages, contentWidth } = layout.layoutPages({ sizes: [A4, A5, A4], zoom: 1 });

  assert.equal(contentWidth, pages[0].width);
  assert.equal(pages[0].left, 0);
  assert.equal(pages[1].left, Math.round((contentWidth - pages[1].width) / 2));
  assert.ok(pages[1].width < pages[0].width);
});

test('layoutPages はページが無くても落ちない', () => {
  const { pages, contentWidth, totalHeight } = layout.layoutPages({ sizes: [], zoom: 1 });

  assert.deepEqual(pages, []);
  assert.equal(contentWidth, 0);
  assert.equal(totalHeight, 0);
});

test('visibleRange は視野に掛かっているページを返す', () => {
  const { pages } = layout.layoutPages({ sizes: [A4, A4, A4], zoom: 1 });

  assert.deepEqual(layout.visibleRange({ pages, scrollTop: 0, viewportHeight: 700 }), { first: 0, last: 0 });
  assert.deepEqual(
    layout.visibleRange({ pages, scrollTop: pages[1].top - 20, viewportHeight: 700 }),
    { first: 0, last: 1 },
  );
});

test('currentPageIndex はいちばん広く見えているページを返す', () => {
  const { pages } = layout.layoutPages({ sizes: [A4, A4, A4], zoom: 1 });

  assert.equal(layout.currentPageIndex({ pages, scrollTop: 0, viewportHeight: 700 }), 0);
  assert.equal(layout.currentPageIndex({ pages, scrollTop: pages[1].top, viewportHeight: 700 }), 1);
  // 1ページ目が少しだけ残っている位置。広いほうの2ページ目を採る。
  assert.equal(layout.currentPageIndex({ pages, scrollTop: pages[1].top - 100, viewportHeight: 700 }), 1);
});

test('renderTargets は前後1ページまで広げる', () => {
  assert.deepEqual(layout.renderTargets({ count: 10, first: 3, last: 4, current: 3 }), [2, 3, 4, 5]);
  assert.deepEqual(layout.renderTargets({ count: 10, first: 0, last: 0, current: 0 }), [0, 1]);
  assert.deepEqual(layout.renderTargets({ count: 10, first: 9, last: 9, current: 9 }), [8, 9]);
  assert.deepEqual(layout.renderTargets({ count: 0, first: 0, last: 0 }), []);
});

// canvas を持ちすぎるとメモリが尽きる。上限で切り詰めることを固定する。
test('renderTargets は上限を超えたら現在ページの周りを残す', () => {
  const targets = layout.renderTargets({ count: 100, first: 10, last: 40, current: 25, max: 8 });

  assert.equal(targets.length, 8);
  assert.ok(targets.includes(25), '現在ページが落ちている');
  assert.deepEqual(targets, [22, 23, 24, 25, 26, 27, 28, 29]);
});

test('scrollTopForPage はページの上端を視野の先頭に置く', () => {
  const { pages } = layout.layoutPages({ sizes: [A4, A4, A4], zoom: 1 });

  assert.equal(layout.scrollTopForPage({ pages, index: 0 }), 0);
  assert.equal(layout.scrollTopForPage({ pages, index: 1 }), pages[1].top - layout.PAGE_MARGIN);
  // 範囲外は端に丸める。
  assert.equal(layout.scrollTopForPage({ pages, index: 99 }), pages[2].top - layout.PAGE_MARGIN);
  assert.equal(layout.scrollTopForPage({ pages: [], index: 0 }), 0);
});

test('renderScale は devicePixelRatio を掛け、上限で頭打ちにする', () => {
  assert.equal(layout.renderScale({ zoom: 1, devicePixelRatio: 1 }), layout.CSS_UNITS);
  assert.equal(layout.renderScale({ zoom: 1, devicePixelRatio: 2 }), layout.CSS_UNITS * 2);
  assert.equal(layout.renderScale({ zoom: 1, devicePixelRatio: 8 }), layout.CSS_UNITS * layout.MAX_CANVAS_SCALE);
  assert.equal(layout.renderScale({ zoom: 1, devicePixelRatio: 0 }), layout.CSS_UNITS);
  assert.equal(layout.renderScale({ zoom: 1 }), layout.CSS_UNITS);
});

// 100% は実寸相当（96/72 倍）である。pdf.js の scale:1 をそのまま出すと小さい。
test('100% は 96/72 倍として pdf.js へ渡る', () => {
  assert.equal(layout.CSS_UNITS, 96 / 72);
  assert.equal(layout.renderScale({ zoom: 1, devicePixelRatio: 1 }), 96 / 72);
});

test('formatZoom は百分率の文字列にする', () => {
  assert.equal(layout.formatZoom(1), '100%');
  assert.equal(layout.formatZoom(0.6667), '67%');
  assert.equal(layout.formatZoom(9), '400%');
});

test('parsePageNumber は 1 起点の入力を 0 起点の添字にする', () => {
  assert.equal(layout.parsePageNumber('1', 3), 0);
  assert.equal(layout.parsePageNumber(' 3 ', 3), 2);
  assert.equal(layout.parsePageNumber('0', 3), null);
  assert.equal(layout.parsePageNumber('4', 3), null);
  assert.equal(layout.parsePageNumber('', 3), null);
  assert.equal(layout.parsePageNumber('abc', 3), null);
});

// --- サムネイル（spec-1-3 確定事項3・6・7） ---

test('layoutThumbnails は幅を揃え、高さを紙ごとに変える', () => {
  const landscape = { width: A4.height, height: A4.width };
  const { pages, sheetWidth } = layout.layoutThumbnails({ sizes: [A4, landscape, A5], columnWidth: 200 });

  assert.equal(sheetWidth, 200 - layout.THUMB_FRAME * 2);
  // ページビュー（layoutPages）と逆であることを固定する。あちらは幅が変わる。
  assert.deepEqual(pages.map((page) => page.sheetWidth), [sheetWidth, sheetWidth, sheetWidth]);
  assert.equal(pages[0].sheetHeight, Math.round((A4.height / A4.width) * sheetWidth));
  assert.ok(pages[1].sheetHeight < pages[0].sheetHeight, '横向きのページが縦のままになっている');
  // A4 と A5 は縦横比がほぼ同じなので、幅を揃えれば高さもほぼ同じになる。
  assert.ok(Math.abs(pages[2].sheetHeight - pages[0].sheetHeight) <= 1);
});

test('layoutThumbnails は間隔と余白を空けて積み、総高さを返す', () => {
  const { pages, totalHeight } = layout.layoutThumbnails({ sizes: [A4, A4, A4], columnWidth: 200 });

  assert.equal(pages[0].top, layout.THUMB_MARGIN);
  assert.equal(pages[1].top, pages[0].top + pages[0].height + layout.THUMB_GAP);
  assert.equal(totalHeight, pages[2].top + pages[2].height + layout.THUMB_MARGIN);
  // 高さには紙のほかに枠とページ番号の分が乗る。
  assert.equal(pages[0].height, pages[0].sheetHeight + layout.THUMB_FRAME * 2 + layout.THUMB_CAPTION);
});

test('layoutThumbnails はページが無くても、幅が取れなくても落ちない', () => {
  const empty = layout.layoutThumbnails({ sizes: [], columnWidth: 200 });
  assert.deepEqual(empty.pages, []);
  assert.equal(empty.totalHeight, 0);

  // 壊れたページ（幅0）でも枠は並べる。番号を出すため。
  const broken = layout.layoutThumbnails({ sizes: [{ width: 0, height: 0 }], columnWidth: 200 });
  assert.equal(broken.pages.length, 1);
  assert.ok(broken.pages[0].sheetHeight > 0);

  // サイドパネルが極端に細くても紙の幅は 1px 以上にする。
  const narrow = layout.layoutThumbnails({ sizes: [A4], columnWidth: 0 });
  assert.ok(narrow.sheetWidth >= 1);
});

// 返す形を layoutPages に揃えたのは、可視範囲の判定を作り直さないためである
// （確定事項3）。実際に流用できることをここで固定する。
test('layoutThumbnails の返り値で visibleRange と currentPageIndex が動く', () => {
  const { pages } = layout.layoutThumbnails({ sizes: [A4, A4, A4, A4], columnWidth: 200 });

  assert.deepEqual(layout.visibleRange({ pages, scrollTop: 0, viewportHeight: 400 }), { first: 0, last: 1 });
  assert.equal(layout.currentPageIndex({ pages, scrollTop: pages[2].top, viewportHeight: 400 }), 2);
});

test('thumbnailScale は紙の幅ぴったりに描く倍率を返し、上限2で頭打ちにする', () => {
  // CSS_UNITS は掛けない。狙うのは実寸の何倍かではなく、幅が何ピクセルになるかである。
  assert.equal(layout.thumbnailScale({ sheetWidth: 190, pageWidth: 380, devicePixelRatio: 1 }), 0.5);
  assert.equal(layout.thumbnailScale({ sheetWidth: 190, pageWidth: 380, devicePixelRatio: 2 }), 1);
  // ページビューの上限は3。サムネイルは24枚持つので2で止める。
  assert.equal(layout.thumbnailScale({ sheetWidth: 190, pageWidth: 380, devicePixelRatio: 8 }), 1);
  assert.equal(layout.MAX_THUMB_SCALE, 2);
  assert.ok(layout.MAX_THUMB_SCALE < layout.MAX_CANVAS_SCALE);

  assert.equal(layout.thumbnailScale({ sheetWidth: 190, pageWidth: 0 }), 1);
  assert.equal(layout.thumbnailScale({ sheetWidth: 0, pageWidth: 380 }), 1);
});

// サムネイルは小さいので、ページビューの8枚より多く持てる（確定事項6）。
test('renderTargets はサムネイルの上限24でも同じ規則で切り詰める', () => {
  const targets = layout.renderTargets({ count: 200, first: 40, last: 90, current: 60, max: layout.MAX_THUMBS });

  assert.equal(layout.MAX_THUMBS, 24);
  assert.equal(targets.length, 24);
  assert.ok(targets.includes(60), '現在ページが落ちている');
});

// ---- 多列グリッド（spec-1-5 D。ページモードのサイドパネル） ----

// サイドパネルは 180〜420px でドラッグできる。固定の列数にすると、どこかの幅で
// 必ず破綻する（確定事項24）。
// 実機では縦スクロールバー（約16px）のぶん、内容幅がパネル幅より狭くなる。
// 確定事項23 の実測表はこれを勘定に入れていなかったので、ここでは実測に
// 合わせた内容幅で列数を確かめる（表の列数そのものは満たす）。
const SCROLLBAR = 16;

test('thumbnailColumns はパネルの幅から 1〜3 列を決める（確定事項23）', () => {
  const content = (panelWidth) => panelWidth - layout.THUMB_MARGIN * 2 - SCROLLBAR;

  assert.equal(layout.thumbnailColumns(content(180)), 1);
  assert.equal(layout.thumbnailColumns(content(240)), 2);
  assert.equal(layout.thumbnailColumns(content(300)), 2);
  assert.equal(layout.thumbnailColumns(content(340)), 3);
  assert.equal(layout.thumbnailColumns(content(420)), 3);
});

test('thumbnailColumns は上限3・下限1で頭打ちにする', () => {
  assert.equal(layout.thumbnailColumns(9999), 3);
  assert.equal(layout.thumbnailColumns(0), 1);
  assert.equal(layout.thumbnailColumns(Number.NaN), 1);
});

// 固定の2列にすると、最小幅では紙が 65px まで縮む。自動にする理由がこれである。
test('列数を自動で決めれば、どの幅でも紙は 80px を下回らない', () => {
  for (const panelWidth of [180, 240, 300, 340, 420]) {
    const columnWidth = panelWidth - layout.THUMB_MARGIN * 2 - SCROLLBAR;
    const columns = layout.thumbnailColumns(columnWidth);
    const { sheetWidth } = layout.layoutThumbnails({ sizes: [A4], columnWidth, columns });

    assert.ok(sheetWidth >= 80, panelWidth + 'px で紙が ' + sheetWidth + 'px になった');
  }
});

test('layoutThumbnails は多列で left を返し、行ごとに積む', () => {
  const { pages } = layout.layoutThumbnails({ sizes: [A4, A4, A4, A4, A4], columnWidth: 320, columns: 3 });

  // 1行目の3枚は同じ高さに並ぶ。
  assert.equal(pages[1].top, pages[0].top);
  assert.equal(pages[2].top, pages[0].top);
  assert.equal(pages[0].left, 0);
  assert.ok(pages[0].left < pages[1].left && pages[1].left < pages[2].left);

  // 2行目は左端へ戻り、1行ぶん下がる。
  assert.equal(pages[3].left, 0);
  assert.equal(pages[3].top, pages[0].top + pages[0].height + layout.THUMB_GAP);
  assert.equal(pages[4].left, pages[1].left);
});

test('多列でも紙はパネルの幅に収まる', () => {
  const columnWidth = 320;
  const { pages, sheetWidth } = layout.layoutThumbnails({ sizes: [A4, A4, A4], columnWidth, columns: 3 });
  const rightEdge = pages[2].left + pages[2].width;

  assert.ok(rightEdge <= columnWidth, rightEdge + 'px が ' + columnWidth + 'px からはみ出している');
  assert.equal(sheetWidth, pages[0].width - layout.THUMB_FRAME * 2);
});

// 閲覧モードのサイドパネルは1列のまま変えない（確定事項28）。塊③-a の回帰を防ぐ。
test('columns:1 の返り値は columns を渡さないときと同じ（確定事項25）', () => {
  const sizes = [A4, { width: A4.height, height: A4.width }, A5];
  const before = layout.layoutThumbnails({ sizes, columnWidth: 220 });
  const after = layout.layoutThumbnails({ sizes, columnWidth: 220, columns: 1 });

  assert.equal(after.sheetWidth, before.sheetWidth);
  assert.equal(after.totalHeight, before.totalHeight);
  assert.deepEqual(after.pages.map((page) => page.top), before.pages.map((page) => page.top));
  assert.deepEqual(after.pages.map((page) => page.height), before.pages.map((page) => page.height));
  assert.deepEqual(after.pages.map((page) => page.sheetHeight), before.pages.map((page) => page.sheetHeight));
  // 1列では左端に揃う（shell.css の .thumb{left:0} と同じ）。
  assert.deepEqual(after.pages.map((page) => page.left), [0, 0, 0]);
});

test('行の高さは、その行でいちばん高い紙に合わせる', () => {
  const landscape = { width: A4.height, height: A4.width };
  const { pages } = layout.layoutThumbnails({ sizes: [landscape, A4, landscape, A4], columnWidth: 320, columns: 3 });
  const tallest = Math.max(pages[0].height, pages[1].height, pages[2].height);

  assert.ok(pages[1].height > pages[0].height, '縦向きのほうが高くなっていない');
  assert.equal(pages[3].top, pages[0].top + tallest + layout.THUMB_GAP);
});

test('多列では総高さも行の単位で積む', () => {
  const { pages, totalHeight } = layout.layoutThumbnails({ sizes: [A4, A4, A4, A4], columnWidth: 320, columns: 3 });

  // 4枚・3列なら2行。総高さは2行ぶんで、4枚ぶんではない。
  assert.equal(totalHeight, pages[3].top + pages[3].height + layout.THUMB_MARGIN);
  assert.ok(totalHeight < layout.THUMB_MARGIN * 2 + pages[0].height * 3);
});

// 多列では紙が小さくなるので、枚数が増えても総メモリは1列時を下回る
// （幅240pxで 1列210px 対 2列105px ＝ 面積比4倍）。
test('maxThumbs は列数のぶんだけ増やす（確定事項26）', () => {
  assert.equal(layout.maxThumbs(1), layout.MAX_THUMBS);
  assert.equal(layout.maxThumbs(2), layout.MAX_THUMBS * 2);
  assert.equal(layout.maxThumbs(3), layout.MAX_THUMBS * 3);
  assert.equal(layout.maxThumbs(0), layout.MAX_THUMBS);
});

// 先読みは枚数で数えるので、多列のまま 4 では1.3行ぶんにしかならない。
// 上限を列数倍にした以上、先読みも揃えないと上限に届かない（2026-09-01 実測）。
test('先読みも列数のぶんだけ増やす', () => {
  assert.equal(layout.thumbAhead(1), layout.THUMB_AHEAD);
  assert.equal(layout.thumbAhead(3), layout.THUMB_AHEAD * 3);
  assert.equal(layout.thumbAhead(0), layout.THUMB_AHEAD);
  // 1列（閲覧モード）では塊③-a の実測値のまま変わらない。
  assert.equal(layout.thumbAhead(1), 4);
});

test('多列の返り値でも visibleRange と currentPageIndex が動く', () => {
  const sizes = Array.from({ length: 9 }, () => A4);
  const { pages } = layout.layoutThumbnails({ sizes, columnWidth: 320, columns: 3 });
  const range = layout.visibleRange({ pages, scrollTop: 0, viewportHeight: 200 });

  // 同じ行の3枚はまとめて見える。可視範囲は行の単位で返る。
  assert.equal(range.first, 0);
  assert.ok(range.last >= 2, '同じ行の3枚が可視範囲に入っていない');
  assert.equal(layout.currentPageIndex({ pages, scrollTop: pages[3].top, viewportHeight: 200 }), 3);
});

// ---- 見開き（spec-2-3 確定事項7〜20） ----

const LANDSCAPE = { width: A4.height, height: A4.width };

// 単ページの返り値は塊③ の前と完全に同じであること（回帰）。
test('facing を渡さなければ layoutPages の結果は従来どおり', () => {
  const sizes = [A4, A5, LANDSCAPE];
  const before = layout.layoutPages({ sizes, zoom: 1 });
  const explicit = layout.layoutPages({ sizes, zoom: 1, facing: false });

  assert.deepEqual(explicit, before);
  // 縦1列・中央寄せのまま。いちばん広い横向きのページが器の幅になる。
  assert.equal(before.contentWidth, before.pages[2].width);
  assert.deepEqual(
    before.pages.map((page) => page.left),
    before.pages.map((page) => Math.round((before.contentWidth - page.width) / 2)),
  );
  assert.equal(before.pages[1].top, before.pages[0].top + before.pages[0].height + layout.PAGE_GAP);
});

test('見開きでは 1-2, 3-4 が同じ高さに並び、左右に振り分けられる（確定事項7・9・10）', () => {
  const { pages, contentWidth, totalHeight } = layout.layoutPages({ sizes: [A4, A4, A4, A4], zoom: 1 });
  const facing = layout.layoutPages({ sizes: [A4, A4, A4, A4], zoom: 1, facing: true });
  const [p1, p2, p3, p4] = facing.pages;

  assert.equal(p1.top, layout.PAGE_MARGIN);
  assert.equal(p2.top, p1.top, '組の2枚は同じ top');
  assert.equal(p1.left, 0);
  assert.equal(p2.left, p1.width + layout.FACING_GAP);
  assert.equal(facing.contentWidth, p1.width + layout.FACING_GAP + p2.width);
  // 2行目は1行ぶん下がる。
  assert.equal(p3.top, p1.top + p1.height + layout.PAGE_GAP);
  assert.equal(p4.top, p3.top);
  assert.equal(p3.left, 0);
  assert.equal(p4.left, p2.left);
  // 2行ぶんの総高さ。4ページぶんではない。
  assert.equal(facing.totalHeight, p3.top + p3.height + layout.PAGE_MARGIN);
  assert.ok(facing.totalHeight < totalHeight);
  assert.ok(facing.contentWidth > contentWidth);
  assert.equal(pages.length, facing.pages.length);
});

test('見開きで奇数の末尾は左に単独で置く（確定事項7）', () => {
  const { pages, contentWidth } = layout.layoutPages({ sizes: [A4, A4, A4], zoom: 1, facing: true });

  assert.equal(pages[2].left, 0);
  assert.equal(pages[2].top, pages[0].top + pages[0].height + layout.PAGE_GAP);
  // 器の幅は2枚ぶんのまま。末尾だけ狭くならない。
  assert.equal(contentWidth, pages[0].width + layout.FACING_GAP + pages[1].width);
});

test('見開きで行の高さは組の高いほうに合わせ、上揃えにする（確定事項9）', () => {
  const { pages } = layout.layoutPages({ sizes: [LANDSCAPE, A4, A4, A4], zoom: 1, facing: true });

  assert.ok(pages[0].height < pages[1].height, '横向きのほうが低くなっていない');
  assert.equal(pages[0].top, pages[1].top);
  assert.equal(pages[2].top, pages[1].top + pages[1].height + layout.PAGE_GAP);
});

test('見開きで幅の違うページが混ざっても綴じ目が一直線に通る（確定事項10）', () => {
  const { pages, contentWidth } = layout.layoutPages({ sizes: [A5, A4, A4, A5], zoom: 1, facing: true });
  const leftHalf = Math.max(pages[0].width, pages[2].width);
  const rightHalf = Math.max(pages[1].width, pages[3].width);

  // 左ページは綴じ目へ右寄せ。狭い A5 は右端が A4 と揃う。
  assert.equal(pages[0].left + pages[0].width, leftHalf);
  assert.equal(pages[2].left + pages[2].width, leftHalf);
  // 右ページは綴じ目から左寄せ。
  assert.equal(pages[1].left, leftHalf + layout.FACING_GAP);
  assert.equal(pages[3].left, leftHalf + layout.FACING_GAP);
  assert.equal(contentWidth, leftHalf + layout.FACING_GAP + rightHalf);
});

test('見開きでも1ページの文書は器に余白を作らない（確定事項10）', () => {
  const { pages, contentWidth } = layout.layoutPages({ sizes: [A4], zoom: 1, facing: true });

  assert.equal(pages[0].left, 0);
  assert.equal(contentWidth, pages[0].width);
  assert.deepEqual(layout.layoutPages({ sizes: [], zoom: 1, facing: true }).pages, []);
});

test('見開きの返り値でも visibleRange と scrollTopForPage が動く', () => {
  const { pages } = layout.layoutPages({ sizes: [A4, A4, A4, A4], zoom: 1, facing: true });
  const range = layout.visibleRange({ pages, scrollTop: 0, viewportHeight: 300 });

  // 同じ行の2枚はまとめて見える。
  assert.deepEqual(range, { first: 0, last: 1 });
  // 右ページを指定しても組の先頭（行の上端）へ飛ぶ。
  assert.equal(layout.scrollTopForPage({ pages, index: 3 }), layout.scrollTopForPage({ pages, index: 2 }));
  // 同じ行なら若い番号（左）が現在ページになる。補正は page-render 側で行う（確定事項13）。
  assert.equal(layout.currentPageIndex({ pages, scrollTop: 0, viewportHeight: 300 }), 0);
});

test('spreadStart は組の先頭を返す（確定事項14）', () => {
  assert.equal(layout.spreadStart(0, true), 0);
  assert.equal(layout.spreadStart(1, true), 0);
  assert.equal(layout.spreadStart(2, true), 2);
  assert.equal(layout.spreadStart(5, true), 4);
  // 単ページではそのページ自身。
  assert.equal(layout.spreadStart(5, false), 5);
  assert.equal(layout.spreadStart(5), 5);
});

test('spreadSize は組の2枚ぶんの寸法を返す（確定事項18〜20）', () => {
  const sizes = [A4, A5, LANDSCAPE];

  // 単ページではそのページの寸法。
  assert.deepEqual(layout.spreadSize(sizes, 1, false), A5);
  // 見開きでは幅の和と高さの最大。右ページを指しても同じ組の寸法になる。
  assert.deepEqual(layout.spreadSize(sizes, 0, true), { width: A4.width + A5.width, height: Math.max(A4.height, A5.height) });
  assert.deepEqual(layout.spreadSize(sizes, 1, true), layout.spreadSize(sizes, 0, true));
  // 末尾の単独ページは幅を2倍して見なす。送るたびに倍率が跳ねないため。
  assert.deepEqual(layout.spreadSize(sizes, 2, true), { width: LANDSCAPE.width * 2, height: LANDSCAPE.height });
  assert.deepEqual(layout.spreadSize([], 0, true), { width: 0, height: 0 });
});

test('fitWidthZoom / fitPageZoom は gap を引いてから合わせる（確定事項18・19）', () => {
  const single = layout.fitWidthZoom({ pageWidth: A4.width, viewportWidth: 900 });
  const spread = layout.fitWidthZoom({ pageWidth: A4.width * 2, viewportWidth: 900, gap: layout.FACING_GAP });
  const drawn = A4.width * 2 * spread * layout.CSS_UNITS;

  assert.equal(Math.round(drawn), 900 - layout.SIDE_MARGIN * 2 - layout.FACING_GAP);
  assert.ok(spread < single / 2, '2枚＋間隔ぶん小さくなっていない');
  // gap を渡さなければ従来どおり。
  assert.equal(layout.fitWidthZoom({ pageWidth: A4.width, viewportWidth: 900, gap: 0 }), single);

  const byPage = layout.fitPageZoom({
    pageWidth: A4.width * 2, pageHeight: A4.height, viewportWidth: 900, viewportHeight: 700, gap: layout.FACING_GAP,
  });
  assert.ok(byPage <= spread);
  assert.ok(A4.height * byPage * layout.CSS_UNITS <= 700);
});

test('renderTargets は見開きの先読み 2 でも同じ規則で動く（確定事項12）', () => {
  assert.equal(layout.FACING_AHEAD, 2);
  assert.deepEqual(layout.renderTargets({ count: 10, first: 2, last: 3, current: 2, ahead: layout.FACING_AHEAD }), [0, 1, 2, 3, 4, 5]);
});
