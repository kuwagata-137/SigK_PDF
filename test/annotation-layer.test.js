'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/markup-quads.js');
require('../renderer/markup-graphics.js');
require('../renderer/shape-style.js');
require('../renderer/free-text-entry.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/free-text-geometry.js');
require('../renderer/free-text-font.js');
require('../renderer/free-text-shape.js');
require('../renderer/free-text-turn.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-outline.js');
require('../renderer/cloud-geometry.js');
require('../renderer/shape-figure.js');
require('../renderer/shape-rotation.js');
require('../renderer/shape-print-layer.js');
require('../renderer/shape-graphics.js');
require('../renderer/shape-handles.js');
require('../renderer/frame-graphics.js');
require('../renderer/annotation-frame.js');
require('../renderer/annotation-layer.js');

// 紙の上に重ねる注釈の層（spec-4-1 確定事項5・37）と、印刷用の canvas 2D の描き手（確定事項28）。

const layer = globalThis.SigK.annotationLayer;
const { FRAME_PADDING } = globalThis.SigK.annotationFrame;

// 回転 0・倍率 1 の viewport（A4）。
function viewport(scale = 1) {
  return {
    width: 595.28 * scale,
    height: 841.89 * scale,
    scale,
    rotation: 0,
    convertToViewportPoint: (x, y) => [x * scale, (841.89 - y) * scale],
    convertToPdfPoint: (px, py) => [px / scale, 841.89 - py / scale],
  };
}

const TEXT = {
  id: 'sigk-3', src: 0, kind: 'text', color: '#1c2430', opacity: 1, text: 'メモ\n二行目', fontSize: 12, rotation: 0,
  rect: [100, 690, 164, 720], quads: [[100, 720, 164, 720, 100, 690, 164, 690]],
};

const HIGHLIGHT = { id: 'sigk-1', src: 0, kind: 'highlight', color: '#ffe45a', opacity: 1, quads: [[48, 753, 232, 753, 48, 743, 232, 743]], rect: [48, 743, 232, 753] };
const UNDERLINE = { ref: '86R', src: 0, kind: 'underline', color: '#d92c2c', opacity: 1, quads: [[48, 740, 300, 740, 48, 730, 300, 730]], rect: [48, 730, 300, 740] };
const FADED = { id: 'sigk-2', src: 0, kind: 'strikeout', color: '#000000', opacity: 0.5, quads: [[10, 20, 20, 20, 10, 10, 20, 10]], rect: [10, 10, 20, 20] };

function makeDom() {
  const dom = new JSDOM('<!doctype html><div id="view-pages"><div class="pdf-page" style="left: 40px; top: 16px"></div></div>');
  const doc = dom.window.document;
  return { dom, doc, node: doc.querySelector('.pdf-page'), pages: doc.getElementById('view-pages') };
}

// 選んだ注釈の枠を、紙の外の層（annotation-frame.js。spec-4b-2 確定事項9）に描かせて、その中の .annot-frame を返す。
function frameOf({ doc, node, pages }, entries, vp, { selected, editing = null } = {}) {
  globalThis.SigK.annotationFrame.sync({ doc, pagesEl: pages, pageNode: node, index: 0, entries, viewport: vp, selected, editing });
  return pages.querySelector('.annot-frame-layer .annot-frame');
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

test('draw は描き直すたびに前の中身を捨て、選択の枠は紙の層に描かない（紙の外の層へ。spec-4b-2 確定事項9）', () => {
  const dom = makeDom();
  const svg = layer.mount(dom.doc, dom.node, viewport());
  layer.draw(svg, [HIGHLIGHT, UNDERLINE], viewport());
  layer.draw(svg, [HIGHLIGHT, UNDERLINE], viewport(), { selected: 'sigk-1' });
  assert.equal(svg.querySelectorAll('g').length, 2);
  assert.equal(svg.querySelector('.annot-frame'), null);
  const frame = frameOf(dom, [HIGHLIGHT, UNDERLINE], viewport(), { selected: 'sigk-1' });
  assert.equal(frame.getAttribute('class'), 'annot-frame');
  assert.equal(Number(frame.getAttribute('x')), 48 - FRAME_PADDING);
  assert.equal(Number(frame.getAttribute('width')), 184 + FRAME_PADDING * 2);
  // 枠の層は紙の器の外（#view-pages）に、選んだ注釈のページの位置で重なる
  const frames = dom.pages.querySelector('.annot-frame-layer');
  assert.equal(frames.parentNode, dom.pages);
  assert.deepEqual([frames.style.left, frames.style.top], ['40px', '16px']);
  assert.equal(frameOf(dom, [HIGHLIGHT], viewport(), { selected: 'nothing' }), null);
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

// ---- テキスト（spec-4-2 確定事項5・10・29） ----

test('draw はテキストを free-text-shape の <g> に委ね、編集中のものは描かない', () => {
  const dom = makeDom();
  const svg = layer.mount(dom.doc, dom.node, viewport());
  assert.equal(layer.draw(svg, [HIGHLIGHT, TEXT], viewport(), { selected: 'sigk-3' }), 2);
  const group = svg.querySelector('g[data-annot="sigk-3"]');
  assert.equal(group.getAttribute('data-kind'), 'text');
  assert.deepEqual([...group.querySelectorAll('text')].map((t) => t.textContent), ['メモ', '二行目']);
  // 選択の枠は箱の四角から（つまみは出さない）
  const frame = frameOf(dom, [HIGHLIGHT, TEXT], viewport(), { selected: 'sigk-3' });
  assert.equal(Number(frame.getAttribute('x')), 100 - FRAME_PADDING);
  assert.equal(Number(frame.getAttribute('width')), 64 + FRAME_PADDING * 2);
  assert.equal(dom.pages.querySelectorAll('.annot-handle').length, 0);

  // 編集中は入力欄が代わりなので、group も枠も出さない
  assert.equal(layer.draw(svg, [HIGHLIGHT, TEXT], viewport(), { editing: 'sigk-3' }), 1);
  assert.equal(svg.querySelector('g[data-annot="sigk-3"]'), null);
  assert.equal(frameOf(dom, [HIGHLIGHT, TEXT], viewport(), { selected: 'sigk-3', editing: 'sigk-3' }), null);
});

test('paint はテキストを fillText で描く', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_target, name) => (...args) => { calls.push([name, ...args]); },
    set: (_target, name, value) => { calls.push(['set', name, value]); return true; },
  });
  assert.equal(layer.paint(ctx, [TEXT, HIGHLIGHT], viewport()), 2);
  const texts = calls.filter((call) => call[0] === 'fillText').map((call) => call[1]);
  assert.deepEqual(texts, ['メモ', '二行目']);
  assert.equal(calls.filter((call) => call[0] === 'fill').length, 1);
});

test('keyOf は ref があれば ref、無ければ id', () => {
  assert.equal(layer.keyOf(HIGHLIGHT), 'sigk-1');
  assert.equal(layer.keyOf(UNDERLINE), '86R');
});

// ---- 図形・ペン（spec-4-3 確定事項3・8・25） ----

const SQUARE = { id: 'sigk-7', src: 0, kind: 'square', color: '#d92c2c', opacity: 1, lineWidth: 2, rect: [100, 600, 300, 700], quads: [[100, 700, 300, 700, 100, 600, 300, 600]] };
const ARROW = { ref: '40R', src: 0, kind: 'arrow', color: '#2c5cd9', opacity: 0.5, lineWidth: 3, rect: [98.5, 543.55, 301.5, 601.5], quads: [[98.5, 601.5, 301.5, 601.5, 98.5, 543.55, 301.5, 543.55]], paths: [[[100, 600], [300, 550]]] };

test('draw は図形を shape-graphics の <g> に委ね、矢印の選択の枠は線に沿った破線と両端のつまみ（spec-4b-2 確定事項11）', () => {
  const dom = makeDom();
  const svg = layer.mount(dom.doc, dom.node, viewport());
  assert.equal(layer.draw(svg, [HIGHLIGHT, SQUARE, ARROW], viewport(), { selected: '40R' }), 3);
  const square = svg.querySelector('g[data-annot="sigk-7"]');
  assert.equal(square.getAttribute('data-kind'), 'square');
  assert.equal(square.querySelector('g.shape.square rect').getAttribute('width'), '198');
  const arrow = svg.querySelector('g[data-annot="40R"]');
  assert.equal(arrow.getAttribute('opacity'), '0.5');
  assert.equal(arrow.querySelectorAll('line, polyline').length, 2);
  const frame = frameOf(dom, [HIGHLIGHT, SQUARE, ARROW], viewport(), { selected: '40R' });
  assert.equal(frame.tagName.toLowerCase(), 'line');
  assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map((name) => Number(frame.getAttribute(name))), [100, 241.89, 300, 291.89]);
  assert.deepEqual([...dom.pages.querySelectorAll('.annot-handle')].map((handle) => handle.getAttribute('data-handle')), ['start', 'end']);
});

test('draw は下書き（draft）を最後に annot-draft として描き、当たり判定の鍵を持たせない', () => {
  const { doc, node } = makeDom();
  const svg = layer.mount(doc, node, viewport());
  const draft = { ...SQUARE, id: undefined, rect: [10, 10, 60, 40], quads: [[10, 40, 60, 40, 10, 10, 60, 10]] };
  assert.equal(layer.draw(svg, [HIGHLIGHT], viewport(), { draft }), 2);
  const last = svg.lastElementChild;
  assert.equal(last.getAttribute('class'), 'annot-draft');
  assert.equal(last.hasAttribute('data-annot'), false);
  assert.equal(last.querySelector('rect').getAttribute('width'), '48');
  // 選んでいる注釈があっても、紙の層には下書きが最後に来る（枠は紙の外の層）
  assert.equal(layer.draw(svg, [HIGHLIGHT], viewport(), { selected: 'sigk-1', draft }), 2);
  assert.equal(svg.lastElementChild.getAttribute('class'), 'annot-draft');
  // 無ければ描かない
  assert.equal(layer.draw(svg, [HIGHLIGHT], viewport(), { draft: null }), 1);
});

// 描いている途中も選んだ線種と塗りで描く（spec-4b-1b 確定事項42。雲形はドラッグの間も雲形）。
test('draw は下書きを選んだ線種と塗りで描く', () => {
  const { doc, node } = makeDom();
  const svg = layer.mount(doc, node, viewport());
  const draft = { ...SQUARE, id: undefined, color: null, fill: '#ffff00', lineStyle: 'cloudy', cloudIntensity: 1, opacity: 0.5 };
  layer.draw(svg, [], viewport(), { draft });
  const group = svg.lastElementChild;
  assert.equal(group.getAttribute('class'), 'annot-draft');
  assert.equal(group.getAttribute('opacity'), '0.5');
  const shape = group.querySelector('g.shape.square');
  assert.deepEqual([shape.getAttribute('stroke'), shape.getAttribute('fill')], ['none', '#ffff00']);
  assert.equal(shape.querySelector('path') !== null && shape.querySelector('rect') === null, true);
});

test('paint は図形を shape-graphics に委ねる', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_target, name) => (...args) => { calls.push([name, ...args]); },
    set: (_target, name, value) => { calls.push(['set', name, value]); return true; },
  });
  assert.equal(layer.paint(ctx, [SQUARE, ARROW, HIGHLIGHT], viewport()), 3);
  assert.equal(calls.filter((call) => call[0] === 'strokeRect').length, 1);
  assert.equal(calls.filter((call) => call[0] === 'stroke').length, 2);
  assert.equal(calls.filter((call) => call[0] === 'fill').length, 1);
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'globalAlpha' && value === 0.5));
});

// ---- ノートと表示のみ（spec-4-4 確定事項8・11・32・34） ----

require('../renderer/note-graphics.js');

const NOTE = { id: 'sigk-9', src: 0, kind: 'note', color: '#ffe45a', opacity: 0.75, rect: [100, 680, 120, 700], quads: [[100, 700, 120, 700, 100, 680, 120, 680]], text: 'メモ', author: '総務' };
const READONLY = { ref: '17R', src: 0, kind: 'other', subtype: 'Line', color: '#ff0000', opacity: 1, rect: [298, 698, 502, 762], quads: [[298, 762, 502, 762, 298, 698, 502, 698]], text: 'other line', author: '', readonly: true };

test('draw はノートを note-graphics の <g> に委ね、選択の枠は画面の箱から（倍率に依らない）', () => {
  const dom = makeDom();
  const svg = layer.mount(dom.doc, dom.node, viewport(2));
  assert.equal(layer.draw(svg, [HIGHLIGHT, NOTE], viewport(2), { selected: 'sigk-9' }), 2);
  const note = svg.querySelector('g[data-annot="sigk-9"]');
  assert.equal(note.getAttribute('data-kind'), 'note');
  assert.equal(note.getAttribute('opacity'), '0.75');
  assert.equal(note.querySelector('g.note path').getAttribute('fill'), '#ffe45a');
  const frame = frameOf(dom, [HIGHLIGHT, NOTE], viewport(2), { selected: 'sigk-9' });
  assert.equal(Number(frame.getAttribute('x')), 200 - FRAME_PADDING);
  assert.equal(Number(frame.getAttribute('width')), Math.round((26.67 + FRAME_PADDING * 2) * 100) / 100);
});

test('draw は表示のみの注釈を描かず、選ばれていれば枠だけ出す', () => {
  const dom = makeDom();
  const svg = layer.mount(dom.doc, dom.node, viewport());
  assert.equal(layer.draw(svg, [READONLY, HIGHLIGHT], viewport()), 1);
  assert.equal(svg.querySelector('g[data-annot="17R"]'), null);
  assert.equal(layer.draw(svg, [READONLY, HIGHLIGHT], viewport(), { selected: '17R' }), 1);
  const frame = frameOf(dom, [READONLY, HIGHLIGHT], viewport(), { selected: '17R' });
  assert.equal(Number(frame.getAttribute('x')), 298 - FRAME_PADDING);
  assert.equal(Number(frame.getAttribute('width')), 204 + FRAME_PADDING * 2);
});

test('paint はノートを note-graphics に委ね、表示のみは描かない', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_target, name) => (...args) => { calls.push([name, ...args]); },
    set: (_target, name, value) => { calls.push(['set', name, value]); return true; },
  });
  assert.equal(layer.paint(ctx, [READONLY, NOTE], viewport()), 2);
  assert.equal(calls.filter((call) => call[0] === 'bezierCurveTo').length, 4);
  assert.equal(calls.filter((call) => call[0] === 'fill').length, 1);
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'globalAlpha' && value === 0.75));
  assert.equal(calls.filter((call) => call[0] === 'save').length, 1, '表示のみは描かない');
});

// 描いている途中の下書きも、確定後と同じ不透明度で描く（spec-4b-1a 確定事項32）。
test('下書きの group に不透明度が付く（1 なら付けない）', () => {
  const { doc, node } = makeDom();
  const svg = layer.mount(doc, node, viewport());
  const draft = { ...SQUARE, id: undefined, opacity: 0.25 };
  layer.draw(svg, [], viewport(), { draft });
  assert.equal(svg.lastElementChild.getAttribute('class'), 'annot-draft');
  assert.equal(svg.lastElementChild.getAttribute('opacity'), '0.25');
  layer.draw(svg, [], viewport(), { draft: { ...draft, opacity: 1 } });
  assert.equal(svg.lastElementChild.getAttribute('opacity'), null);
});
