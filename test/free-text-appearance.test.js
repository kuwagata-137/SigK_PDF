'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FONT_ASCENT, FONT_DESCENT, LINE_HEIGHT, BASELINE, PADDING, RIGHT_SLACK, ROTATIONS,
  frameOf, widenRight, textBlockOps, freeTextAppearanceOf,
} = require('../worker/free-text-appearance.js');

// フリーテキスト注釈の外観（/AP /N）の中身（spec-4-2 確定事項25〜27）。
// pdf-lib を知らない純粋層なので、「文字を知る口」は偽物で足りる。

// 1 文字を UTF-16 の符号単位の hex 4 桁にし、幅は全角 1em・半角 0.5em と見なす偽の measure。
const measure = {
  name: 'SigKJP',
  encode: (line) => [...line].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0')).join(''),
  width: (line, size) => [...line].reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? 0.5 : 1), 0) * size,
};

const RECT = [100, 700, 200, 720.5];

function textEntry(overrides = {}) {
  return { src: 0, kind: 'text', color: '#1c2430', opacity: 1, rect: RECT, text: 'こんにちは', fontSize: 12, rotation: 0, ...overrides };
}

test('行の寸法の定数（renderer/free-text-geometry.js と同値）', () => {
  assert.equal(FONT_ASCENT, 1.16);
  assert.equal(FONT_DESCENT, 0.288);
  assert.equal(LINE_HEIGHT, 1.25);
  // 行送りの中に ascent＋descent を置いた余りを上下に振り分けた位置がベースライン。
  assert.equal(BASELINE, Math.round(((LINE_HEIGHT - (FONT_ASCENT + FONT_DESCENT)) / 2 + FONT_ASCENT) * 1000) / 1000);
  assert.equal(BASELINE, 1.061);
  assert.equal(PADDING, 2);
  assert.equal(RIGHT_SLACK, 1);
  assert.deepEqual(ROTATIONS, [0, 90, 180, 270]);
});

test('frameOf は pdf.js と同じ回転の行列・クリップ・起点を返す', () => {
  const rect = [10, 20, 110, 70];
  assert.deepEqual(frameOf(rect, 0), { matrix: [1, 0, 0, 1], clip: [10, 20, 100, 50], first: [10, 70] });
  assert.deepEqual(frameOf(rect, 90), { matrix: [0, 1, -1, 0], clip: [20, -110, 50, 100], first: [20, -10] });
  assert.deepEqual(frameOf(rect, 180), { matrix: [-1, 0, 0, -1], clip: [-110, -70, 100, 50], first: [-110, -20] });
  assert.deepEqual(frameOf(rect, 270), { matrix: [0, -1, 1, 0], clip: [-70, 10, 50, 100], first: [-70, 110] });
});

test('widenRight は表示の右へ伸ばす（紙の座標では回転で向きが変わる）', () => {
  const rect = [10, 20, 110, 70];
  assert.deepEqual(widenRight(rect, 0, 1), [10, 20, 111, 70]);
  assert.deepEqual(widenRight(rect, 90, 1), [10, 20, 110, 71]);
  assert.deepEqual(widenRight(rect, 180, 1), [9, 20, 110, 70]);
  assert.deepEqual(widenRight(rect, 270, 1), [10, 19, 110, 70]);
  assert.deepEqual(rect, [10, 20, 110, 70]);
});

test('textBlockOps は起点から余白とベースラインを下げて行を並べる', () => {
  const ops = textBlockOps({ lines: ['ab', 'あ'], fontSize: 10, rgb: [0, 0, 1], origin: [100, 700] }, measure);
  assert.deepEqual(ops, [
    'BT', '0 0 1 rg', '/SigKJP 10 Tf', '12.5 TL',
    // x = 100 + 2、y = 700 − 2 − 10 × 1.061
    '102 687.39 Td',
    '<00610062> Tj', 'T*', '<3042> Tj',
    'ET',
  ]);
  // 1 行なら T* は無い。
  assert.deepEqual(textBlockOps({ lines: ['a'], fontSize: 12, rgb: [0, 0, 0], origin: [0, 0] }, measure).filter((op) => op === 'T*'), []);
});

test('freeTextAppearanceOf は回転なしの外観と /DA を組む', () => {
  const appearance = freeTextAppearanceOf(textEntry(), measure);
  assert.deepEqual(appearance.bbox, [100, 700, 201, 720.5]);
  assert.deepEqual(appearance.rect, [100, 700, 201, 720.5]);
  assert.equal(appearance.da, '/SigKJP 12 Tf 0.11 0.14 0.19 rg');
  assert.equal(appearance.subtype, 'FreeText');
  assert.deepEqual(appearance.rgb, [28 / 255, 36 / 255, 48 / 255]);
  assert.equal(appearance.opacity, 1);
  assert.deepEqual(appearance.lines, ['こんにちは']);
  assert.equal(appearance.content, [
    'q', '/GS gs', '1 0 0 1 0 0 cm', '100 700 101 20.5 re W n',
    'BT', '0.11 0.14 0.19 rg', '/SigKJP 12 Tf', '15 TL', '102 705.77 Td',
    `<${measure.encode('こんにちは')}> Tj`, 'ET', 'Q',
  ].join('\n'));
});

test('freeTextAppearanceOf は回転した表示で置いた文字を cm で回し、複数行を T* で送る', () => {
  const entry = textEntry({ rect: [40, 100, 79, 300], text: '回転した\n日本語', fontSize: 14, rotation: 90, color: '#d92c2c' });
  const appearance = freeTextAppearanceOf(entry, measure);
  assert.deepEqual(appearance.bbox, [40, 100, 79, 301]);
  assert.equal(appearance.da, '/SigKJP 14 Tf 0.85 0.17 0.17 rg');
  const ops = appearance.content.split('\n');
  assert.equal(ops[2], '0 1 -1 0 0 0 cm');
  assert.equal(ops[3], '100 -79 201 39 re W n');
  assert.equal(ops[8], '102 -56.85 Td');
  assert.deepEqual(ops.slice(9, 12), [`<${measure.encode('回転した')}> Tj`, 'T*', `<${measure.encode('日本語')}> Tj`]);
  assert.deepEqual(appearance.lines, ['回転した', '日本語']);
});

test('freeTextAppearanceOf は空行も 1 行として書く', () => {
  const appearance = freeTextAppearanceOf(textEntry({ text: 'a\n\nb' }), measure);
  assert.deepEqual(appearance.lines, ['a', '', 'b']);
  assert.ok(appearance.content.includes('<> Tj'));
});

test('freeTextAppearanceOf は形が違えば null', () => {
  assert.equal(freeTextAppearanceOf(textEntry({ kind: 'highlight' }), measure), null);
  assert.equal(freeTextAppearanceOf(textEntry({ text: '' }), measure), null);
  assert.equal(freeTextAppearanceOf(textEntry({ text: '  \n ' }), measure), null);
  assert.equal(freeTextAppearanceOf(textEntry({ text: 5 }), measure), null);
  assert.equal(freeTextAppearanceOf(textEntry({ fontSize: 0 }), measure), null);
  assert.equal(freeTextAppearanceOf(textEntry({ fontSize: 'x' }), measure), null);
  assert.equal(freeTextAppearanceOf(textEntry({ rotation: 45 }), measure), null);
  assert.equal(freeTextAppearanceOf(textEntry({ color: 'red' }), measure), null);
  assert.equal(freeTextAppearanceOf(textEntry({ rect: [1, 2, 3] }), measure), null);
  assert.equal(freeTextAppearanceOf(textEntry({ rect: [1, 2, 3, 'x'] }), measure), null);
  assert.equal(freeTextAppearanceOf(null, measure), null);
});
