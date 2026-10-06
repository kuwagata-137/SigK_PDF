'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/page-crop.js');
require('../renderer/trim-drag.js');
require('../renderer/trim-frame.js');

// トリミングの枠の描き方（spec-4b-6a 確定事項12・13。見本 screenshots/phase4b-6-trim-frame.png）。位置と大きさだけを見る（色は shell.css）。

const frame = globalThis.SigK.trimFrame;
const SIZE = { width: 400, height: 600 };

function makeDom() {
  const dom = new JSDOM('<!doctype html><div class="pdf-page" data-page="1"></div><div class="pdf-page" data-page="2"></div>');
  const doc = dom.window.document;
  return { doc, nodes: [...doc.querySelectorAll('.pdf-page')] };
}

function box(node) {
  const { left, top, width, height } = node.style;
  return [left, top, width, height].map((value) => Number.parseFloat(value));
}

test('draw は外側を暗くする 4 枚・枠・8 点のつまみ・札を、枠の位置と大きさに置く', () => {
  const { nodes } = makeDom();
  const layer = frame.draw(nodes[0], { x1: 50, y1: 80, x2: 250, y2: 380 }, SIZE, '幅 71 mm × 高さ 106 mm');

  assert.equal(layer.parentElement, nodes[0]);
  assert.equal(layer.getAttribute('aria-hidden'), 'true');
  const shade = (side) => box(layer.querySelector(`.trim-shade[data-side="${side}"]`));
  assert.deepEqual(shade('top'), [0, 0, 400, 80]);
  assert.deepEqual(shade('bottom'), [0, 380, 400, 220]);
  assert.deepEqual(shade('left'), [0, 80, 50, 300]);
  assert.deepEqual(shade('right'), [250, 80, 150, 300]);
  assert.deepEqual(box(layer.querySelector('.trim-box')), [50, 80, 200, 300]);
  const handles = [...layer.querySelectorAll('.trim-handle')].map((node) => [node.dataset.handle, Number.parseFloat(node.style.left), Number.parseFloat(node.style.top)]);
  assert.deepEqual(handles, [['nw', 50, 80], ['n', 150, 80], ['ne', 250, 80], ['e', 250, 230], ['se', 250, 380], ['s', 150, 380], ['sw', 50, 380], ['w', 50, 230]]);
  const label = layer.querySelector('.trim-label');
  assert.equal(label.textContent, '幅 71 mm × 高さ 106 mm');
  assert.deepEqual([label.style.left, label.style.top], ['50px', '386px']);
});

test('draw は 2 回目から同じ層を動かし、札は下に入りきらなければ枠の内側の下端へ、右半分から始まる枠では右端をそろえる', () => {
  const { nodes } = makeDom();
  const first = frame.draw(nodes[0], { x1: 50, y1: 80, x2: 250, y2: 380 }, SIZE, 'a');
  const second = frame.draw(nodes[0], { x1: 220, y1: 100, x2: 390, y2: 590 }, SIZE, 'b');

  assert.equal(second, first);
  assert.equal(nodes[0].querySelectorAll('.trim-layer').length, 1);
  const label = second.querySelector('.trim-label');
  assert.deepEqual([label.style.left, label.style.right, label.style.top], ['', '10px', '562px']);
});

test('clear は残すページの枠だけを残し、setCursor は html の印を付け外しする', () => {
  const { doc, nodes } = makeDom();
  frame.draw(nodes[0], { x1: 0, y1: 0, x2: 10, y2: 10 }, SIZE, 'a');
  frame.draw(nodes[1], { x1: 0, y1: 0, x2: 10, y2: 10 }, SIZE, 'b');
  frame.clear(doc, nodes[1]);
  assert.equal(nodes[0].querySelector('.trim-layer'), null);
  assert.ok(nodes[1].querySelector('.trim-layer') !== null);
  frame.clear(doc);
  assert.equal(doc.querySelector('.trim-layer'), null);

  frame.setCursor(doc, 'nwse');
  assert.equal(doc.documentElement.getAttribute('data-trim-cursor'), 'nwse');
  frame.setCursor(doc, null);
  assert.equal(doc.documentElement.hasAttribute('data-trim-cursor'), false);
});
