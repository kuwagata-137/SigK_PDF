'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/free-text-shape.js');
require('../renderer/free-text-wrap.js');
require('../renderer/free-text-layout.js');
require('../renderer/free-text-metrics.js');

// 画面のフォントで測った、テキストの行と箱（spec-4b-4a 確定事項B・C・E1）。ここには canvas が無いので、字の送り幅は
// 全角 1em・半角 0.5em の見積もりになる。紙の範囲は偽のビューアから受ける。

const SigK = globalThis.SigK;
const metrics = SigK.freeTextMetrics;
const FIFTEEN = 'あいうえおかきくけこさしすせそ';

function withViewer(t, views) {
  SigK.viewer = { getPaperBox: (src) => views[src] ?? null };
  t.after(() => { delete SigK.viewer; });
}

function text(extra = {}) {
  return { src: 0, kind: 'text', text: FIFTEEN, fontSize: 10, rotation: 0, color: '#000000', rect: [100, 671, 224, 700], ...extra };
}

test('pageLengthOf はビューアの紙の範囲から文字の向きの長さを出し、分からなければ null', (t) => {
  withViewer(t, { 0: [0, 0, 595.28, 841.89] });
  assert.equal(metrics.pageLengthOf(0, 0), 595.28);
  assert.equal(metrics.pageLengthOf(0, 270), 841.89);
  assert.equal(metrics.pageLengthOf(3, 0), null);
});

test('layoutOfEntry は新しい形を自動の幅で折り、今までの形は改行だけで分ける', (t) => {
  withViewer(t, { 0: [0, 0, 595.28, 841.89] });
  assert.deepEqual(metrics.layoutOfEntry(text({ width: 'auto' })).lines, ['あいうえおかきくけこさし', 'すせそ']);
  assert.deepEqual(metrics.sizeOf(text({ width: 'auto' })), { width: 124, height: 29 });
  assert.deepEqual(metrics.layoutOfEntry(text()).lines, [FIFTEEN]);
  // 大きな文字は紙の幅で抑える（595.28 − 余白 4 ＝ 591.28 に 200pt の全角は 2 字）。
  assert.deepEqual(metrics.layoutOfEntry(text({ width: 'auto', fontSize: 200, text: 'あいうえ' })).lines, ['あい', 'うえ']);
});

test('reframe は中身の左上を動かさず、斜体の分だけ箱を左へ広げる', (t) => {
  withViewer(t, {});
  const entry = text({ width: 'auto' });
  const plain = metrics.reframe(entry, { fontSize: 10 });
  assert.deepEqual(plain.rect, [100, 671, 224, 700]);
  const italic = metrics.reframe(entry, { italic: true });
  // 左に 0.8、右に 2.5。上端は動かない。
  assert.deepEqual(italic.rect, [99.2, 671, 226.5, 700]);
  assert.equal(italic.quads.length, 1);
  // 回した表示でも、表示の左（紙の座標では回転ごとの向き）へ広げる。
  const turned = text({ width: 'auto', rotation: 90, rect: [100, 600, 129, 724] });
  assert.deepEqual(metrics.reframe(turned, { italic: true }).rect, [100, 599.2, 129, 726.5]);
});

test('editorWidthOf は新しい形なら真ん中の幅、今までの形なら最長行', (t) => {
  withViewer(t, {});
  // 12 字で折れる。入る行の最長 120、送った行は 12 字＋1 字＝130。真ん中は 125。
  assert.equal(metrics.editorWidthOf(text({ width: 'auto' })), 125);
  assert.equal(metrics.editorWidthOf(text({ width: 'auto', text: 'あい' })), 21);
  assert.equal(metrics.editorWidthOf(text()), 150);
});

test('advanceFor は太字なら太字の書体で測る口を返す', () => {
  const calls = [];
  const original = SigK.freeTextShape.advanceOf;
  SigK.freeTextShape.advanceOf = (doc, unit, bold) => { calls.push([unit, bold]); return 1; };
  try {
    metrics.advanceFor({ bold: true })('あ');
    metrics.advanceFor({})('い');
  } finally {
    SigK.freeTextShape.advanceOf = original;
  }
  assert.deepEqual(calls, [['あ', true], ['い', false]]);
});
