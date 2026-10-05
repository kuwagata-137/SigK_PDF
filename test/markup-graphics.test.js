'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/markup-quads.js');
require('../renderer/markup-graphics.js');

// ハイライト・下線・取り消し線の描き手（annotation-layer.js から移した。spec-4b-4b）。

const graphics = globalThis.SigK.markupGraphics;

function viewport(scale = 1) {
  return { scale, rotation: 0, convertToViewportPoint: (x, y) => [x * scale, (841.89 - y) * scale] };
}

const HIGHLIGHT = { id: 'sigk-1', src: 0, kind: 'highlight', color: '#ffe45a', opacity: 1, quads: [[48, 753, 232, 753, 48, 743, 232, 743]], rect: [48, 743, 232, 753] };
const TWO_LINES = {
  id: 'sigk-2', src: 0, kind: 'strikeout', color: '#c00000', opacity: 1,
  quads: [[48, 753, 232, 753, 48, 743, 232, 743], [48, 733, 120, 733, 48, 723, 120, 723]], rect: [48, 723, 232, 753],
};

test('svgOf はハイライトを multiply の多角形、取り消し線を四角ごとの line にする', () => {
  const doc = new JSDOM('<!doctype html><svg></svg>').window.document;
  const [polygon] = graphics.svgOf(doc, HIGHLIGHT, viewport());
  assert.equal(polygon.tagName, 'polygon');
  assert.equal(polygon.getAttribute('class'), 'highlight');
  assert.equal(polygon.getAttribute('points'), '48,88.89 232,88.89 232,98.89 48,98.89');
  const lines = graphics.svgOf(doc, TWO_LINES, viewport());
  assert.deepEqual(lines.map((line) => [line.tagName, line.getAttribute('class'), line.getAttribute('stroke')]),
    [['line', 'strikeout', '#c00000'], ['line', 'strikeout', '#c00000']]);
});

test('paint は四角ごとに塗るか線を引き、不透明度と重ね方を save と restore で包む', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_target, name) => (...args) => { calls.push([name, ...args]); },
    set: (_target, name, value) => { calls.push(['set', name, value]); return true; },
  });
  graphics.paint(ctx, { ...TWO_LINES, opacity: 0.5 }, viewport(2));
  const names = calls.map((call) => call[0] + (call[0] === 'set' ? `:${call[1]}=${call[2]}` : ''));
  assert.deepEqual([names[0], names.at(-1)], ['save', 'restore']);
  assert.equal(names.includes('set:globalAlpha=0.5'), true);
  assert.equal(names.includes('set:globalCompositeOperation=source-over'), true);
  assert.equal(names.filter((name) => name === 'stroke').length, 2);
  assert.equal(names.filter((name) => name === 'fill').length, 0);
});
