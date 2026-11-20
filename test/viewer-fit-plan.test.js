'use strict';

// ［全体］・［幅］を選んでいる時に並びを変えたら、今のページに合わせて倍率を計算し直す（docs/07 決定100 ④）。
// 前は applyPlan が state.fit を見ず、写真を［全体］で開いて回転すると、倍率が 12% のままで縦長のページが表示域からはみ出した
// （［全体］を押し直すと 11% になった）。回転以外の並びの変更（トリミング・削除など）でも、今のページの大きさが変われば計算し直す。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

const LANDSCAPE = { width: 842, height: 595 };

async function withOpenDocument(t, { sizes = [A4, A4, A4], canvas = false } = {}) {
  const shell = await createShell({ pdfjs: createPdfjsStub({ sizes }) });
  t.after(() => shell.cleanup());
  if (canvas) {
    // jsdom には 2D コンテキストが無いので、テストの中だけ「描ける」ことにして canvas を貼らせる（zoom-keep-picture.test.js と同じ）。
    shell.window.CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
    shell.window.HTMLCanvasElement.prototype.getContext = () => ({});
  }
  await shell.flush();
  await shell.SigK.viewer.open(makeSource({ path: 'C:\\work\\fit.pdf' }));
  await shell.flush();
  await shell.flush();
  return shell;
}

// 同じ状態で［全体］か［幅］を押し直した時の倍率（計算し直した倍率と一致するはず）。
function refitZoom(SigK, mode) {
  SigK.viewer.applyFit(mode);
  return SigK.viewer.getState().zoom;
}

test('［全体］で今のページを回転すると、倍率を計算し直す（押し直した時と同じ倍率）', async (t) => {
  const { SigK } = await withOpenDocument(t);
  SigK.viewer.applyFit('page');
  const before = SigK.viewer.getState().zoom;

  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));
  const after = SigK.viewer.getState().zoom;

  assert.notEqual(after, before, '横長になったので倍率が変わる');
  assert.equal(SigK.viewer.getState().fit, 'page', '［全体］は選択されたまま');
  assert.equal(refitZoom(SigK, 'page'), after);
});

test('［幅］で今のページをトリミングすると、倍率を計算し直す', async (t) => {
  const { SigK } = await withOpenDocument(t);
  SigK.viewer.applyFit('width');
  const before = SigK.viewer.getState().zoom;

  const plan = SigK.viewer.getPlan();
  plan[0] = { ...plan[0], crop: [100, 100, 400, 700] };
  SigK.viewer.applyPlan(plan);
  const after = SigK.viewer.getState().zoom;

  assert.ok(after > before, '幅が狭くなったので倍率が上がる');
  assert.equal(SigK.viewer.getState().fit, 'width');
  assert.equal(refitZoom(SigK, 'width'), after);
});

test('［全体］で今のページを削除し、大きさの違うページが今のページになると、倍率を計算し直す', async (t) => {
  const { SigK } = await withOpenDocument(t, { sizes: [A4, LANDSCAPE, A4] });
  SigK.viewer.applyFit('page');
  const before = SigK.viewer.getState().zoom;

  SigK.viewer.applyPlan(SigK.viewer.getPlan().slice(1));
  const after = SigK.viewer.getState().zoom;

  assert.equal(SigK.viewer.getState().current, 0);
  assert.notEqual(after, before);
  assert.equal(refitZoom(SigK, 'page'), after);
});

test('［全体］で今のページの大きさが変わらない並べ替えでは、倍率は変わらない', async (t) => {
  const { SigK } = await withOpenDocument(t);
  SigK.viewer.applyFit('page');
  const before = SigK.viewer.getState().zoom;

  SigK.viewer.applyPlan([...SigK.viewer.getPlan()].reverse());

  assert.equal(SigK.viewer.getState().zoom, before);
});

test('［全体］・［幅］を選んでいない時は、回転しても倍率は変わらない', async (t) => {
  const { SigK } = await withOpenDocument(t);
  SigK.viewer.setZoom(1);

  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));

  assert.equal(SigK.viewer.getState().zoom, 1);
  assert.equal(SigK.viewer.getState().fit, null);
});

test('倍率と回転が同時に変わっても、新しい絵を描き終えるまで前の絵を表示する（決定99 ②）', async (t) => {
  const shell = await withOpenDocument(t, { canvas: true });
  const { SigK, document } = shell;
  SigK.viewer.applyFit('page');
  await shell.flush();
  await shell.flush();
  const node = () => document.querySelector('.pdf-page[data-page="1"]');
  assert.ok(node().querySelector(':scope > canvas'), '描き終えた絵がある');

  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));

  assert.ok(node().querySelector(':scope > .pdf-held > canvas'), '前の絵を、絵を置く要素に入れて表示している');
});
