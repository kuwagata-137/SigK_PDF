'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/markup-quads.js');
require('../renderer/annotation-layer.js');

// 紙の上に重ねる注釈の層（spec-4-1 確定事項5・37）と、印刷用の canvas 2D の描き手（確定事項28）。

const layer = globalThis.SigK.annotationLayer;

// 回転 0・倍率 1 の viewport（A4）。
function viewport(scale = 1) {
  return {
    width: 595.28 * scale,
    height: 841.89 * scale,
    convertToViewportPoint: (x, y) => [x * scale, (841.89 - y) * scale],
    convertToPdfPoint: (px, py) => [px / scale, 841.89 - py / scale],
  };
}

const HIGHLIGHT = { id: 'sigk-1', src: 0, kind: 'highlight', color: '#ffe45a', opacity: 1, quads: [[48, 753, 232, 753, 48, 743, 232, 743]], rect: [48, 743, 232, 753] };
const UNDERLINE = { ref: '86R', src: 0, kind: 'underline', color: '#d92c2c', opacity: 1, quads: [[48, 740, 300, 740, 48, 730, 300, 730]], rect: [48, 730, 300, 740] };
const FADED = { id: 'sigk-2', src: 0, kind: 'strikeout', color: '#000000', opacity: 0.5, quads: [[10, 20, 20, 20, 10, 10, 20, 10]], rect: [10, 10, 20, 20] };

function makeDom() {
  const dom = new JSDOM('<!doctype html><div class="pdf-page"></div>');
  return { dom, doc: dom.window.document, node: dom.window.document.querySelector('.pdf-page') };
}

test('mount はページの枠の末尾に SVG を置き、寸法は viewport から取る', () => {
  const { doc, node } = makeDom();
  const svg = layer.mount(doc, node, viewport(2));
  assert.equal(node.lastElementChild, svg);
  assert.equal(svg.getAttribute('class'), 'annot-layer');
  assert.equal(svg.getAttribute('width'), '1191');
  assert.equal(svg.getAttribute('height'), '1684');
});

test('draw はハイライトを多角形、線を line として描き、id か ref を持たせる', () => {
  const { doc, node } = makeDom();
  const svg = layer.mount(doc, node, viewport());
  const count = layer.draw(svg, [UNDERLINE, HIGHLIGHT], viewport());
  assert.equal(count, 2);
  const groups = [...svg.querySelectorAll('g')];
  assert.deepEqual(groups.map((g) => g.getAttribute('data-annot')), ['86R', 'sigk-1']);
  assert.deepEqual(groups.map((g) => g.getAttribute('data-kind')), ['underline', 'highlight']);
  const polygon = svg.querySelector('polygon');
  assert.equal(polygon.getAttribute('fill'), '#ffe45a');
  assert.equal(polygon.getAttribute('class'), 'highlight');
  // UL・UR・LR・LL の順で閉じる。y は CSS で上下が逆になる。
  assert.equal(polygon.getAttribute('points'), '48,88.89 232,88.89 232,98.89 48,98.89');
  const line = svg.querySelector('line');
  assert.equal(line.getAttribute('stroke'), '#d92c2c');
  assert.equal(line.getAttribute('class'), 'underline');
  assert.equal(Number(line.getAttribute('x1')), 48);
  assert.equal(Number(line.getAttribute('x2')), 300);
  // 下辺の少し上（0.93）。
  assert.equal(Math.round(Number(line.getAttribute('y1')) * 100) / 100, Math.round((841.89 - 740 + 10 * 0.93) * 100) / 100);
});

test('draw は描き直すたびに前の中身を捨て、選んだ注釈に枠を最後に置く', () => {
  const { doc, node } = makeDom();
  const svg = layer.mount(doc, node, viewport());
  layer.draw(svg, [HIGHLIGHT, UNDERLINE], viewport());
  layer.draw(svg, [HIGHLIGHT, UNDERLINE], viewport(), { selected: 'sigk-1' });
  assert.equal(svg.querySelectorAll('g').length, 2);
  const frame = svg.lastElementChild;
  assert.equal(frame.getAttribute('class'), 'annot-frame');
  assert.equal(Number(frame.getAttribute('x')), 48 - layer.FRAME_PADDING);
  assert.equal(Number(frame.getAttribute('width')), 184 + layer.FRAME_PADDING * 2);
  layer.draw(svg, [HIGHLIGHT], viewport(), { selected: 'nothing' });
  assert.equal(svg.querySelectorAll('.annot-frame').length, 0);
});

test('半透明の注釈は group に opacity が付く', () => {
  const { doc, node } = makeDom();
  const svg = layer.mount(doc, node, viewport());
  layer.draw(svg, [FADED, HIGHLIGHT], viewport());
  const groups = [...svg.querySelectorAll('g')];
  assert.equal(groups[0].getAttribute('opacity'), '0.5');
  assert.equal(groups[1].getAttribute('opacity'), null);
});

test('paint は canvas 2D に同じ絵を描く（ハイライトは multiply、線は stroke）', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_target, name) => (...args) => { calls.push([name, ...args]); },
    set: (_target, name, value) => { calls.push(['set', name, value]); return true; },
  });
  assert.equal(layer.paint(ctx, [HIGHLIGHT, UNDERLINE, FADED], viewport()), 3);
  const names = calls.map((call) => call[0] + (call[0] === 'set' ? `:${call[1]}=${call[2]}` : ''));
  assert.equal(names.includes('set:globalCompositeOperation=multiply'), true);
  assert.equal(names.includes('set:globalCompositeOperation=source-over'), true);
  assert.equal(names.includes('set:globalAlpha=0.5'), true);
  assert.equal(names.filter((name) => name === 'fill').length, 1);
  assert.equal(names.filter((name) => name === 'stroke').length, 2);
  assert.equal(names.filter((name) => name === 'save').length, names.filter((name) => name === 'restore').length);
  const move = calls.find((call) => call[0] === 'moveTo');
  assert.deepEqual(move.slice(1).map((v) => Math.round(v * 100) / 100), [48, 88.89]);
});

test('keyOf は ref があれば ref、無ければ id', () => {
  assert.equal(layer.keyOf(HIGHLIGHT), 'sigk-1');
  assert.equal(layer.keyOf(UNDERLINE), '86R');
});
