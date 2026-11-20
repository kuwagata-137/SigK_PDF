'use strict';

// 画素を持つ偽の canvas と、その画素に描く偽の pdf.js のページ（決定99 ①。モザイクの範囲の絵から色を読む塗り方の試験で使う）。
// 偽の page は、canvas の各画素について、中心を viewport で紙の座標に戻して塗るので、回転・トリミング・四角へずらした viewport
// （clone の offsetX・offsetY）の計算違いは、画素の違いになって表れる。

// pdf.js の AnnotationMode の値。
const MODES = Object.freeze({ DISABLE: 0, ENABLE: 1, ENABLE_STORAGE: 3 });

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

// canvas（width・height を持つもの）の画素を配列で持つ 2D コンテキスト。canvas.reads は getImageData の回数、canvas.puts は
// putImageData の回数。
function pixelContext(canvas) {
  const { width, height } = canvas;
  const data = new Uint8ClampedArray(width * height * 4);
  canvas.reads ??= 0;
  canvas.puts ??= 0;
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
      canvas.puts += 1;
      for (let row = dirtyY; row < dirtyY + dirtyH; row += 1)
        data.set(image.data.subarray((row * image.width + dirtyX) * 4, (row * image.width + dirtyX + dirtyW) * 4), ((dy + row) * width + dx + dirtyX) * 4);
    },
  };
}

// 画素を配列で持つ偽の canvas。2D コンテキストは、初めて getContext を呼んだときの大きさで作る。
function pixelCanvas(width = 0, height = 0) {
  const canvas = { width, height, reads: 0, puts: 0, context: null };
  canvas.getContext = () => {
    if (canvas.context === null)
      canvas.context = pixelContext(canvas);
    return canvas.context;
  };
  return canvas;
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

// viewport で描いたばかりの canvas（ページ枠と同じく ENABLE_STORAGE）。数えた読み出し・書き込みと描画は空にして返す。
async function drawnCanvas(page, viewport) {
  const canvas = pixelCanvas(Math.round(viewport.width), Math.round(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, annotationMode: MODES.ENABLE_STORAGE }).promise;
  canvas.reads = 0;
  canvas.puts = 0;
  page.renders.length = 0;
  return canvas;
}

// 今の塗り方（mosaic-paint.js の paintOver。ページ全体を描いた canvas に、書き込みを描かない絵を base にして塗る）で塗った canvas。
async function expectedCanvas(page, viewport, mosaic) {
  const canvas = await drawnCanvas(page, viewport);
  await globalThis.SigK.mosaicPaint.paintOver(pixelDoc, canvas, page, viewport, mosaic);
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

module.exports = { MODES, PageViewport, pixelContext, pixelCanvas, fakePage, pixelDoc, drawnCanvas, expectedCanvas, differences };
