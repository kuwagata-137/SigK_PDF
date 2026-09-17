'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
const worker = require('../worker/free-text-appearance.js');

// テキストの箱の座標（spec-4-2 確定事項11〜12・19）。DOM に触れない純粋層。

const geometry = globalThis.SigK.freeTextGeometry;

test('行の寸法の定数は worker/free-text-appearance.js と同値', () => {
  for (const key of ['FONT_ASCENT', 'FONT_DESCENT', 'LINE_HEIGHT', 'BASELINE', 'PADDING'])
    assert.equal(geometry[key], worker[key], key);
  assert.deepEqual(geometry.ROTATIONS, worker.ROTATIONS);
});

test('quadOfRect は /Rect を UL・UR・LL・LR の四角にする', () => {
  assert.deepEqual(geometry.quadOfRect([10, 20, 110, 70]), [10, 70, 110, 70, 10, 20, 110, 20]);
});

test('rectFromOrigin は表示の左上と大きさを回転ごとに紙の /Rect へ回す', () => {
  const size = { width: 100, height: 50 };
  // 回転なし: 左上 (10, 70) から右へ 100・下へ 50
  assert.deepEqual(geometry.rectFromOrigin([10, 70], size, 0), [10, 20, 110, 70]);
  // 90: 表示の右は紙の +y、表示の下は紙の +x
  assert.deepEqual(geometry.rectFromOrigin([10, 20], size, 90), [10, 20, 60, 120]);
  // 180: 表示の右は紙の −x、表示の下は紙の +y
  assert.deepEqual(geometry.rectFromOrigin([110, 20], size, 180), [10, 20, 110, 70]);
  // 270: 表示の右は紙の −y、表示の下は紙の −x
  assert.deepEqual(geometry.rectFromOrigin([60, 120], size, 270), [10, 20, 60, 120]);
  // 小数は 2 桁に丸める
  assert.deepEqual(geometry.rectFromOrigin([10.004, 70.006], { width: 1.114, height: 2.222 }, 0), [10, 67.78, 11.12, 70.01]);
});

test('frameOrigin と frameSize は rectFromOrigin の逆で往復できる', () => {
  const size = { width: 100, height: 50 };
  for (const rotation of [0, 90, 180, 270]) {
    const origin = [33, 44];
    const rect = geometry.rectFromOrigin(origin, size, rotation);
    assert.deepEqual(geometry.frameOrigin(rect, rotation), origin, `rotation ${rotation}`);
    assert.deepEqual(geometry.frameSize(rect, rotation), size, `rotation ${rotation}`);
  }
  // frameOrigin は worker の frameOf の起点を紙の座標で返したもの
  assert.deepEqual(geometry.frameOrigin([10, 20, 110, 70], 0), [10, 70]);
  assert.deepEqual(geometry.frameOrigin([10, 20, 110, 70], 90), [10, 20]);
  assert.deepEqual(geometry.frameOrigin([10, 20, 110, 70], 180), [110, 20]);
  assert.deepEqual(geometry.frameOrigin([10, 20, 110, 70], 270), [110, 70]);
  assert.deepEqual(geometry.frameSize([10, 20, 110, 70], 90), { width: 50, height: 100 });
});

test('screenAngle は表示の回転と置いたときの回転の差（0〜270）', () => {
  assert.equal(geometry.screenAngle(0, 0), 0);
  assert.equal(geometry.screenAngle(90, 0), 90);
  assert.equal(geometry.screenAngle(0, 90), 270);
  assert.equal(geometry.screenAngle(270, 90), 180);
  assert.equal(geometry.screenAngle(90, 90), 0);
  assert.equal(geometry.screenAngle(450, 0), 90);
});

test('boxOfLines は最長行の幅と行数から箱の大きさを決める', () => {
  const widthOf = (line) => line.length * 6;
  assert.deepEqual(geometry.boxOfLines(['abc', 'abcde', ''], 12, widthOf), { width: 30 + 4, height: 3 * 15 + 4 });
  // 空の 1 行でも 1 行分の高さ
  assert.deepEqual(geometry.boxOfLines([''], 10, widthOf), { width: 4, height: 12.5 + 4 });
  assert.deepEqual(geometry.boxOfLines([], 10, widthOf), { width: 4, height: 12.5 + 4 });
});

test('linesOf は改行で分け、CR は捨てる', () => {
  assert.deepEqual(geometry.linesOf('a\nb'), ['a', 'b']);
  assert.deepEqual(geometry.linesOf('a\r\nb\r'), ['a', 'b']);
  assert.deepEqual(geometry.linesOf(''), ['']);
});
