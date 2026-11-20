'use strict';

// 起動確認 SIGK_SMOKE_PAGE_REPAINT（smoke-page-repaint.js。docs/07 決定99 ②）。実機（offscreen 描画のウインドウ）でしか動かせないので、
// ここでは、白いフレームの数え方と、画面（レンダラー）に流し込む式が文法として正しいことを見る（smoke-paint-watch.test.js と同じ作法）。

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { installWatch, whiteFrames, WHITE_MARGIN } = require('../smoke-page-repaint.js');

const framesOf = (values) => ({ frames: values.map((white, index) => ({ ms: index * 16, white })) });

test('操作の前と描き終えた後より WHITE_MARGIN 以上白いフレームを、白いフレームと数える', () => {
  assert.equal(WHITE_MARGIN, 0.1);
  // 写真（白い画素が 2%）を表示している間に、絵の無い枠（白い背景）が 2 フレーム見えた。
  const flashed = whiteFrames(framesOf([0.02, 0.85, 0.85, 0.03]), 0.02);
  assert.deepEqual(flashed, { paintFrames: 4, whiteFrames: 2, maxWhite: 0.85, baseline: 0.02, settledWhite: 0.03 });
  // 回転で白い画素の割合が変わっても（紙の向きが変わる）、前と後のどちらかより大きく白くなければ数えない。
  assert.equal(whiteFrames(framesOf([0.1, 0.15, 0.2]), 0.1).whiteFrames, 0);
  // 記録が無ければ 0。
  assert.deepEqual(whiteFrames(framesOf([null]), 0.3), { paintFrames: 0, whiteFrames: 0, maxWhite: 0, baseline: 0.3, settledWhite: 0.3 });
});

test('画面に流し込む式は、文法として正しい', () => {
  assert.doesNotThrow(() => new vm.Script(`(${installWatch.toString()})()`));
});
