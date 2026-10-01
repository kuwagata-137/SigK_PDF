'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/markup-quads.js');
require('../renderer/shape-style.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/shape-rotation.js');
require('../renderer/shape-handles.js');
require('../renderer/annotation-frame.js');

// 選んでいる書き込みの枠とつまみの層（spec-4b-2 確定事項9〜14・23）。紙の器の外の #view-pages に 1 枚だけ置く。
// 四角でない枠の形は annotation-layer.test.js が見る。

const frames = globalThis.SigK.annotationFrame;

function viewport() {
  return { scale: 1, width: 595.28, height: 841.89, convertToViewportPoint: (x, y) => [x, 841.89 - y] };
}

function makeDom() {
  const dom = new JSDOM('<!doctype html><div id="view-pages"><div class="pdf-page" data-page="1" style="left: 10px; top: 20px"></div><div class="pdf-page" data-page="2" style="left: 10px; top: 900px"></div></div>');
  const doc = dom.window.document;
  return { doc, pages: doc.getElementById('view-pages'), nodes: [...doc.querySelectorAll('.pdf-page')] };
}

const SQUARE = { id: 'sigk-1', kind: 'square', rect: [100, 600, 300, 700], lineWidth: 2, quads: [[100, 700, 300, 700, 100, 600, 300, 600]] };

function sync(dom, index, entries, selected) {
  return frames.sync({ doc: dom.doc, pagesEl: dom.pages, pageNode: dom.nodes[index], index, entries, viewport: viewport(), selected });
}

test('sync は回した四角に、回った枠・8 つのつまみ・回転のつまみと矢印・つなぐ線を描く', (t) => {
  t.after(() => frames.clear());
  const dom = makeDom();
  assert.equal(sync(dom, 0, [{ ...SQUARE, angle: 30 }], 'sigk-1'), true);
  const layer = dom.pages.querySelector('.annot-frame-layer');
  assert.equal(layer.querySelector('polygon.annot-frame').getAttribute('points').split(' ').length, 4);
  assert.equal(layer.querySelectorAll('circle.annot-handle').length, 9);
  assert.equal(layer.querySelectorAll('circle.annot-handle.rotate').length, 1);
  assert.equal(layer.querySelector('circle.rotate').getAttribute('r'), '8');
  assert.ok(layer.querySelector('.annot-rotate-icon path') !== null);
  assert.ok(layer.querySelector('line.annot-frame-stem') !== null);
  assert.equal(frames.shown().key, 'sigk-1');
  assert.equal(frames.shown().shape.handles.length, 9);
});

test('sync は選んだ書き込みのページに層を重ね、ほかのページの描き直しでは消さない。releasePage で消す', (t) => {
  t.after(() => frames.clear());
  const dom = makeDom();
  sync(dom, 1, [SQUARE], 'sigk-1');
  const layer = dom.pages.querySelector('.annot-frame-layer');
  assert.deepEqual([layer.style.left, layer.style.top], ['10px', '900px']);
  // 1 ページ目を描き直しても（選んだものが無い）、2 ページ目の枠は残る
  assert.equal(sync(dom, 0, [], 'sigk-1'), false);
  assert.equal(layer.childNodes.length, 1);
  frames.releasePage(0);
  assert.equal(layer.childNodes.length, 1);
  frames.releasePage(1);
  assert.equal(layer.childNodes.length, 0);
  assert.equal(frames.shown(), null);
});

test('ページを作り直して層が外れても、次の sync で #view-pages に置き直す', (t) => {
  t.after(() => frames.clear());
  const dom = makeDom();
  sync(dom, 0, [SQUARE], 'sigk-1');
  dom.pages.replaceChildren(...dom.nodes);
  assert.equal(dom.pages.querySelector('.annot-frame-layer'), null);
  sync(dom, 0, [SQUARE], 'sigk-1');
  assert.equal(dom.pages.querySelectorAll('.annot-frame-layer').length, 1);
});

test('translate は掴んで動かしている間だけ枠とつまみをずらし、0, 0 で戻す', (t) => {
  t.after(() => frames.clear());
  const dom = makeDom();
  sync(dom, 0, [SQUARE], 'sigk-1');
  frames.translate(12, -5);
  const group = dom.pages.querySelector('.annot-frame-group');
  assert.equal(group.style.transform, 'translate(12px, -5px)');
  frames.translate(0, 0);
  assert.equal(group.style.transform, '');
});
