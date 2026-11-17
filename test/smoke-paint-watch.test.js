'use strict';

// 起動確認で白いフレームを数える処理（smoke-paint-watch.js）と、モザイクの筋書きの画面側の式（smoke-image-mosaic.js）。2026-11-17 の不具合
// 「モザイクを配置するたびに画面がホワイトアウトする」の確認に作った。どちらも実機（offscreen 描画のウインドウ）でしか動かせないので、
// ここでは数え方と、式が文法として正しいことを見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const { whiteRatio, watchPaint, summarize } = require('../smoke-paint-watch.js');
const { openScript, placeScript } = require('../smoke-image-mosaic.js');

// NativeImage の代わり。width×height の画素を BGRA で持つ。color(x, y) が [r, g, b] を返す。
function fakeImage(width, height, color) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = color(x, y);
      bitmap.set([b, g, r, 255], (y * width + x) * 4);
    }
  }
  return { getSize: () => ({ width, height }), toBitmap: () => bitmap, toPNG: () => Buffer.from(`png ${width}x${height}`) };
}

const WHITE = () => [255, 255, 255];
const BLUE = () => [47, 111, 235];
const AREA = { left: 0, top: 0, right: 40, bottom: 40 };
const INNER = [40, 40];

function fakeWindow() {
  return { webContents: new EventEmitter() };
}

test('whiteRatio は範囲の中の白い画素の割合を返し、範囲の外は数えない', () => {
  // 左半分が白、右半分が青。
  const half = fakeImage(40, 40, (x) => (x < 20 ? WHITE() : BLUE()));
  assert.equal(whiteRatio(half, AREA, INNER), 0.5);
  assert.equal(whiteRatio(half, { left: 0, top: 0, right: 20, bottom: 40 }, INNER), 1);
  assert.equal(whiteRatio(half, { left: 20, top: 0, right: 40, bottom: 40 }, INNER), 0);
  // 拡大率 2 で描いた画像でも、範囲は CSS px で渡す。
  assert.equal(whiteRatio(fakeImage(80, 80, WHITE), AREA, INNER), 1);
  // 範囲の幅が 0 なら null。
  assert.equal(whiteRatio(half, { left: 10, top: 10, right: 10, bottom: 30 }, INNER), null);
});

test('watchPaint は記録をやめるまでの paint を数え、summarize は白い背景が見えた時刻と、白くないフレームに戻った時刻を返す', () => {
  const win = fakeWindow();
  const stop = watchPaint(win, AREA, INNER);
  for (const color of [BLUE, WHITE, WHITE, BLUE])
    win.webContents.emit('paint', {}, {}, fakeImage(40, 40, color));
  const watched = stop();
  win.webContents.emit('paint', {}, {}, fakeImage(40, 40, WHITE));

  assert.deepEqual(watched.frames.map((frame) => frame.white), [0, 1, 1, 0]);
  assert.equal(watched.whitest.white, 1);
  assert.equal(String(watched.last), 'png 40x40');
  const summary = summarize(watched);
  assert.equal(summary.frames, 4);
  assert.equal(summary.whiteFrames, 2);
  assert.equal(summary.maxWhite, 1);
  assert.equal(summary.whiteFromMs, watched.frames[1].ms);
  assert.equal(summary.recoveredMs, watched.frames[3].ms);
});

test('白いフレームが無ければ、いちばん白いフレームも、白い背景が見えた時刻も null', () => {
  const win = fakeWindow();
  const stop = watchPaint(win, AREA, INNER);
  win.webContents.emit('paint', {}, {}, fakeImage(40, 40, BLUE));
  const watched = stop();
  assert.equal(watched.whitest, null);
  assert.deepEqual(summarize(watched), { frames: 1, whiteFrames: 0, maxWhite: 0, whiteFromMs: null, recoveredMs: null });
});

test('モザイクの筋書きの画面側の式は、文法として正しい', () => {
  assert.doesNotThrow(() => new vm.Script(openScript('C:\\work\\a.png')));
  assert.doesNotThrow(() => new vm.Script(placeScript([[0.1, 0.2], [0.3, 0.4]])));
});
