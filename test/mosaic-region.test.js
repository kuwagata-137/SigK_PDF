'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-crop.js');
require('../renderer/page-mosaic.js');
require('../renderer/mosaic-paint.js');
require('../renderer/mosaic-region.js');
const { MODES, PageViewport, pixelCanvas, fakePage, pixelDoc, drawnCanvas, expectedCanvas, differences } = require('./pdf-pixel-fakes.js');

const paint = globalThis.SigK.mosaicPaint;
const region = globalThis.SigK.mosaicRegion;
globalThis.SigK.pdfjs = { lib: { AnnotationMode: MODES } };

// 範囲の絵から色を読む塗り方（決定99 ①。mosaic-region.js）。paintRegions・paintAppended の画素が、今の塗り方（mosaic-paint.js の
// paintOver）と一致すること、表示中の大きな canvas から色を読まないこと、書き込む直前の確認（alive）を確かめる。偽物は pdf-pixel-fakes.js。

const item = (box, block) => ({ box, block });
// 紙 500 × 500pt。A と B は重なり、D は B とだけ重なる（A・B・D で 1 つのまとまり）。C は離れている。置いた順は A・C・B・D。
const PAGE_500 = [0, 0, 500, 500];
const MOSAIC = [item([40, 300, 200, 460], 8), item([350, 50, 470, 170], 4), item([150, 380, 320, 480], 14), item([300, 420, 420, 470], 8)];
// トリミングの箱（原点がずれていて、A の左端は箱の外）。
const CROP = [60, 30, 600, 550];
// A と B が重なる所にある、表示のみの書き込み。
const ANNOT = [160, 400, 176, 416];

test('groupsOf は、画素の四角が重なり合う範囲をまとめ（つながりもたどる）、置いた順を保つ。区切りが正しくない・canvas の外の範囲は除く', () => {
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const size = { width: 1000, height: 1000 };
  const groups = region.groupsOf(viewport, [...MOSAIC, item([600, 600, 700, 700], 8), item([10, 10, 10, 50], 8), item([0, 0, 10, 10], 0)], size);
  assert.deepEqual(groups.map((group) => group.items.map((entry) => MOSAIC.indexOf(entry))), [[0, 2, 3], [1]]);
  assert.deepEqual(groups[0].rects, [[80, 80, 400, 400], [300, 40, 640, 240], [600, 60, 840, 160]]);
  assert.deepEqual(groups[0].area, [80, 40, 840, 400]);
  assert.deepEqual(groups[1].area, [700, 660, 940, 900]);
  // 後から置いた範囲が、離れていた 2 つのまとまりをつなぐと、1 つにまとまる（置いた順のまま）。
  const bridge = item([180, 150, 360, 320], 8);
  assert.deepEqual(region.groupsOf(viewport, [MOSAIC[0], MOSAIC[1], bridge], size).map((group) => group.items), [[MOSAIC[0], MOSAIC[1], bridge]]);
});

test('paintRegions（大きな canvas）は、まとまりごとに四角だけを描いて塗り、表示中の canvas から色を読まない。画素は今の塗り方と一致する', async () => {
  const page = fakePage();
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const expected = await expectedCanvas(page, viewport, MOSAIC);
  const actual = await drawnCanvas(page, viewport);
  const tracked = [];
  assert.equal(await region.paintRegions(pixelDoc, actual, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE, track: (task) => tracked.push(task) }), true);
  assert.deepEqual(differences(actual, expected), { count: 0, first: null });
  assert.equal(actual.reads, 0, '表示中の canvas から読まない');
  assert.deepEqual(page.renders, [{ width: 760, height: 360, annotationMode: MODES.ENABLE_STORAGE }, { width: 240, height: 240, annotationMode: MODES.ENABLE_STORAGE }]);
  assert.equal(tracked.length, 2);
});

test('paintRegions は、表示のみの書き込みがあるページでは四角を 2 回（canvas と同じ描き方・DISABLE）描き、書き込みの画素を残す', async () => {
  const page = fakePage({ annots: [ANNOT] });
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const expected = await expectedCanvas(page, viewport, MOSAIC);
  const actual = await drawnCanvas(page, viewport);
  await region.paintRegions(pixelDoc, actual, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE });
  assert.deepEqual(differences(actual, expected), { count: 0, first: null });
  assert.deepEqual(page.renders.map((render) => render.annotationMode), [MODES.ENABLE_STORAGE, MODES.DISABLE, MODES.ENABLE_STORAGE, MODES.DISABLE]);
  // 書き込み（画素の x 320〜352・y 168〜200）は残り、まわりは塗られている。
  const at = (180 * 1000 + 330) * 4;
  assert.deepEqual([...actual.getContext('2d').data.subarray(at, at + 3)], [255, 0, 0]);
  assert.ok(differences(actual, await drawnCanvas(page, viewport)).count > 0);
});

test('回転（90・180・270）とトリミングしたページでも、paintRegions の画素は今の塗り方と一致する', async () => {
  const page = fakePage({ annots: [ANNOT] });
  const cases = [[PAGE_500, 90], [PAGE_500, 180], [PAGE_500, 270], [CROP, 0], [CROP, 90], [CROP, 270]];
  for (const [viewBox, rotation] of cases) {
    const viewport = new PageViewport({ viewBox, scale: 2, rotation });
    const expected = await expectedCanvas(page, viewport, MOSAIC);
    const actual = await drawnCanvas(page, viewport);
    await region.paintRegions(pixelDoc, actual, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE });
    assert.deepEqual(differences(actual, expected), { count: 0, first: null }, `回転 ${rotation}・箱 ${viewBox}`);
    assert.equal(actual.reads, 0);
  }
});

test('paintAppended は、末尾より前を塗り終えた canvas に末尾の範囲だけを塗り、今の塗り方で全部を塗った画素と一致する（ページは描き直さない）', async () => {
  const cases = [[[], PAGE_500, 0], [[ANNOT], PAGE_500, 0], [[ANNOT], CROP, 90], [[ANNOT], PAGE_500, 180]];
  for (const [annots, viewBox, rotation] of cases) {
    const page = fakePage({ annots });
    const viewport = new PageViewport({ viewBox, scale: 2, rotation });
    const label = `書き込み ${annots.length}・回転 ${rotation}・箱 ${viewBox}`;
    // 末尾（D）は B と重なり、B は A と重なるので、四角は A・B・D を囲む。表示中の canvas へ書き込むのは D の範囲だけ。
    const actual = await drawnCanvas(page, viewport);
    await paint.paintOver(pixelDoc, actual, page, viewport, MOSAIC.slice(0, -1));
    actual.reads = 0;
    page.renders.length = 0;
    assert.equal(await region.paintAppended(pixelDoc, actual, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE }), true, label);
    assert.equal(actual.reads, 0, label);
    assert.equal(page.renders.length, annots.length === 0 ? 1 : 2, label);
    assert.deepEqual(differences(actual, await expectedCanvas(page, viewport, MOSAIC)), { count: 0, first: null }, label);
  }
});

test('paintAppended は、離れた範囲を追加したときは、その範囲の四角だけを描く', async () => {
  const page = fakePage();
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const mosaic = [MOSAIC[0], MOSAIC[1]];
  const actual = await drawnCanvas(page, viewport);
  await paint.paintOver(pixelDoc, actual, page, viewport, mosaic.slice(0, -1));
  page.renders.length = 0;
  await region.paintAppended(pixelDoc, actual, page, viewport, mosaic, { annotationMode: MODES.ENABLE_STORAGE });
  assert.deepEqual(page.renders, [{ width: 240, height: 240, annotationMode: MODES.ENABLE_STORAGE }]);
  assert.deepEqual(differences(actual, await expectedCanvas(page, viewport, mosaic)), { count: 0, first: null });
});

test('まとまりの四角の中に、ほかのまとまりの範囲があっても、その画素は書き換えない（書き込むのは、まとまりの範囲だけ）', async () => {
  // E と F は L 字に重なり、G は E・F を囲む四角の中にあるが、E・F とは重ならない。置いた順は G・E・F。
  const page = fakePage();
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const mosaic = [item([150, 60, 220, 190], 4), item([40, 40, 80, 240], 8), item([40, 200, 240, 240], 14)];
  assert.deepEqual(region.groupsOf(viewport, mosaic, { width: 1000, height: 1000 }).map((group) => group.area), [[300, 620, 440, 880], [80, 520, 480, 920]]);
  const expected = await expectedCanvas(page, viewport, mosaic);
  const regions = await drawnCanvas(page, viewport);
  await region.paintRegions(pixelDoc, regions, page, viewport, mosaic);
  assert.deepEqual(differences(regions, expected), { count: 0, first: null });
  const appended = await drawnCanvas(page, viewport);
  await paint.paintOver(pixelDoc, appended, page, viewport, mosaic.slice(0, -1));
  await region.paintAppended(pixelDoc, appended, page, viewport, mosaic);
  assert.deepEqual(differences(appended, expected), { count: 0, first: null });
});

test('100 万画素未満の canvas は、表示のみの書き込みが無ければ四角を描かずに表示中の canvas から色を読み、書き込みがあれば四角を描く', async () => {
  for (const annots of [[], [ANNOT]]) {
    const page = fakePage({ annots });
    const viewport = new PageViewport({ viewBox: PAGE_500, scale: 1, rotation: 90 });
    const expected = await expectedCanvas(page, viewport, MOSAIC);
    const regions = await drawnCanvas(page, viewport);
    await region.paintRegions(pixelDoc, regions, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE });
    assert.deepEqual(differences(regions, expected), { count: 0, first: null });
    if (annots.length === 0) {
      assert.ok(regions.reads > 0, '表示中の canvas から読む');
      assert.deepEqual(page.renders, []);
    } else {
      assert.equal(regions.reads, 0, '表示中の canvas から読まない');
      assert.deepEqual(page.renders.map((render) => render.annotationMode), [MODES.ENABLE_STORAGE, MODES.DISABLE, MODES.ENABLE_STORAGE, MODES.DISABLE]);
    }
    const appended = await drawnCanvas(page, viewport);
    await paint.paintOver(pixelDoc, appended, page, viewport, MOSAIC.slice(0, -1));
    page.renders.length = 0;
    assert.equal(await region.paintAppended(pixelDoc, appended, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE }), true);
    assert.deepEqual(differences(appended, expected), { count: 0, first: null });
    // 末尾の範囲だけを塗るときも、ページ全体を描かない（書き込みがあれば、末尾のまとまりの四角だけを 2 回描く）。
    assert.equal(page.renders.length, annots.length === 0 ? 0 : 2);
    assert.ok(page.renders.every((render) => render.width < 500 && render.height < 500), JSON.stringify(page.renders));
  }
});

test('paintAppended は、末尾の範囲が canvas の外なら描かずに true、モザイクが無い・2D コンテキストが無いなら false を返す', async () => {
  const page = fakePage();
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const canvas = await drawnCanvas(page, viewport);
  const before = Uint8ClampedArray.from(canvas.getContext('2d').data);
  assert.equal(await region.paintAppended(pixelDoc, canvas, page, viewport, [item([600, 600, 700, 700], 8)]), true);
  assert.deepEqual(page.renders, []);
  assert.deepEqual(canvas.getContext('2d').data, before);
  assert.equal(await region.paintAppended(pixelDoc, canvas, page, viewport, []), false);
  assert.equal(await region.paintAppended(pixelDoc, { width: 1000, height: 1000, getContext: () => null }, page, viewport, MOSAIC), false);
  assert.equal(await region.paintRegions(pixelDoc, { width: 1000, height: 1000, getContext: () => null }, page, viewport, MOSAIC), false);
});

test('四角の描画が取り消されたら、四角の canvas を手放して例外をそのまま返し、表示中の canvas は変えない', async () => {
  const page = fakePage();
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const canvas = await drawnCanvas(page, viewport);
  const before = Uint8ClampedArray.from(canvas.getContext('2d').data);
  const made = [];
  const doc = { createElement: () => { const area = pixelCanvas(); made.push(area); return area; } };
  page.render = () => ({ promise: Promise.reject(new Error('RenderingCancelledException')) });
  await assert.rejects(region.paintAppended(doc, canvas, page, viewport, MOSAIC), /RenderingCancelled/);
  await assert.rejects(region.paintRegions(doc, canvas, page, viewport, MOSAIC), /RenderingCancelled/);
  assert.deepEqual(made.map((area) => [area.width, area.height]), [[0, 0], [0, 0]]);
  assert.deepEqual(canvas.getContext('2d').data, before);
});

test('書き込みの有無を調べられない（getAnnotations が失敗する・無い）ときは、書き込みがあるものとして四角を 2 回描く', async () => {
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  for (const getAnnotations of [async () => { throw new Error('壊れたページ'); }, undefined]) {
    const page = { ...fakePage({ annots: [ANNOT] }), getAnnotations };
    const expected = await expectedCanvas(page, viewport, MOSAIC);
    const actual = await drawnCanvas(page, viewport);
    assert.equal(await region.paintRegions(pixelDoc, actual, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE }), true);
    assert.deepEqual(page.renders.map((render) => render.annotationMode), [MODES.ENABLE_STORAGE, MODES.DISABLE, MODES.ENABLE_STORAGE, MODES.DISABLE]);
    assert.deepEqual(differences(actual, expected), { count: 0, first: null });
  }
});

test('viewport をずらせない（clone の無い）ときは、大きな canvas でも表示中の canvas から読んで塗る', async () => {
  const page = fakePage({ annots: [ANNOT] });
  const real = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const plain = { transform: real.transform, width: real.width, height: real.height, convertToViewportPoint: (x, y) => real.convertToViewportPoint(x, y) };
  const expected = await expectedCanvas(page, real, MOSAIC);
  const actual = await drawnCanvas(page, real);
  assert.equal(await region.paintRegions(pixelDoc, actual, page, plain, MOSAIC), true);
  assert.deepEqual(differences(actual, expected), { count: 0, first: null });
  const appended = await drawnCanvas(page, real);
  await paint.paintOver(pixelDoc, appended, page, real, MOSAIC.slice(0, -1));
  assert.equal(await region.paintAppended(pixelDoc, appended, page, plain, MOSAIC), true);
  assert.deepEqual(differences(appended, expected), { count: 0, first: null });
});

test('paintAppended は、四角を描いた後・書き込む直前に alive() が false なら、塗った結果を書き込まずに false を返す', async () => {
  const cases = [['四角を描く', 2, []], ['四角を描く（書き込みあり）', 2, [ANNOT]], ['表示中の canvas から読む', 1, []]];
  for (const [label, scale, annots] of cases) {
    const page = fakePage({ annots });
    const viewport = new PageViewport({ viewBox: PAGE_500, scale });
    const canvas = await drawnCanvas(page, viewport);
    await paint.paintOver(pixelDoc, canvas, page, viewport, MOSAIC.slice(0, -1));
    const before = Uint8ClampedArray.from(canvas.getContext('2d').data);
    // 四角を描き終えた時に、倍率変更などで古くなったことにする（四角を描かないときは、初めから古い）。
    let alive = scale === 1 ? false : true;
    const render = page.render;
    page.render = (options) => ({ promise: render(options).promise.then(() => { alive = false; }) });
    assert.equal(await region.paintAppended(pixelDoc, canvas, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE, alive: () => alive }), false, label);
    assert.deepEqual(canvas.getContext('2d').data, before, label);
  }
});

test('mosaicRegion.canPaint は、2D コンテキストから色を読める canvas だけ true', () => {
  assert.equal(region.canPaint(pixelCanvas(4, 4)), true);
  assert.equal(region.canPaint({ getContext: () => ({}) }), false);
  assert.equal(region.canPaint({ getContext: () => null }), false);
  assert.equal(region.canPaint(null), false);
});
