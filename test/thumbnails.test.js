'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, DEFAULT_SIDE, A4 } = require('./harness.js');

// サイドパネルのサムネイル（spec-1-3 確定事項1〜16）。
//
// jsdom はレイアウトしないので、紙の寸法は #side-scroll の clientWidth を
// 注入して確かめる（ハーネスの applySide）。見た目そのものは npm start の
// 実測で見る。

const A5 = { width: 419.53, height: 595.28 };

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

async function withShell(t, options) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  return shell;
}

async function withOpenDocument(t, options = {}) {
  const shell = await withShell(t, options);
  await shell.SigK.viewer.open(source());
  await shell.flush();
  return shell;
}

function thumbsIn(document) {
  return [...document.querySelectorAll('#thumbs .thumb')];
}

test('起動直後はプレースホルダーだけが出ている', async (t) => {
  const { document } = await withShell(t);

  assert.equal(document.getElementById('thumbs').hidden, true);
  assert.equal(document.getElementById('thumbs-empty').hidden, false);
  assert.equal(thumbsIn(document).length, 0);
});

test('文書を開くと全ページ分の枠が並ぶ', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const thumbs = thumbsIn(document);

  assert.equal(thumbs.length, 3);
  assert.equal(document.getElementById('thumbs-empty').hidden, true);
  assert.equal(SigK.thumbnails.getState().count, 3);
  // 番号を出す（確定事項9）。紙だけでは何ページ目か分からない。
  assert.deepEqual(thumbs.map((node) => node.querySelector('.cap').textContent), ['1', '2', '3']);
});

// 幅を揃えて高さが紙ごとに変わる。ページビューとは逆である（確定事項3）。
test('枠は幅を揃え、高さを紙ごとに変える', async (t) => {
  const landscape = { width: A4.height, height: A4.width };
  const { document, SigK } = await withOpenDocument(t, {
    pdfjs: createPdfjsStub({ sizes: [A4, landscape, A5] }),
  });
  const thumbs = thumbsIn(document);
  const layout = SigK.viewerLayout;

  const columnWidth = DEFAULT_SIDE.width - layout.THUMB_MARGIN * 2;
  assert.equal(SigK.thumbnails.getState().columnWidth, columnWidth);
  assert.deepEqual(thumbs.map((node) => node.style.width), thumbs.map(() => `${columnWidth}px`));

  const heights = thumbs.map((node) => Number.parseInt(node.style.height, 10));
  assert.ok(heights[1] < heights[0], '横向きのページが縦のままになっている');
  // 枠は上から順に、間隔を空けて積む。
  const tops = thumbs.map((node) => Number.parseInt(node.style.top, 10));
  assert.equal(tops[0], layout.THUMB_MARGIN);
  assert.equal(tops[1], tops[0] + heights[0] + layout.THUMB_GAP);
});

// 全部を先に描くとメモリが尽きる。枠だけ先に置き、中身は見える分だけ入れる
// （確定事項2）。
test('描くのは見えている範囲だけである', async (t) => {
  const { SigK } = await withOpenDocument(t, {
    pdfjs: createPdfjsStub({ sizes: Array.from({ length: 40 }, () => A4) }),
  });
  const state = SigK.thumbnails.getState();

  assert.equal(state.count, 40);
  assert.ok(state.rendered.length > 0, '1枚も描いていない');
  assert.ok(state.rendered.length < 40, `40枚とも描いている（${state.rendered.length}枚）`);
  assert.ok(state.rendered.length <= SigK.viewerLayout.MAX_THUMBS, '上限を超えている');
  assert.equal(state.rendered[0], 0, '先頭から描いていない');
});

test('遠くへスクロールすると、そこだけを描いて手前は捨てる', async (t) => {
  const { SigK, scrollSide, flush } = await withOpenDocument(t, {
    pdfjs: createPdfjsStub({ sizes: Array.from({ length: 40 }, () => A4) }),
  });
  const before = SigK.thumbnails.getState().rendered;

  scrollSide(6000);
  await flush();
  const after = SigK.thumbnails.getState().rendered;

  assert.notDeepEqual(after, before);
  assert.ok(after[0] > before.at(-1), `手前を捨てていない: ${after[0]} <= ${before.at(-1)}`);
  assert.ok(after.length <= SigK.viewerLayout.MAX_THUMBS);
});

test('現在ページに枠が付き、ページを送ると移る', async (t) => {
  const { document, SigK } = await withOpenDocument(t);

  assert.deepEqual(thumbsIn(document).map((node) => node.classList.contains('current')), [true, false, false]);

  SigK.viewer.goToPage(2);
  assert.deepEqual(thumbsIn(document).map((node) => node.classList.contains('current')), [false, false, true]);
  assert.equal(SigK.thumbnails.getState().current, 2);
});

// jsdom は scrollIntoView を実装しない。呼ばれたことだけを見る（確定事項11）。
test('現在ページが見えていなければ寄せる', async (t) => {
  const { document, SigK } = await withOpenDocument(t);
  const calls = [];
  for (const node of thumbsIn(document))
    node.scrollIntoView = function stub() { calls.push(this.dataset.page); };

  SigK.viewer.goToPage(2);
  assert.deepEqual(calls, ['3']);
});

test('サムネイルをクリックするとそのページへ飛ぶ', async (t) => {
  const { document, window, SigK } = await withOpenDocument(t);

  thumbsIn(document)[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(SigK.viewer.getState().current, 2);

  // 紙の上を押しても同じ。枠まで遡って番号を読む。
  thumbsIn(document)[0].querySelector('.sheet').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(SigK.viewer.getState().current, 0);
});

// 畳んでいる間の描画は誰にも見えない（確定事項14）。
test('サイドパネルを畳むと枠ごと捨て、開くと作り直す', async (t) => {
  const { document, SigK } = await withOpenDocument(t);

  SigK.shell.setSidePanelOpen(document, false);
  assert.equal(thumbsIn(document).length, 0);
  assert.equal(SigK.thumbnails.getState().rendered.length, 0);

  SigK.shell.setSidePanelOpen(document, true);
  assert.equal(thumbsIn(document).length, 3);
});

// 出すのは閲覧モードのときだけ。ほかは従来のプレースホルダー（確定事項1）。
test('閲覧モード以外ではサムネイルを出さない', async (t) => {
  const { document, SigK } = await withOpenDocument(t);

  SigK.shell.setMode(document, 'pages');
  assert.equal(thumbsIn(document).length, 0);
  assert.equal(document.getElementById('thumbs-empty').hidden, false);

  SigK.shell.setMode(document, 'view');
  assert.equal(thumbsIn(document).length, 3);
});

// 幅が変われば紙の寸法が変わる（確定事項15）。
test('サイドパネルの幅を変えると作り直す', async (t) => {
  const { document, SigK, resizeSide, flush } = await withOpenDocument(t);
  const before = Number.parseInt(thumbsIn(document)[0].style.height, 10);

  resizeSide(400);
  await flush();

  const state = SigK.thumbnails.getState();
  assert.equal(state.columnWidth, 400 - SigK.viewerLayout.THUMB_MARGIN * 2);
  assert.ok(Number.parseInt(thumbsIn(document)[0].style.height, 10) > before, '紙が大きくなっていない');
});

// タブの間で canvas を持ち越さない。持ち越すのは見ていた場所だけ（確定事項13）。
test('タブを切り替えると canvas は捨て、スクロール位置だけ戻す', async (t) => {
  const { document, SigK, scrollSide, flush } = await withOpenDocument(t, {
    pdfjs: createPdfjsStub({ sizes: Array.from({ length: 40 }, () => A4) }),
  });

  scrollSide(3000);
  await flush();
  const session = SigK.viewer.detach();

  assert.equal(session.thumbScrollTop, 3000);
  assert.equal(thumbsIn(document).length, 0, '畳んだのに枠が残っている');
  assert.equal(SigK.thumbnails.getState().rendered.length, 0, 'canvas を持ち越している');

  SigK.viewer.attach(session);
  await flush();
  assert.equal(document.getElementById('side-scroll').scrollTop, 3000);
  assert.equal(thumbsIn(document).length, 40);
});

test('文書を閉じるとプレースホルダーへ戻る', async (t) => {
  const { document, SigK } = await withOpenDocument(t);

  SigK.viewer.close();
  assert.equal(thumbsIn(document).length, 0);
  assert.equal(document.getElementById('thumbs').hidden, true);
  assert.equal(document.getElementById('thumbs-empty').hidden, false);
  assert.equal(SigK.thumbnails.getState().open, false);
});

// サムネイルの文字を選びたい場面が無く、24枚分の span は無駄である（確定事項16）。
test('サムネイルにはテキストレイヤーを貼らない', async (t) => {
  const { document } = await withOpenDocument(t);

  assert.equal(document.querySelectorAll('#thumbs .textLayer').length, 0);
});
