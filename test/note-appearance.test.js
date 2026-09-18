'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ICON_SIZE, NOTE_SHAPE, STROKE_RGB, POPUP_WIDTH, POPUP_HEIGHT, isNoteEntry, noteAppearanceOf } = require('../worker/note-appearance.js');

// ノート注釈の外観（spec-4-4 確定事項22〜24）。pdf-lib を知らない純粋層。

const RECT = [100, 680, 120, 700];

function note(overrides = {}) {
  return { src: 0, kind: 'note', color: '#ffe45a', opacity: 1, rect: RECT, text: 'メモ', author: '総務', ...overrides };
}

test('付箋は 20pt で、絵は 20×20 の座標で持つ', () => {
  assert.equal(ICON_SIZE, 20);
  assert.ok(Object.isFrozen(NOTE_SHAPE));
  // 輪郭は M で始まり、直線と 3 次ベジェで閉じる。本文の印は 2 本。
  assert.equal(NOTE_SHAPE.outline[0][0], 'M');
  assert.ok(NOTE_SHAPE.outline.every(([op, ...values]) => (op === 'M' || op === 'L' ? values.length === 2 : op === 'C' && values.length === 6)));
  assert.ok(NOTE_SHAPE.outline.flatMap(([, ...values]) => values).every((value) => value >= 0 && value <= ICON_SIZE));
  assert.equal(NOTE_SHAPE.lines.length, 2);
  assert.deepEqual(STROKE_RGB, [0.29, 0.29, 0.29]);
});

test('isNoteEntry は kind・箱・色・本文・作成者の形を見る', () => {
  assert.equal(isNoteEntry(note()), true);
  assert.equal(isNoteEntry(note({ text: '' })), true);
  assert.equal(isNoteEntry(note({ author: undefined })), true);
  assert.equal(isNoteEntry(note({ kind: 'text' })), false);
  assert.equal(isNoteEntry(note({ rect: [100, 680, 120] })), false);
  assert.equal(isNoteEntry(note({ rect: [120, 680, 100, 700] })), false);
  assert.equal(isNoteEntry(note({ color: 'yellow' })), false);
  assert.equal(isNoteEntry(note({ text: 5 })), false);
  assert.equal(isNoteEntry(note({ author: 5 })), false);
  assert.equal(isNoteEntry(null), false);
});

test('noteAppearanceOf は /Text の外観・辞書の欄・ポップアップの箱を返す', () => {
  const appearance = noteAppearanceOf(note());
  assert.equal(appearance.subtype, 'Text');
  assert.deepEqual(appearance.bbox, RECT);
  assert.deepEqual(appearance.rgb.map((v) => Math.round(v * 100) / 100), [1, 0.89, 0.35]);
  assert.equal(appearance.opacity, 1);
  assert.equal(appearance.flags, 28);
  assert.deepEqual(appearance.popupRect, [122, 600, 302, 700]);
  assert.equal(POPUP_WIDTH, 180);
  assert.equal(POPUP_HEIGHT, 100);

  const lines = appearance.content.split('\n');
  assert.equal(lines[0], '/GS gs');
  assert.equal(lines[1], '1 0.89 0.35 rg 0.29 0.29 0.29 RG 1 w 1 j 1 J');
  // 輪郭は左上 (x1, y2) を原点に y を下向きから紙の向きへ直す。最初の点は (100 + 3, 700 − 1.5)。
  assert.equal(lines[2], '103 698.5 m');
  assert.ok(lines.includes('h B'), '塗って線を引く');
  // 本文の印は塗らずに線だけ。
  const strokes = lines.filter((line) => / S$/.test(line));
  assert.equal(strokes.length, 2);
  assert.equal(strokes[0], '105.5 693.5 m 114.5 693.5 l S');
  // 指数表記が無く、末尾の 0 も無い。
  assert.doesNotMatch(appearance.content, /e[+-]\d/);
  assert.doesNotMatch(appearance.content, /\d\.\d*0 /);
});

test('noteAppearanceOf は不透明度を 0〜1 に丸め、形が違えば null', () => {
  assert.equal(noteAppearanceOf(note({ opacity: 0.5 })).opacity, 0.5);
  assert.equal(noteAppearanceOf(note({ opacity: 2 })).opacity, 1);
  assert.equal(noteAppearanceOf(note({ opacity: undefined })).opacity, 1);
  assert.equal(noteAppearanceOf(note({ kind: 'stamp' })), null);
  assert.equal(noteAppearanceOf(note({ color: '#ggg' })), null);
});

test('大きさの違う箱にも絵を合わせる（読み込んだ 22×22 など）', () => {
  const appearance = noteAppearanceOf(note({ rect: [100, 678, 122, 700] }));
  assert.deepEqual(appearance.bbox, [100, 678, 122, 700]);
  assert.equal(appearance.content.split('\n')[2], '103.3 698.35 m');
  assert.deepEqual(appearance.popupRect, [124, 600, 304, 700]);
});

// 画面の付箋と同じ絵であること（プロセスが違うので import できない。spec-4-4 確定事項22）。
test('NOTE_SHAPE は renderer/note-graphics.js と同じ', () => {
  require('../renderer/note-graphics.js');
  const graphics = globalThis.SigK.noteGraphics;
  assert.deepEqual(NOTE_SHAPE, graphics.NOTE_SHAPE);
  assert.equal(ICON_SIZE, graphics.ICON_SIZE);
  assert.equal(graphics.STROKE_COLOR, '#4a4a4a');
});
