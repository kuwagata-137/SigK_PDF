'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 画像のタブを 1 枚に描く（spec-7-1 確定事項B4）。viewer・pageImage・mosaicPaint・annotate を小さな物に差し替えて、描く順と引数を見る。
require('../renderer/image-tab.js');
require('../renderer/image-render.js');

const SigK = globalThis.SigK;

// ctx の呼び出しを並べて残す小さな物。
function recordingContext(log) {
  const ctx = {};
  for (const name of ['save', 'restore', 'setTransform', 'transform', 'drawImage'])
    ctx[name] = (...args) => log.push([name, ...args]);
  return ctx;
}

function install(t, { file, entry = { src: 0, rotate: 0 }, bitmapError = null }) {
  const log = [];
  const saved = { viewer: SigK.viewer, pageImage: SigK.pageImage, mosaicPaint: SigK.mosaicPaint, annotate: SigK.annotate, freeTextShape: SigK.freeTextShape, pdfjs: SigK.pdfjs };
  SigK.viewer = { getPage: async () => ({ rotate: 0 }), getPlan: () => [entry], getState: () => ({ file }), viewportRotation: () => 90 };
  SigK.freeTextShape = { ensureLoaded: async () => { log.push(['font']); return true; } };
  SigK.pdfjs = { lib: { AnnotationMode: { ENABLE_STORAGE: 3 } } };
  SigK.mosaicPaint = { paint: (_ctx, _viewport, mosaic) => log.push(['mosaic', mosaic]) };
  SigK.annotate = { painterFor: (src) => (Number.isInteger(src) ? () => log.push(['annotations', src]) : null) };
  SigK.pageImage = {
    renderToCanvas: async (_doc, _page, options) => {
      log.push(['render', { scale: options.scale, rotation: options.rotation, box: options.box, background: options.background, annotationMode: options.annotationMode }]);
      options.overlay(recordingContext(log), { transform: [1, 0, 0, -1, 0, 200] });
      return { canvas: {}, width: 300, height: 200 };
    },
    toBytes: async (_canvas, { type, quality }) => { log.push(['bytes', type, quality]); return new Uint8Array([7]); },
    release: () => log.push(['release']),
  };
  t.after(() => Object.assign(SigK, saved));
  const win = {
    Blob: class { constructor(parts, options) { this.parts = parts; this.type = options.type; } },
    createImageBitmap: async (blob, options) => {
      log.push(['decode', blob.type, options]);
      if (bitmapError !== null)
        throw bitmapError;
      return { close: () => log.push(['close']) };
    },
  };
  return { log, doc: { defaultView: win } };
}

const PNG_FILE = { image: { kind: 'png', frames: [{ width: 300, height: 200 }] } };
const JPEG_FILE = { image: { kind: 'jpeg', frames: [{ width: 300, height: 200 }], original: new Uint8Array([0xff, 0xd8]) } };

test('PNG: 倍率 1・回転・トリミングの範囲・透明の背景で描き、モザイク → 書き込みの順に重ねて PNG にする', async (t) => {
  const crop = [10, 10, 200, 150];
  const mosaic = [{ box: [0, 0, 50, 50], block: 8 }];
  const { log, doc } = install(t, { file: PNG_FILE, entry: { src: 0, rotate: 90, crop, mosaic } });
  const result = await SigK.imageRender.render(doc, 'png');
  assert.equal(result.ok, true);
  assert.deepEqual([...result.bytes], [7]);
  assert.deepEqual(log.map(([name]) => name), ['font', 'render', 'mosaic', 'annotations', 'bytes', 'release']);
  assert.deepEqual(log[1][1], { scale: 1, rotation: 90, box: crop, background: 'rgba(0,0,0,0)', annotationMode: 3 });
  assert.deepEqual(log[2][1], mosaic);
  assert.deepEqual(log[4].slice(1), ['image/png', undefined]);
});

test('JPEG: 白の背景で描き、ブラウザで読み解いた元の画像を、上下を返して等倍で敷き直してからモザイクと書き込みを重ねる', async (t) => {
  const { log, doc } = install(t, { file: JPEG_FILE });
  await SigK.imageRender.render(doc, 'jpeg');
  assert.deepEqual(log.find(([name]) => name === 'decode').slice(1), ['image/jpeg', { imageOrientation: 'none' }]);
  assert.equal(log.find(([name]) => name === 'render')[1].background, '#ffffff');
  const names = log.map(([name]) => name);
  assert.ok(names.indexOf('drawImage') < names.indexOf('mosaic') && names.indexOf('mosaic') < names.indexOf('annotations'));
  assert.deepEqual(log.find(([name]) => name === 'setTransform').slice(1), [1, 0, 0, -1, 0, 200], '紙の座標から canvas への行列');
  assert.deepEqual(log.find(([name]) => name === 'transform').slice(1), [1, 0, 0, -1, 0, 200], '画像の上の行を紙の上へ');
  assert.deepEqual(log.find(([name]) => name === 'drawImage').slice(2), [0, 0, 300, 200]);
  assert.deepEqual(log.find(([name]) => name === 'bytes').slice(1), ['image/jpeg', 0.95]);
  assert.ok(names.includes('close'), '読み解いた画像は手放す');
});

test('JPEG を PNG に書くときも元の画像を敷き直す。読み解けなければ pdf.js が描いたままにする', async (t) => {
  const { log, doc } = install(t, { file: JPEG_FILE, bitmapError: new Error('decode') });
  const result = await SigK.imageRender.render(doc, 'png');
  assert.equal(result.ok, true);
  assert.equal(log.some(([name]) => name === 'drawImage'), false);
});

test('差し込んだページ（src の無いページ）には元の画像を敷かず、書き込みも描かない', async (t) => {
  const { log, doc } = install(t, { file: JPEG_FILE, entry: { insert: 0, rotate: 0 } });
  await SigK.imageRender.render(doc, 'png');
  const names = log.map(([name]) => name);
  assert.equal(names.includes('decode'), false);
  assert.equal(names.includes('annotations'), false);
});

test('描けない環境（jsdom）では bytes を null で返す', async (t) => {
  const { doc } = install(t, { file: PNG_FILE });
  SigK.pageImage.renderToCanvas = async () => ({ canvas: null, width: 300, height: 200 });
  const result = await SigK.imageRender.render(doc, 'png');
  assert.deepEqual(result, { ok: true, bytes: null, width: 300, height: 200 });
});
