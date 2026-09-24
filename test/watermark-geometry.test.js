'use strict';

// 透かしの幾何の画面側（spec-4-5 確定事項19）。ワーカー側（worker/watermark-layout.js）と
// 同じ値になることを、全組み合わせで見張る（プロセスが違うので同じ式を 2 か所に持っている）。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/watermark-geometry.js');
const layout = require('../worker/watermark-layout.js');
const { HEIGHT, BASELINE, UNITS } = require('../worker/glyph-outline.js');
const { IMAGE_WIDTH, imageMarkOf } = require('../worker/watermark-appearance.js');

const geometry = globalThis.SigK.watermarkGeometry;

test('定数はワーカーと同じ（大きさ・余白・向き・位置・文字と画像の素の箱）', () => {
  assert.deepEqual({ ...geometry.SIZE_RATIOS }, { ...layout.SIZE_RATIOS });
  assert.equal(geometry.MARGIN_RATIO, layout.MARGIN_RATIO);
  assert.deepEqual({ ...geometry.ANGLES }, { ...layout.ANGLES });
  assert.deepEqual([...geometry.POSITIONS], [...layout.POSITIONS]);
  assert.equal(geometry.TEXT_SIZE, UNITS);
  assert.equal(geometry.TEXT_HEIGHT, HEIGHT);
  assert.equal(geometry.TEXT_BASELINE, -BASELINE);
  assert.equal(geometry.IMAGE_WIDTH, IMAGE_WIDTH);
});

test('placementOf は全組み合わせでワーカーの placementOf と同じ行列を返す', () => {
  const boxes = [[0, 0, 595.28, 841.89], [50, 60, 545, 780], [0, 0, 1190.55, 841.89], [100, 200, 400, 600]];
  const marks = [{ width: 300, height: 144.8 }, { width: 1234.5, height: 144.8 }, { width: 100, height: 333.33 }];
  let compared = 0;
  for (const box of boxes) {
    for (const rotate of [0, 90, 180, 270, -90, 45]) {
      for (const mark of marks) {
        for (const angle of Object.values(layout.ANGLES)) {
          for (const size of Object.keys(layout.SIZE_RATIOS)) {
            for (const position of layout.POSITIONS) {
              const args = { box, rotate, ...mark, angle, size, position };
              assert.deepEqual(geometry.placementOf(args), layout.placementOf(args), JSON.stringify(args));
              compared += 1;
            }
          }
        }
      }
    }
  }
  assert.equal(compared, 4 * 6 * 3 * 2 * 3 * 9);
});

test('形が違えばワーカーと同じく null', () => {
  const ok = { box: [0, 0, 100, 100], width: 10, height: 10, angle: 0, size: 'medium', position: 'center' };
  for (const patch of [{ box: [0, 0, 0, 1] }, { width: 0 }, { angle: Number.NaN }, { size: 'toString' }, { position: 'middle' }]) {
    assert.equal(geometry.placementOf({ ...ok, ...patch }), null);
    assert.equal(layout.placementOf({ ...ok, ...patch }), null);
  }
});

test('displayPlacementOf の中心を紙へ写すと、placementOf の平行移動になる', () => {
  const args = { box: [0, 0, 595.28, 841.89], rotate: 90, width: 300, height: 144.8, angle: 45, size: 'large', position: 'top-right' };
  const placed = geometry.displayPlacementOf(args);
  const matrix = geometry.placementOf(args);
  // /Rotate 90: 表示 (x, y) → 紙 (x0 + y, y0 + x)
  assert.ok(Math.abs(matrix[4] - placed.cy) < 1e-9);
  assert.ok(Math.abs(matrix[5] - placed.cx) < 1e-9);
  assert.equal(placed.rotation, 90);
  assert.deepEqual(placed.display, { width: 841.89, height: 595.28 });
  assert.ok(Math.abs(Math.hypot(matrix[0], matrix[1]) - placed.scale) < 1e-9);
});

test('imageBoxHeight はワーカーの imageMarkOf と同じ丸めで高さを出す', () => {
  for (const [width, height] of [[400, 200], [300, 1000], [7, 3], [1000, 1]])
    assert.equal(geometry.imageBoxHeight(width, height), imageMarkOf({ width, height, opacity: 1 }).height);
});
