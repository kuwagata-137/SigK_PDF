'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fontkit = require('@pdf-lib/fontkit');
const { UNITS, HEIGHT, BASELINE, pathOps, outlineOf } = require('../worker/glyph-outline.js');
const { createFontSource } = require('../worker/font-embed.js');

const cmd = (command, ...args) => ({ command, args });

// 外接の箱は浮動小数の足し算で端数が出るので、1e-9 まで同じなら同じとみる。
function nearBox(actual, expected) {
  assert.equal(actual.length, 4);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9, `${actual} ≠ ${expected}`));
}

test('pathOps は moveTo・lineTo・closePath を m・l・h にし、拡大と移動を当てる', () => {
  const ops = pathOps([cmd('moveTo', 0, 0), cmd('lineTo', 100, 0), cmd('lineTo', 100, 50), cmd('closePath')], 0.5, 10, 20);
  assert.deepEqual(ops, ['10 20 m', '60 20 l', '60 45 l', 'h']);
});

test('pathOps は二次曲線を三次へ直す（制御点は現在点と終点から 2/3 の内分）', () => {
  const ops = pathOps([cmd('moveTo', 0, 0), cmd('quadraticCurveTo', 30, 60, 90, 0)], 1, 0, 0);
  // c1 = 0 + 2/3 × (30 − 0, 60 − 0) = (20, 40)、c2 = 90 + 2/3 × (30 − 90, 60 − 0) = (50, 40)
  assert.deepEqual(ops, ['0 0 m', '20 40 50 40 90 0 c']);
});

test('pathOps は三次曲線をそのまま c にし、次の二次曲線は三次の終点から数える', () => {
  const ops = pathOps([
    cmd('moveTo', 0, 0),
    cmd('bezierCurveTo', 10, 20, 30, 40, 50, 60),
    cmd('quadraticCurveTo', 50, 90, 80, 60),
  ], 1, 0, 0);
  assert.deepEqual(ops, ['0 0 m', '10 20 30 40 50 60 c', '50 80 60 80 80 60 c']);
});

test('pathOps は知らないコマンドを飛ばし、数は小数 2 桁で書く', () => {
  assert.deepEqual(pathOps([cmd('moveTo', 1 / 3, 2 / 3), cmd('arcTo', 1, 2, 3), cmd('lineTo', 1.005, 2)], 1, 0, 0), ['0.33 0.67 m', '1 2 l']);
});

// 字送り 1000・高さ 1000 の四角いグリフだけを持つ偽のフォント。
function squareFont({ unitsPerEm = 1000 } = {}) {
  const square = {
    path: { commands: [cmd('moveTo', 0, 0), cmd('lineTo', 1000, 0), cmd('lineTo', 1000, 1000), cmd('lineTo', 0, 1000), cmd('closePath')] },
    bbox: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
  };
  const space = { path: { commands: [] }, bbox: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity } };
  return {
    unitsPerEm,
    layout(text) {
      const glyphs = [...text].map((ch) => (ch === ' ' ? space : square));
      const positions = glyphs.map(() => ({ xAdvance: 1000, yAdvance: 0, xOffset: 0, yOffset: 0 }));
      return { glyphs, positions, advanceWidth: 1000 * glyphs.length };
    },
  };
}

test('outlineOf は大きさ 100 で組み、素の箱の中心を原点に置く（ベースラインは中心から 43.6 下）', () => {
  assert.equal(UNITS, 100);
  assert.equal(HEIGHT, 144.8);
  assert.equal(BASELINE, -43.6);
  const outline = outlineOf(squareFont(), 'ab');
  assert.equal(outline.width, 200);
  assert.equal(outline.height, 144.8);
  // 1 字目は x = −100 から、ベースライン y = −43.6 に 100 × 100 の四角。
  assert.deepEqual(outline.ops.slice(0, 5), ['-100 -43.6 m', '0 -43.6 l', '0 56.4 l', '-100 56.4 l', 'h']);
  assert.deepEqual(outline.ops.slice(5, 7), ['0 -43.6 m', '100 -43.6 l']);
  nearBox(outline.inkBox, [-100, -43.6, 100, 56.4]);
});

test('outlineOf は空白の字送りを数え、輪郭の無いグリフは外接の箱に入れない', () => {
  const outline = outlineOf(squareFont(), 'a b');
  assert.equal(outline.width, 300);
  assert.equal(outline.ops.length, 10);
  nearBox(outline.inkBox, [-150, -43.6, 150, 56.4]);
  assert.deepEqual(outlineOf(squareFont(), '   ').inkBox, null);
});

test('outlineOf は unitsPerEm に合わせて縮め、字形のずれ（xOffset・yOffset）を当てる', () => {
  const font = squareFont({ unitsPerEm: 2000 });
  const layout = font.layout;
  font.layout = (text) => {
    const run = layout(text);
    run.positions[0] = { xAdvance: 1000, yAdvance: 0, xOffset: 200, yOffset: -100 };
    return run;
  };
  const outline = outlineOf(font, 'a');
  assert.equal(outline.width, 50);
  // x = −25 + 200 × 0.05 = −15、y = −43.6 − 100 × 0.05 = −48.6
  assert.equal(outline.ops[0], '-15 -48.6 m');
});

test('同梱の Noto Sans JP で「社外秘」は全角 3 字ぶんの幅になり、フォントを埋めずにパスだけを返す', () => {
  const loaded = createFontSource({ fontkit }).load();
  assert.equal(loaded.ok, true);
  const font = loaded.fontkit.create(loaded.bytes);
  const outline = outlineOf(font, '社外秘');
  assert.equal(outline.width, 300);
  assert.equal(outline.height, 144.8);
  assert.ok(outline.ops.length > 50);
  assert.ok(outline.ops.every((op) => /^(-?[\d.]+ ){2}m$|^(-?[\d.]+ ){2}l$|^(-?[\d.]+ ){6}c$|^h$/.test(op)), 'm・l・c・h だけ');
  // 字形は素の箱のおおむね内側にある。
  const [minX, minY, maxX, maxY] = outline.inkBox;
  assert.ok(minX >= -150 && maxX <= 150, `${minX} ${maxX}`);
  assert.ok(minY >= -72.4 && maxY <= 72.4, `${minY} ${maxY}`);
});
