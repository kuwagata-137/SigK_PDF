'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 帯の紙の描き方（spec-2-5 確定事項D8。危ない所「メモリ」）。描くのは見えている帯と紙（先読みを含む）だけで、全部の帯の合計で
// 160 枚まで、同時に 2 本まで。jsdom には 2D コンテキストが無いので canvas は null だが、持っている数と手放しは同じ経路で見られる。

const A4 = { width: 595, height: 842 };
const pathOf = (index) => `C:\\work\\f${String(index).padStart(2, '0')}.pdf`;

async function withTabs(t, { count = 3, pages = 3 } = {}) {
  const files = Object.fromEntries(Array.from({ length: count }, (_unused, index) => [pathOf(index), makeSource({ path: pathOf(index) })]));
  const pdfjs = createPdfjsStub({ sizes: Array.from({ length: pages }, () => A4) });
  const shell = await createShell({ files, pdfjs });
  t.after(() => shell.cleanup());
  for (let index = 0; index < count; index += 1)
    await shell.SigK.tabs.openPath(pathOf(index));
  shell.SigK.shell.setMode(shell.document, 'tools');
  await shell.flush();
  return shell;
}

// 描き終えるまで待つ。途中の数も控える（同時に描く数と持つ数の上限を見張る）。
async function settle(shell, seen = { drawn: 0, pending: 0 }) {
  for (let round = 0; round < 200; round += 1) {
    await shell.flush();
    const now = shell.SigK.stripThumbs.getState();
    seen.drawn = Math.max(seen.drawn, now.drawn);
    seen.pending = Math.max(seen.pending, now.pending);
    if (now.pending === 0 && now.queued === 0)
      return seen;
  }
  throw new Error('描き終わらない');
}

const keys = (SigK) => [...SigK.stripThumbs.getState().keys];

test('出した帯の、見えている紙と左右の先読みだけを描く', async (t) => {
  const shell = await withTabs(t, { count: 3, pages: 40 });
  const { SigK } = shell;
  SigK.strips.setShown(true);
  await settle(shell);
  const ids = SigK.tabs.list().map((tab) => tab.id);
  // 幅 900 から余白 50 を引いた 850px に紙（セル 81px＋間 12px）が 10 枚見え、先読み 4 枚で 14 枚。高さ 600 に帯 3 本。
  assert.equal(SigK.stripThumbs.getState().drawn, 3 * 14);
  assert.ok(keys(SigK).includes(`${ids[0]}:13`));
  assert.equal(keys(SigK).includes(`${ids[0]}:14`), false);

  // 帯の中を横へスクロールすると、描く紙が移る。
  const pages = SigK.strips.rowNode(ids[0]).querySelector('.strip-pages');
  pages.scrollLeft = 93 * 20;
  pages.dispatchEvent(new shell.window.Event('scroll'));
  await settle(shell);
  assert.equal(keys(SigK).includes(`${ids[0]}:0`), false, '見えなくなった紙は手放す');
  assert.ok(keys(SigK).includes(`${ids[0]}:20`));
  assert.ok(keys(SigK).includes(`${ids[1]}:0`), 'ほかの帯は動かない');
});

test('帯 20 本・各 100 ページでも、持つのは 160 枚まで、同時に描くのは 2 本まで。隠すと全部手放す', async (t) => {
  const shell = await withTabs(t, { count: 20, pages: 100 });
  const { SigK, document, pdfjs } = shell;
  SigK.strips.setShown(true);
  const seen = await settle(shell);
  assert.ok(seen.pending <= 2, `同時に ${seen.pending} 本`);
  assert.ok(seen.drawn <= 160, `持つのは ${seen.drawn} 枚`);
  // 見えている帯 3 本と下の先読み 1 本。
  const tabsDrawn = new Set(keys(SigK).map((key) => key.split(':')[0]));
  assert.equal(tabsDrawn.size, 4);

  // いちばん下までスクロールすると、上の帯の紙は手放し、下の帯を描く。
  const strips = document.getElementById('strips');
  strips.scrollTop = 12 + 198 * 17;
  strips.dispatchEvent(new shell.window.Event('scroll'));
  await settle(shell, seen);
  const ids = SigK.tabs.list().map((tab) => String(tab.id));
  const nowTabs = new Set(keys(SigK).map((key) => key.split(':')[0]));
  assert.equal(nowTabs.has(ids[0]), false);
  assert.equal(nowTabs.has(ids[19]), true);
  assert.ok(seen.drawn <= 160 && seen.pending <= 2);

  const cleaned = pdfjs.cleanups.length;
  SigK.strips.setShown(false);
  assert.equal(SigK.stripThumbs.getState().drawn, 0);
  assert.ok(pdfjs.cleanups.length > cleaned, 'ページの資源も手放す');
});

test('閉じたタブの紙は文書を畳む前に手放し、中身が変わった紙は描き直す', async (t) => {
  const shell = await withTabs(t, { count: 2, pages: 3 });
  const { SigK, window, pdfjs } = shell;
  const calls = [];
  const original = window.SigK.planPageImage.draw;
  window.SigK.planPageImage.draw = (doc, view, index, options) => {
    calls.push(index);
    return original(doc, view, index, options);
  };
  SigK.strips.setShown(true);
  await settle(shell);
  const [a, b] = SigK.tabs.list().map((tab) => tab.id);
  assert.equal(SigK.stripThumbs.getState().drawn, 6);

  calls.length = 0;
  const cleaned = pdfjs.cleanups.length;
  SigK.pageEdit.rotate(90, [1]);   // 映しているのは b
  await settle(shell);
  assert.deepEqual(calls, [1], '回したページだけ描き直す');
  assert.equal(SigK.stripThumbs.getState().drawn, 6);
  assert.equal(pdfjs.cleanups.length, cleaned + 1, '差し替えた前の紙のページの資源も手放す（点検の直し）');

  SigK.tabs.forceCloseTab(a);
  await settle(shell);
  assert.deepEqual(keys(SigK).map((key) => key.split(':')[0]), [String(b), String(b), String(b)]);
});

// 紙 1 枚の描き方（plan-page-image.js）。2D コンテキストのある document のふりで描かせ、渡したものを見る。
test('紙 1 枚は今の並びの回転・切り取り・モザイクと、保存していない書き込みを重ねて描く', async () => {
  require('../renderer/page-plan.js');
  require('../renderer/page-image.js');
  require('../renderer/plan-page-image.js');
  const SigK = globalThis.SigK;
  const painted = [];
  SigK.annotationState = { annotsOnPage: (annots, imported, src) => [...(imported[src] ?? []), ...annots.added.filter((entry) => entry.src === src)] };
  SigK.annotationLayer = { paint: (ctx, entries, viewport) => painted.push({ entries, viewport }) };
  SigK.pdfjs = { lib: { AnnotationMode: { ENABLE_STORAGE: 3 } } };
  SigK.mosaicPaint = { paintOver: async (doc, canvas, page, viewport, mosaic) => { painted.push({ mosaic }); } };
  const makePage = (number, rotate = 0) => ({
    number, rotate, cleanup: () => true,
    getViewport: ({ scale, rotation }) => {
      const swapped = rotation % 180 !== 0;
      return { width: (swapped ? 842 : 595) * scale, height: (swapped ? 595 : 842) * scale, rotation };
    },
    render: (options) => ({ promise: Promise.resolve(options) }),
  });
  const doc = { getPage: async (number) => makePage(number, 90) };
  const insertDoc = { getPage: async (number) => makePage(100 + number) };
  const contexts = [];
  const domDoc = {
    defaultView: { CanvasRenderingContext2D: function CanvasRenderingContext2D() {} },
    createElement: () => ({ width: 0, height: 0, getContext: (...args) => { contexts.push(args); return {}; } }),
  };
  const view = {
    doc,
    plan: [{ src: 1, rotate: 90, mosaic: [{ box: [0, 0, 10, 10], block: 8 }] }, { insert: 0, rotate: 0 }],
    annots: { added: [{ id: 'a', src: 1, kind: 'shape' }], removed: [] },
    imported: { 1: [{ ref: '9R', kind: 'highlight' }] },
    inserts: [{ doc: insertDoc, page: 2 }],
  };

  const first = await SigK.planPageImage.draw(domDoc, view, 0, { sheet: { width: 147, height: 104 }, dpr: 3 });
  assert.equal(first.page.number, 2, 'src 1 は 2 ページ目');
  // ページの /Rotate 90 と plan の 90 で 180 度。幅 595pt を 147px × 画素比 2（上限）に。
  assert.equal(first.canvas.width, Math.round(147 * 2));
  assert.deepEqual(painted[0], { mosaic: view.plan[0].mosaic });
  assert.deepEqual(painted[1].entries.map((entry) => entry.kind), ['highlight', 'shape']);
  assert.equal(painted[1].viewport.rotation, 180);
  // 帯・盤の紙は CPU で描く canvas に描く（計画外の直し 2026-10-15。GPU の canvas では同時に描いた片方の字が欠けた）。
  assert.deepEqual(contexts, [['2d', { willReadFrequently: true }]]);

  painted.length = 0;
  const second = await SigK.planPageImage.draw(domDoc, view, 1, { sheet: { width: 74, height: 104 } });
  assert.equal(second.page.number, 103, '差し込んだ文書の 3 ページ目');
  assert.equal(painted.some((entry) => entry.entries !== undefined), false, '差し込んだページには書き込みを付けない');
  assert.equal(SigK.planPageImage.overlayFor(view, 1), null);
});

// 計画外の直し（2026-10-15）。描けなかったときは呼ぶ側（strip-thumbs.js）に page が渡らないので、描く関数の中で手放す。
test('紙を描けなかったときは、読んだページの資源を手放してから例外を返す', async () => {
  require('../renderer/page-plan.js');
  require('../renderer/page-image.js');
  require('../renderer/plan-page-image.js');
  const SigK = globalThis.SigK;
  SigK.annotationState = { annotsOnPage: () => [] };
  const cleaned = [];
  const page = { rotate: 0, cleanup: () => cleaned.push('page'), getViewport: ({ scale }) => ({ width: 595 * scale, height: 842 * scale }) };
  const view = { doc: { getPage: async () => page }, plan: [{ src: 0 }], annots: { added: [], removed: [] }, imported: {}, inserts: [] };
  const original = SigK.pageImage.renderToCanvas;
  SigK.pageImage.renderToCanvas = async () => { throw new Error('broken'); };
  try {
    await assert.rejects(SigK.planPageImage.draw({}, view, 0, { sheet: { width: 74, height: 104 } }), /broken/);
  } finally {
    SigK.pageImage.renderToCanvas = original;
  }
  assert.deepEqual(cleaned, ['page']);
});
