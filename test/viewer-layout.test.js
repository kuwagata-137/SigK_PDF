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
