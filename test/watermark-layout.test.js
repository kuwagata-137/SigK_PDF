'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SIZE_RATIOS, MARGIN_RATIO, ANGLES, POSITIONS,
  num4, normalizeRotation, displaySize, outerSize, placementOf, matrixText,
} = require('../worker/watermark-layout.js');

const A4 = [0, 0, 595.28, 841.89];
// 「社外秘」を大きさ 100 で組んだ素の箱（全角 3 字 × 高さ 1.448 em）。
const TEXT = { width: 300, height: 144.8 };

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} ${actual} ≠ ${expected}`);
}

function apply([a, b, c, d, e, f], [x, y]) {
  return [a * x + c * y + e, b * x + d * y + f];
}

// 素の箱の四隅を紙の座標へ写した外接の箱。
function paperBounds(matrix, { width, height }) {
  const corners = [[-width / 2, -height / 2], [width / 2, -height / 2], [-width / 2, height / 2], [width / 2, height / 2]]
    .map((point) => apply(matrix, point));
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// 紙の座標の外接の箱を、表示の座標（左上が原点・y は下向き）の [左, 上, 右, 下] へ。
function displayBounds([minX, minY, maxX, maxY], box, rotate) {
  const [x0, y0, x1, y1] = box;
  switch (rotate) {
    case 90: return [minY - y0, minX - x0, maxY - y0, maxX - x0];
    case 180: return [x1 - maxX, minY - y0, x1 - minX, maxY - y0];
    case 270: return [y1 - maxY, x1 - maxX, y1 - minY, x1 - minX];
    default: return [minX - x0, y1 - maxY, maxX - x0, y1 - minY];
  }
}

test('定数は仕様どおり（小 0.25・中 0.5・大 0.8、余白 5%、斜め 45°・水平 0°、9 か所）', () => {
  assert.deepEqual(SIZE_RATIOS, { small: 0.25, medium: 0.5, large: 0.8 });
  assert.equal(MARGIN_RATIO, 0.05);
  assert.deepEqual(ANGLES, { diagonal: 45, horizontal: 0 });
  assert.equal(POSITIONS.length, 9);
  assert.equal(POSITIONS[4], 'center');
});

test('中央・水平・回転なしは紙の中央に、幅と高さの小さい方の比で置く', () => {
  const matrix = placementOf({ box: A4, rotate: 0, ...TEXT, angle: 0, size: 'medium', position: 'center' });
  const scale = 0.5 * Math.min(595.28 / 300, 841.89 / 144.8);
  near(matrix[0], scale);
  near(matrix[1], 0);
  near(matrix[2], 0);
  near(matrix[3], scale);
  near(matrix[4], 297.64);
  near(matrix[5], 420.945);
});

test('/Rotate 90 のページでは表示の縦横で大きさを決め、紙の上では 90° 回して置く', () => {
  const matrix = placementOf({ box: A4, rotate: 90, ...TEXT, angle: 0, size: 'medium', position: 'center' });
  const scale = 0.5 * Math.min(841.89 / 300, 595.28 / 144.8);
  near(matrix[0], 0);
  near(matrix[1], scale);
  near(matrix[2], -scale);
  near(matrix[3], 0);
  near(matrix[4], 297.64);
  near(matrix[5], 420.945);
});

test('斜めは外形 (w+h)/√2 の正方形で収め、紙の上の角度は 45° ＋ /Rotate', () => {
  const outer = outerSize(300, 144.8, 45);
  near(outer.width, (300 + 144.8) / Math.SQRT2);
  near(outer.height, (300 + 144.8) / Math.SQRT2);
  const matrix = placementOf({ box: A4, rotate: 0, ...TEXT, angle: 45, size: 'large', position: 'center' });
  const scale = 0.8 * Math.min(595.28 / outer.width, 841.89 / outer.height);
  near(matrix[0], scale * Math.SQRT1_2);
  near(matrix[1], scale * Math.SQRT1_2);
  near(matrix[2], -scale * Math.SQRT1_2);
  near(matrix[3], scale * Math.SQRT1_2);
  const turned = placementOf({ box: A4, rotate: 270, ...TEXT, angle: 45, size: 'large', position: 'center' });
  const phi = ((45 + 270) * Math.PI) / 180;
  near(turned[0] / Math.hypot(turned[0], turned[1]), Math.cos(phi));
  near(turned[1] / Math.hypot(turned[0], turned[1]), Math.sin(phi));
});

test('全組み合わせで透かしは紙に収まり、端に寄せると縁から余白ちょうど、中は中央に来る', () => {
  const boxes = [A4, [50, 60, 545, 780], [0, 0, 1190.55, 841.89]];
  const marks = [TEXT, { width: 1000, height: 144.8 }, { width: 100, height: 300 }];
  for (const box of boxes) {
    for (const rotate of [0, 90, 180, 270]) {
      const display = displaySize(box, rotate);
      const margin = MARGIN_RATIO * Math.min(display.width, display.height);
      for (const mark of marks) {
        for (const angle of Object.values(ANGLES)) {
          for (const size of Object.keys(SIZE_RATIOS)) {
            for (const [index, position] of POSITIONS.entries()) {
              const label = `${box} r${rotate} ${mark.width}x${mark.height} ${angle}° ${size} ${position}`;
              const matrix = placementOf({ box, rotate, ...mark, angle, size, position });
              const [left, top, right, bottom] = displayBounds(paperBounds(matrix, mark), box, rotate);
              // 外形は紙の k 倍に収まり、どちらかの辺はちょうど k 倍になる。
              const k = SIZE_RATIOS[size];
              assert.ok(right - left <= k * display.width + 1e-6, label);
              assert.ok(bottom - top <= k * display.height + 1e-6, label);
              assert.ok(Math.abs(right - left - k * display.width) < 1e-6 || Math.abs(bottom - top - k * display.height) < 1e-6, label);
              const column = index % 3;
              const row = Math.floor(index / 3);
              if (column === 0) near(left, margin, label);
              if (column === 1) near((left + right) / 2, display.width / 2, label);
              if (column === 2) near(right, display.width - margin, label);
              if (row === 0) near(top, margin, label);
              if (row === 1) near((top + bottom) / 2, display.height / 2, label);
              if (row === 2) near(bottom, display.height - margin, label);
            }
          }
        }
      }
    }
  }
});

test('文字が長いほど小さくなる（はみ出さない）', () => {
  const short = placementOf({ box: A4, ...TEXT, angle: 0, size: 'medium', position: 'center' });
  const long = placementOf({ box: A4, width: 3000, height: 144.8, angle: 0, size: 'medium', position: 'center' });
  assert.ok(long[0] < short[0] / 5);
});

test('形が違えば null', () => {
  const ok = { box: A4, ...TEXT, angle: 0, size: 'medium', position: 'center' };
  assert.notEqual(placementOf(ok), null);
  assert.equal(placementOf({ ...ok, box: [0, 0, 0, 100] }), null);
  assert.equal(placementOf({ ...ok, box: [0, 0, 100] }), null);
  assert.equal(placementOf({ ...ok, width: 0 }), null);
  assert.equal(placementOf({ ...ok, height: -1 }), null);
  assert.equal(placementOf({ ...ok, angle: Number.NaN }), null);
  assert.equal(placementOf({ ...ok, size: 'huge' }), null);
  assert.equal(placementOf({ ...ok, size: 'toString' }), null);
  assert.equal(placementOf({ ...ok, position: 'middle' }), null);
});

test('/Rotate は 90 の倍数に寄せ、そうでなければ 0', () => {
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(180), 180);
  assert.equal(normalizeRotation(45), 0);
  assert.equal(normalizeRotation(undefined), 0);
});

test('行列の数は小数 4 桁で、-0 は 0 と書く', () => {
  assert.equal(num4(Math.SQRT1_2), '0.7071');
  assert.equal(num4(-0.00001), '0');
  assert.equal(num4(12), '12');
  assert.equal(num4(1.5), '1.5');
  assert.equal(matrixText([Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 297.64, 420.945]), '0.7071 0.7071 -0.7071 0.7071 297.64 420.945');
});
