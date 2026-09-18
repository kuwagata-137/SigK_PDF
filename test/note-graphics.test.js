'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/note-graphics.js');

// 画面の付箋（spec-4-4 確定事項8・11・12・34）。倍率に依らず一定の大きさで、回転した紙でも上向き。

const graphics = globalThis.SigK.noteGraphics;

function makeDoc() {
  return new JSDOM('<!doctype html><div class="pdf-page"></div>').window.document;
}

// 回転 0・倍率 scale の viewport（A4）。回転 90 は pdf.js と同じ変換。
function viewport({ scale = 1, rotation = 0 } = {}) {
  const [w, h] = [595.28, 841.89];
  if (rotation === 90) {
    return {
      width: h * scale, height: w * scale, scale, rotation,
      convertToViewportPoint: (x, y) => [y * scale, x * scale],
      convertToPdfPoint: (x, y) => [y / scale, x / scale],
    };
  }
  return {
    width: w * scale, height: h * scale, scale, rotation,
    convertToViewportPoint: (x, y) => [x * scale, (h - y) * scale],
    convertToPdfPoint: (x, y) => [x / scale, h - y / scale],
  };
}

const NOTE = { id: 'sigk-1', src: 0, kind: 'note', color: '#ffe45a', opacity: 1, rect: [100, 680, 120, 700], quads: [[100, 700, 120, 700, 100, 680, 120, 680]], text: 'メモ', author: '総務' };

function num(value) {
  return Math.round(value * 100) / 100;
}

function recordingContext(calls) {
  return new Proxy({}, {
    get: (_target, name) => (...args) => { calls.push([name, ...args]); },
    set: (_target, name, value) => { calls.push(['set', name, value]); return true; },
  });
}

test('付箋は 20pt 相当の px で固定', () => {
  assert.equal(graphics.ICON_SIZE, 20);
  assert.equal(num(graphics.ICON_PX), 26.67);
  assert.equal(graphics.STROKE_COLOR, '#4a4a4a');
  assert.ok(Object.isFrozen(graphics.NOTE_SHAPE));
});

test('boxOf は箱の左上を基準に、倍率に依らず同じ大きさの箱を返す', () => {
  const at1 = graphics.boxOf(NOTE, viewport({ scale: 1 }));
  assert.deepEqual([at1.x, num(at1.y), num(at1.width), num(at1.height)], [100, 141.89, 26.67, 26.67]);
  const at2 = graphics.boxOf(NOTE, viewport({ scale: 2 }));
  assert.deepEqual([at2.x, num(at2.y), num(at2.width), num(at2.height)], [200, 283.78, 26.67, 26.67]);
});

test('boxOf は回転した紙でも左上の角を基準に右下へ広がる（上向きのまま）', () => {
  // 紙の左上 (100, 700) は回転 90 の表示で (700, 100)。そこから右下へ。
  const box = graphics.boxOf(NOTE, viewport({ rotation: 90 }));
  assert.deepEqual([box.x, box.y, num(box.width), num(box.height)], [700, 100, 26.67, 26.67]);
});

test('anchorOf は箱の左上を紙の座標で返し、rectFromAnchor は 20×20 の箱を組む', () => {
  assert.deepEqual(graphics.anchorOf(NOTE), [100, 700]);
  assert.deepEqual(graphics.rectFromAnchor([50.123, 600.456]), [50.12, 580.46, 70.12, 600.46]);
  assert.deepEqual(graphics.quadOfRect([100, 680, 120, 700]), [100, 700, 120, 700, 100, 680, 120, 680]);
});

test('hits は画面の箱の内側で当たる', () => {
  const view = viewport({ scale: 1 });
  assert.equal(graphics.hits(NOTE, [110, 150], view), true);
  assert.equal(graphics.hits(NOTE, [100, 141.9], view), true);
  assert.equal(graphics.hits(NOTE, [127, 150], view), false);
  assert.equal(graphics.hits(NOTE, [110, 140], view), false);
});

test('svgOf は translate と scale の <g> に、塗った輪郭と本文の印を置く', () => {
  const g = graphics.svgOf(makeDoc(), NOTE, viewport({ scale: 2 }));
  assert.equal(g.tagName.toLowerCase(), 'g');
  assert.equal(g.getAttribute('class'), 'note');
  assert.equal(g.getAttribute('transform'), 'translate(200 283.78) scale(1.33)');
  const paths = [...g.querySelectorAll('path')];
  assert.equal(paths.length, 2);
  assert.equal(paths[0].getAttribute('fill'), '#ffe45a');
  assert.equal(paths[0].getAttribute('stroke'), '#4a4a4a');
  assert.equal(paths[0].getAttribute('stroke-width'), '1');
  assert.equal(paths[0].getAttribute('stroke-linejoin'), 'round');
  assert.match(paths[0].getAttribute('d'), /^M3 1.5 L17 1.5 C17.83 1.5 18.5 2.17 18.5 3 /);
  assert.match(paths[0].getAttribute('d'), / Z$/);
  assert.equal(paths[1].getAttribute('fill'), 'none');
  assert.equal(paths[1].getAttribute('d'), 'M5.5 6.5 L14.5 6.5 M5.5 9.5 L11.5 9.5');
});

test('paint は印刷の倍率で 20pt の大きさに描き、不透明度を globalAlpha に当てる', () => {
  const calls = [];
  const ctx = recordingContext(calls);
  assert.equal(graphics.paint(ctx, { ...NOTE, opacity: 0.5 }, viewport({ scale: 2 })), 1);
  assert.deepEqual(calls[0], ['save']);
  assert.deepEqual(calls.find((c) => c[0] === 'set' && c[1] === 'globalAlpha'), ['set', 'globalAlpha', 0.5]);
  assert.deepEqual(calls.find((c) => c[0] === 'set' && c[1] === 'fillStyle'), ['set', 'fillStyle', '#ffe45a']);
  assert.deepEqual(calls.find((c) => c[0] === 'set' && c[1] === 'strokeStyle'), ['set', 'strokeStyle', '#4a4a4a']);
  const translate = calls.find((c) => c[0] === 'translate');
  assert.deepEqual([translate[1], num(translate[2])], [200, 283.78]);
  // 印刷は倍率に追従（20pt × 2 ＝ 40px なので 20 の絵を 2 倍）。
  assert.deepEqual(calls.find((c) => c[0] === 'scale'), ['scale', 2, 2]);
  assert.deepEqual(calls.filter((c) => c[0] === 'moveTo').length, 3);
  assert.deepEqual(calls.filter((c) => c[0] === 'bezierCurveTo').length, 4);
  assert.equal(calls.filter((c) => c[0] === 'fill').length, 1);
  assert.equal(calls.filter((c) => c[0] === 'stroke').length, 2);
  assert.deepEqual(calls.at(-1), ['restore']);
});
