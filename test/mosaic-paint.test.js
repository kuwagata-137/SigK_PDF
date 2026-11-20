'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-crop.js');
require('../renderer/page-mosaic.js');
require('../renderer/mosaic-paint.js');
const paint = globalThis.SigK.mosaicPaint;

// モザイクの塗り（spec-4b-6b 確定事項5〜7。事前調査 L）。画素を配列で持つ偽の 2D コンテキストで確かめる。

// width×height の画素（RGBA）。fill(x, y) が [r, g, b] を返す。
function fakeContext(width, height, fill = () => [255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return {
    canvas: { width, height },
    data,
    getImageData(x, y, w, h) {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row += 1)
        out.set(data.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
      return { data: out, width: w, height: h };
    },
    putImageData(image, x, y) {
      for (let row = 0; row < image.height; row += 1)
        data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((y + row) * width + x) * 4);
    },
    at(x, y) {
      return [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)];
    },
  };
}

// 紙の高さ paperHeight の、回転 0・倍率 scale の viewport（pdf.js と同じく y を下向きにする）。
function viewport(paperHeight, scale = 1) {
  return { scale, convertToViewportPoint: (x, y) => [x * scale, (paperHeight - y) * scale] };
}

test('ブロックごとに平均色で塗る（左が黒・右が白の 8px のブロックは灰色になる）', () => {
  const ctx = fakeContext(16, 8, (x) => (x % 8 < 4 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(paint.paint(ctx, viewport(8), [{ box: [0, 0, 16, 8], block: 8 }]), true);
  assert.deepEqual(ctx.at(0, 0), [128, 128, 128]);
  assert.deepEqual(ctx.at(15, 7), [128, 128, 128]);
});

test('範囲の外は塗らず、紙の座標の区切り（範囲の左上から block ごと）で塗る', () => {
  // 紙の高さ 10・倍率 2。範囲 [2, 2, 8, 10] は画素の x 4〜16・y 0〜16。block 4pt＝8px で、右の端は 4px の半端。
  const ctx = fakeContext(20, 20, (x, y) => [x * 10, y * 10, 0]);
  paint.paint(ctx, viewport(10, 2), [{ box: [2, 2, 8, 10], block: 4 }]);
  assert.deepEqual(ctx.at(3, 3), [30, 30, 0]);
  assert.deepEqual(ctx.at(17, 3), [170, 30, 0]);
  // 最初のブロック（x 4〜11・y 0〜7）の平均は x 7.5・y 3.5。
  assert.deepEqual(ctx.at(4, 0), [75, 35, 0]);
  assert.deepEqual(ctx.at(11, 7), [75, 35, 0]);
  // 右の半端（x 12〜15）の平均は x 13.5。
  assert.deepEqual(ctx.at(12, 0), [135, 35, 0]);
  assert.deepEqual(ctx.at(4, 16), [40, 160, 0]);
});

test('base を渡すと平均を base から取り、ctx と base で色の違う画素（書き込み）は残す', () => {
  const base = fakeContext(8, 8, () => [100, 100, 100]);
  const ctx = fakeContext(8, 8, (x, y) => (x === 3 && y === 3 ? [255, 0, 0] : [100, 100, 100]));
  paint.paint(ctx, viewport(8), [{ box: [0, 0, 8, 8], block: 8 }], { base });
  assert.deepEqual(ctx.at(3, 3), [255, 0, 0]);
  assert.deepEqual(ctx.at(0, 0), [100, 100, 100]);
  // base が無ければ、書き込みの色も混ぜて塗る（保存の画像は初めから書き込みを描かない）。
  const plain = fakeContext(8, 8, (x, y) => (x === 3 && y === 3 ? [255, 0, 0] : [100, 100, 100]));
  paint.paint(plain, viewport(8), [{ box: [0, 0, 8, 8], block: 8 }]);
  assert.deepEqual(plain.at(3, 3), plain.at(0, 0));
  assert.notDeepEqual(plain.at(3, 3), [255, 0, 0]);
});

test('canvas の外へはみ出した範囲は内側だけ塗り、モザイクが無い・2D コンテキストが無いときは何もしない', () => {
  const ctx = fakeContext(4, 4, () => [0, 0, 0]);
  assert.equal(paint.paint(ctx, viewport(4), [{ box: [-10, -10, 20, 20], block: 8 }]), true);
  assert.deepEqual(ctx.at(3, 3), [0, 0, 0]);
  assert.equal(paint.paint(ctx, viewport(4), []), false);
  assert.equal(paint.paint(ctx, viewport(4), undefined), false);
  assert.equal(paint.paint({}, viewport(4), [{ box: [0, 0, 4, 4], block: 8 }]), false);
});

test('needsPaint は並びが 1 つ以上あるときだけ true', () => {
  assert.equal(paint.needsPaint([{ box: [0, 0, 1, 1], block: 4 }]), true);
  assert.equal(paint.needsPaint([]), false);
  assert.equal(paint.needsPaint(null), false);
});

test('paintOver は 2D コンテキストの無い canvas（jsdom）では何もしない', async () => {
  const canvas = { width: 10, height: 10, getContext: () => null };
  const page = { render: () => { throw new Error('描かない'); } };
  assert.equal(await paint.paintOver({}, canvas, page, viewport(10), [{ box: [0, 0, 5, 5], block: 4 }]), false);
  assert.equal(await paint.paintOver({}, canvas, page, viewport(10), null), false);
});

// コードの点検で足したもの。
test('重ねて置いた範囲は、下見（base あり・書き込み無し）と保存（base なし）で同じ画素になる。書き込みの画素は下見で残る', () => {
  const fill = (x, y) => [(x * 37 + y * 11) % 256, (x * 5 + y * 53) % 256, (x * y) % 256];
  const mosaic = [{ box: [0, 0, 16, 16], block: 2 }, { box: [2, 2, 14, 14], block: 7 }];
  const saved = fakeContext(16, 16, fill);
  paint.paint(saved, viewport(16), mosaic);
  const base = fakeContext(16, 16, fill);
  const preview = fakeContext(16, 16, fill);
  paint.paint(preview, viewport(16), mosaic, { base });
  assert.deepEqual([...preview.data], [...saved.data]);
  // 書き込み（base と違う色の画素）は、重なった所でも残る。
  const annotated = fakeContext(16, 16, (x, y) => (x === 8 && y === 8 ? [255, 0, 0] : fill(x, y)));
  paint.paint(annotated, viewport(16), mosaic, { base: fakeContext(16, 16, fill) });
  assert.deepEqual(annotated.at(8, 8), [255, 0, 0]);
  assert.deepEqual(annotated.at(3, 3), saved.at(3, 3));
});

function fakeDoc(width, height, fill) {
  const made = [];
  return {
    made,
    createElement: () => {
      const ctx = fakeContext(width, height, fill);
      const canvas = { width: 0, height: 0, getContext: () => ctx };
      made.push(canvas);
      return canvas;
    },
  };
}

test('paintOver は書き込みを描かない絵をもう 1 枚描いて（task を track に渡す）塗り、描き終えたら手放す', async () => {
  const doc = fakeDoc(8, 8, () => [100, 100, 100]);
  const ctx = fakeContext(8, 8, (x, y) => (x === 1 && y === 1 ? [0, 0, 255] : [100, 100, 100]));
  const canvas = { width: 8, height: 8, getContext: () => ctx };
  const tracked = [];
  const page = { render: (options) => ({ promise: Promise.resolve(), options }) };
  assert.equal(await paint.paintOver(doc, canvas, page, viewport(8), [{ box: [0, 0, 8, 8], block: 8 }], { track: (task) => tracked.push(task) }), true);
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].options.viewport.scale, 1);
  assert.deepEqual(ctx.at(1, 1), [0, 0, 255], '書き込みは残る');
  assert.deepEqual(ctx.at(5, 5), [100, 100, 100]);
  assert.equal(doc.made[0].width, 0, '2 枚目は手放す');
});

test('2 枚目の描画が取り消されたら、2 枚目を手放して例外をそのまま返す', async () => {
  const doc = fakeDoc(8, 8, () => [0, 0, 0]);
  const canvas = { width: 8, height: 8, getContext: () => fakeContext(8, 8) };
  const page = { render: () => ({ promise: Promise.reject(new Error('RenderingCancelledException')) }) };
  await assert.rejects(paint.paintOver(doc, canvas, page, viewport(8), [{ box: [0, 0, 8, 8], block: 8 }]), /RenderingCancelled/);
  assert.equal(doc.made[0].width, 0);
  assert.equal(doc.made[0].height, 0);
});

// ---- 範囲の絵から色を読む塗り方（決定99 ①）----
// paintRegions・paintAppended の画素が、今の塗り方（paintOver。ページ全体を描いた canvas に、書き込みを描かない絵を base にして塗る）と
// 一致することを、pdf.js の代わりに偽物を使って確かめる。偽物の page は、canvas の各画素について、中心を viewport で紙の座標に戻して塗るので、回転・
// トリミング・四角へずらした viewport（clone の offsetX・offsetY）の計算違いは、画素の違いになって表れる。

const MODES = { DISABLE: 0, ENABLE: 1, ENABLE_STORAGE: 3 };
globalThis.SigK.pdfjs = { lib: { AnnotationMode: MODES } };

// pdf.js の PageViewport と同じ式（vendor/pdf.mjs〔pdf.js 6.3.289〕の PageViewport から転記した。offsetX・offsetY と clone を含む）。
class PageViewport {
  constructor({ viewBox, userUnit = 1, scale, rotation = 0, offsetX = 0, offsetY = 0 }) {
    Object.assign(this, { viewBox, userUnit, scale, rotation, offsetX, offsetY });
    const total = scale * userUnit;
    const centerX = (viewBox[2] + viewBox[0]) / 2;
    const centerY = (viewBox[3] + viewBox[1]) / 2;
    const [a, b, c, d] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[((rotation % 360) + 360) % 360];
    const sideways = a === 0;
    const canvasX = (sideways ? Math.abs(centerY - viewBox[1]) : Math.abs(centerX - viewBox[0])) * total + offsetX;
    const canvasY = (sideways ? Math.abs(centerX - viewBox[0]) : Math.abs(centerY - viewBox[1])) * total + offsetY;
    this.width = (sideways ? viewBox[3] - viewBox[1] : viewBox[2] - viewBox[0]) * total;
    this.height = (sideways ? viewBox[2] - viewBox[0] : viewBox[3] - viewBox[1]) * total;
    this.transform = [a * total, b * total, c * total, d * total, canvasX - a * total * centerX - c * total * centerY, canvasY - b * total * centerX - d * total * centerY];
  }

  clone({ offsetX = this.offsetX, offsetY = this.offsetY } = {}) {
    return new PageViewport({ viewBox: this.viewBox.slice(), userUnit: this.userUnit, scale: this.scale, rotation: this.rotation, offsetX, offsetY });
  }

  convertToViewportPoint(x, y) {
    const [a, b, c, d, e, f] = this.transform;
    return [a * x + c * y + e, b * x + d * y + f];
  }
}

// 画素を配列で持つ偽の canvas。2D コンテキストは、初めて getContext を呼んだときの大きさで作る。reads は getImageData の回数。
function pixelCanvas(width = 0, height = 0) {
  const canvas = { width, height, reads: 0, context: null };
  canvas.getContext = () => {
    if (canvas.context === null)
      canvas.context = pixelContext(canvas);
    return canvas.context;
  };
  return canvas;
}

function pixelContext(canvas) {
  const { width, height } = canvas;
  const data = new Uint8ClampedArray(width * height * 4);
  return {
    canvas,
    data,
    getImageData(x, y, w, h) {
      canvas.reads += 1;
      const out = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row += 1)
        out.set(data.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
      return { data: out, width: w, height: h };
    },
    // 本物と同じく、dirty の四角（image の中の四角）だけを (dx + dirtyX, dy + dirtyY) へ写す。
    putImageData(image, dx, dy, dirtyX = 0, dirtyY = 0, dirtyW = image.width, dirtyH = image.height) {
      for (let row = dirtyY; row < dirtyY + dirtyH; row += 1)
        data.set(image.data.subarray((row * image.width + dirtyX) * 4, (row * image.width + dirtyX + dirtyW) * 4), ((dy + row) * width + dx + dirtyX) * 4);
    },
  };
}

// pdf.js の page の代わり。描くと、canvas の各画素の中心を viewport で紙の座標に戻し、0.5pt ごとに違う色で塗る。表示のみの書き込み
// annots（紙の座標の箱）は、annotationMode が DISABLE でなければ赤で描く。renders は、描いた canvas の大きさと annotationMode の並び。
function fakePage({ annots = [] } = {}) {
  const renders = [];
  return {
    renders,
    getAnnotations: async () => annots.map((rect) => ({ rect })),
    render({ canvasContext, viewport, annotationMode }) {
      const { canvas, data } = canvasContext;
      renders.push({ width: canvas.width, height: canvas.height, annotationMode });
      const [a, b, c, d, e, f] = viewport.transform;
      const det = a * d - b * c;
      const shown = annotationMode === MODES.DISABLE ? [] : annots;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const [px, py] = [x + 0.5 - e, y + 0.5 - f];
          const [paperX, paperY] = [(d * px - c * py) / det, (a * py - b * px) / det];
          const at = (y * canvas.width + x) * 4;
          const inAnnot = shown.some(([x1, y1, x2, y2]) => paperX > x1 && paperX < x2 && paperY > y1 && paperY < y2);
          data[at] = inAnnot ? 255 : Math.floor(paperX * 2) % 256;
          data[at + 1] = inAnnot ? 0 : Math.floor(paperY * 3) % 256;
          data[at + 2] = inAnnot ? 0 : Math.floor((paperX + paperY) / 2) % 256;
          data[at + 3] = 255;
        }
      }
      return { promise: Promise.resolve() };
    },
  };
}

const pixelDoc = { createElement: () => pixelCanvas() };

// viewport で描いたばかりの canvas（ページ枠と同じく ENABLE_STORAGE）。数えた読み出しと描画は空にして返す。
async function drawnCanvas(page, viewport) {
  const canvas = pixelCanvas(Math.round(viewport.width), Math.round(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, annotationMode: MODES.ENABLE_STORAGE }).promise;
  canvas.reads = 0;
  page.renders.length = 0;
  return canvas;
}

// 今の塗り方（paintOver）で塗った canvas。
async function expectedCanvas(page, viewport, mosaic) {
  const canvas = await drawnCanvas(page, viewport);
  await paint.paintOver(pixelDoc, canvas, page, viewport, mosaic);
  return canvas;
}

// 2 枚の canvas で値が違う画素の数と、最初に違う画素の位置。
function differences(actual, expected) {
  const [a, b] = [actual.getContext('2d').data, expected.getContext('2d').data];
  let count = 0;
  let first = null;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3])
      continue;
    count += 1;
    first ??= [(i / 4) % actual.width, Math.floor(i / 4 / actual.width)];
  }
  return { count, first };
}

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
  const groups = paint.groupsOf(viewport, [...MOSAIC, item([600, 600, 700, 700], 8), item([10, 10, 10, 50], 8), item([0, 0, 10, 10], 0)], size);
  assert.deepEqual(groups.map((group) => group.items.map((entry) => MOSAIC.indexOf(entry))), [[0, 2, 3], [1]]);
  assert.deepEqual(groups[0].rects, [[80, 80, 400, 400], [300, 40, 640, 240], [600, 60, 840, 160]]);
  assert.deepEqual(groups[0].area, [80, 40, 840, 400]);
  assert.deepEqual(groups[1].area, [700, 660, 940, 900]);
  // 後から置いた範囲が、離れていた 2 つのまとまりをつなぐと、1 つにまとまる（置いた順のまま）。
  const bridge = item([180, 150, 360, 320], 8);
  assert.deepEqual(paint.groupsOf(viewport, [MOSAIC[0], MOSAIC[1], bridge], size).map((group) => group.items), [[MOSAIC[0], MOSAIC[1], bridge]]);
});

test('paintRegions（大きな canvas）は、まとまりごとに四角だけを描いて塗り、表示中の canvas から色を読まない。画素は今の塗り方と一致する', async () => {
  const page = fakePage();
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const expected = await expectedCanvas(page, viewport, MOSAIC);
  const actual = await drawnCanvas(page, viewport);
  const tracked = [];
  assert.equal(await paint.paintRegions(pixelDoc, actual, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE, track: (task) => tracked.push(task) }), true);
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
  await paint.paintRegions(pixelDoc, actual, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE });
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
    await paint.paintRegions(pixelDoc, actual, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE });
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
    assert.equal(await paint.paintAppended(pixelDoc, actual, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE }), true, label);
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
  await paint.paintAppended(pixelDoc, actual, page, viewport, mosaic, { annotationMode: MODES.ENABLE_STORAGE });
  assert.deepEqual(page.renders, [{ width: 240, height: 240, annotationMode: MODES.ENABLE_STORAGE }]);
  assert.deepEqual(differences(actual, await expectedCanvas(page, viewport, mosaic)), { count: 0, first: null });
});

test('まとまりの四角の中に、ほかのまとまりの範囲があっても、その画素は書き換えない（書き込むのは、まとまりの範囲だけ）', async () => {
  // E と F は L 字に重なり、G は E・F を囲む四角の中にあるが、E・F とは重ならない。置いた順は G・E・F。
  const page = fakePage();
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const mosaic = [item([150, 60, 220, 190], 4), item([40, 40, 80, 240], 8), item([40, 200, 240, 240], 14)];
  assert.deepEqual(paint.groupsOf(viewport, mosaic, { width: 1000, height: 1000 }).map((group) => group.area), [[300, 620, 440, 880], [80, 520, 480, 920]]);
  const expected = await expectedCanvas(page, viewport, mosaic);
  const regions = await drawnCanvas(page, viewport);
  await paint.paintRegions(pixelDoc, regions, page, viewport, mosaic);
  assert.deepEqual(differences(regions, expected), { count: 0, first: null });
  const appended = await drawnCanvas(page, viewport);
  await paint.paintOver(pixelDoc, appended, page, viewport, mosaic.slice(0, -1));
  await paint.paintAppended(pixelDoc, appended, page, viewport, mosaic);
  assert.deepEqual(differences(appended, expected), { count: 0, first: null });
});

test('100 万画素未満の canvas は、四角を描かずに表示中の canvas から色を読む（書き込みがあれば、今までと同じく base を描く）', async () => {
  for (const annots of [[], [ANNOT]]) {
    const page = fakePage({ annots });
    const viewport = new PageViewport({ viewBox: PAGE_500, scale: 1, rotation: 90 });
    const expected = await expectedCanvas(page, viewport, MOSAIC);
    const regions = await drawnCanvas(page, viewport);
    await paint.paintRegions(pixelDoc, regions, page, viewport, MOSAIC);
    assert.deepEqual(differences(regions, expected), { count: 0, first: null });
    assert.ok(regions.reads > 0, '表示中の canvas から読む');
    assert.deepEqual(page.renders.map((render) => [render.width, render.annotationMode]), annots.length === 0 ? [] : [[500, MODES.DISABLE]]);
    const appended = await drawnCanvas(page, viewport);
    await paint.paintOver(pixelDoc, appended, page, viewport, MOSAIC.slice(0, -1));
    assert.equal(await paint.paintAppended(pixelDoc, appended, page, viewport, MOSAIC), true);
    assert.deepEqual(differences(appended, expected), { count: 0, first: null });
  }
});

test('paintAppended は、末尾の範囲が canvas の外なら描かずに true、モザイクが無い・2D コンテキストが無いなら false を返す', async () => {
  const page = fakePage();
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const canvas = await drawnCanvas(page, viewport);
  const before = Uint8ClampedArray.from(canvas.getContext('2d').data);
  assert.equal(await paint.paintAppended(pixelDoc, canvas, page, viewport, [item([600, 600, 700, 700], 8)]), true);
  assert.deepEqual(page.renders, []);
  assert.deepEqual(canvas.getContext('2d').data, before);
  assert.equal(await paint.paintAppended(pixelDoc, canvas, page, viewport, []), false);
  assert.equal(await paint.paintAppended(pixelDoc, { width: 1000, height: 1000, getContext: () => null }, page, viewport, MOSAIC), false);
  assert.equal(await paint.paintRegions(pixelDoc, { width: 1000, height: 1000, getContext: () => null }, page, viewport, MOSAIC), false);
});

test('四角の描画が取り消されたら、四角の canvas を手放して例外をそのまま返し、表示中の canvas は変えない', async () => {
  const page = fakePage();
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  const canvas = await drawnCanvas(page, viewport);
  const before = Uint8ClampedArray.from(canvas.getContext('2d').data);
  const made = [];
  const doc = { createElement: () => { const area = pixelCanvas(); made.push(area); return area; } };
  page.render = () => ({ promise: Promise.reject(new Error('RenderingCancelledException')) });
  await assert.rejects(paint.paintAppended(doc, canvas, page, viewport, MOSAIC), /RenderingCancelled/);
  await assert.rejects(paint.paintRegions(doc, canvas, page, viewport, MOSAIC), /RenderingCancelled/);
  assert.deepEqual(made.map((area) => [area.width, area.height]), [[0, 0], [0, 0]]);
  assert.deepEqual(canvas.getContext('2d').data, before);
});

test('書き込みの有無を調べられない（getAnnotations が失敗する・無い）ときは、書き込みがあるものとして四角を 2 回描く', async () => {
  const viewport = new PageViewport({ viewBox: PAGE_500, scale: 2 });
  for (const getAnnotations of [async () => { throw new Error('壊れたページ'); }, undefined]) {
    const page = { ...fakePage({ annots: [ANNOT] }), getAnnotations };
    const expected = await expectedCanvas(page, viewport, MOSAIC);
    const actual = await drawnCanvas(page, viewport);
    assert.equal(await paint.paintRegions(pixelDoc, actual, page, viewport, MOSAIC, { annotationMode: MODES.ENABLE_STORAGE }), true);
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
  assert.equal(await paint.paintRegions(pixelDoc, actual, page, plain, MOSAIC), true);
  assert.deepEqual(differences(actual, expected), { count: 0, first: null });
  const appended = await drawnCanvas(page, real);
  await paint.paintOver(pixelDoc, appended, page, real, MOSAIC.slice(0, -1));
  assert.equal(await paint.paintAppended(pixelDoc, appended, page, plain, MOSAIC), true);
  assert.deepEqual(differences(appended, expected), { count: 0, first: null });
});
