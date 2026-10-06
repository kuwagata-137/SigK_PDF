'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-crop.js');
const crop = globalThis.SigK.pageCrop;

// トリミングの箱の純関数（spec-4b-6a 確定事項1〜4・7・18）。箱は [x1, y1, x2, y2]（PDF の座標・回す前・pt）。

// pdf.js の PageViewport と同じ式で、PDF の点を画面の点へ写す（scale 1。事前調査 B で pdf.js 6.3.289 の式を写した）。
// 画面で見る向きの上下左右の読み替えが、pdf.js の描き方と合っているかをこれで確かめる。
function viewportOf(viewBox, rotation) {
  const centerX = (viewBox[2] + viewBox[0]) / 2;
  const centerY = (viewBox[3] + viewBox[1]) / 2;
  const [a, b, c, d] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[rotation];
  const offsetX = a === 0 ? Math.abs(centerY - viewBox[1]) : Math.abs(centerX - viewBox[0]);
  const offsetY = a === 0 ? Math.abs(centerX - viewBox[0]) : Math.abs(centerY - viewBox[1]);
  const e = offsetX - a * centerX - c * centerY;
  const f = offsetY - b * centerX - d * centerY;
  return { toScreen: ([x, y]) => [a * x + c * y + e, b * x + d * y + f] };
}

// 画面の上で box が visible から上下左右にどれだけ離れているか（pdf.js の式で測った答え）。
function screenMargins(visible, box, rotation) {
  const view = viewportOf(visible, rotation);
  const corners = (b) => [[b[0], b[1]], [b[2], b[3]]].map(view.toScreen);
  const [[vx1, vy1], [vx2, vy2]] = corners(visible);
  const [[bx1, by1], [bx2, by2]] = corners(box);
  const v = { left: Math.min(vx1, vx2), right: Math.max(vx1, vx2), top: Math.min(vy1, vy2), bottom: Math.max(vy1, vy2) };
  const b = { left: Math.min(bx1, bx2), right: Math.max(bx1, bx2), top: Math.min(by1, by2), bottom: Math.max(by1, by2) };
  return { top: b.top - v.top, right: v.right - b.right, bottom: v.bottom - b.bottom, left: b.left - v.left };
}

test('normalizeBox は並べ直して小数 2 桁に丸め、幅か高さが 0 なら null', () => {
  assert.deepEqual(crop.normalizeBox([300, 400.126, 100, 200]), [100, 200, 300, 400.13]);
  assert.equal(crop.normalizeBox([100, 200, 100, 400]), null);
  assert.equal(crop.normalizeBox([0, 0, Number.NaN, 10]), null);
  assert.equal(crop.normalizeBox(null), null);
});

test('sameBox は各辺 0.01pt まで同じと見なす', () => {
  assert.equal(crop.sameBox([0, 0, 595.28, 841.89], [0.01, 0, 595.27, 841.89]), true);
  assert.equal(crop.sameBox([0, 0, 595.28, 841.89], [0.02, 0, 595.28, 841.89]), false);
});

test('intersectBox は重なりを返し、重ならなければ null', () => {
  assert.deepEqual(crop.intersectBox([0, 0, 600, 800], [-100, 100, 400, 2000]), [0, 100, 400, 800]);
  assert.equal(crop.intersectBox([0, 0, 100, 100], [200, 200, 300, 300]), null);
});

test('marginsOf は画面で見る向きの上下左右の幅を返す（4 つの角度とも pdf.js の描き方と合う）', () => {
  const visible = [50, 60, 650, 860];
  const box = [80, 100, 600, 700];
  for (const rotation of [0, 90, 180, 270]) {
    const got = crop.marginsOf(visible, box, rotation);
    const want = screenMargins(visible, box, rotation);
    for (const side of ['top', 'right', 'bottom', 'left'])
      assert.ok(Math.abs(got[side] - want[side]) < 1e-9, `${rotation}° の ${side}: ${got[side]} と ${want[side]}`);
  }
});

test('shrinkBy は marginsOf の逆で、同じ向きなら元の箱に戻る', () => {
  const visible = [0, 0, 600, 800];
  const box = [20, 30, 560, 700];
  for (const rotation of [0, 90, 180, 270])
    assert.deepEqual(crop.shrinkBy(visible, crop.marginsOf(visible, box, rotation), rotation), box);
});

test('shrinkBy は大きさの違う・回したページでも、画面で見る向きの端から同じ幅を切る（確定事項18）', () => {
  const margins = { top: 40, right: 10, bottom: 20, left: 30 };
  const other = [0, 0, 842, 595];
  for (const rotation of [0, 90, 180, 270]) {
    const box = crop.shrinkBy(other, margins, rotation);
    const back = screenMargins(other, box, rotation);
    assert.deepEqual(back, margins, `${rotation}°`);
  }
});

test('shrinkBy は幅か高さが 10pt 未満になるなら null', () => {
  assert.equal(crop.shrinkBy([0, 0, 100, 100], { top: 0, right: 46, bottom: 0, left: 46 }, 0), null);
  assert.deepEqual(crop.shrinkBy([0, 0, 100, 100], { top: 0, right: 45, bottom: 0, left: 45 }, 0), [45, 0, 55, 100]);
});

test('sizeOf は画面で見る向きの幅と高さで、90°・270° なら入れ替え、userUnit を掛ける', () => {
  assert.deepEqual(crop.sizeOf([100, 200, 400, 600], 0), { width: 300, height: 400 });
  assert.deepEqual(crop.sizeOf([100, 200, 400, 600], 90), { width: 400, height: 300 });
  assert.deepEqual(crop.sizeOf([100, 200, 400, 600], 270, 2), { width: 800, height: 600 });
  assert.deepEqual(crop.sizeOf(null, 0), { width: 0, height: 0 });
});

test('withCrop は箱を付け、ファイルの見える範囲と同じか null なら欄を消す（確定事項2）', () => {
  const view = [0, 0, 600, 800];
  assert.deepEqual(crop.withCrop({ src: 0, rotate: 90 }, [10, 20, 300, 400], view), { src: 0, rotate: 90, crop: [10, 20, 300, 400] });
  assert.deepEqual(crop.withCrop({ src: 0, rotate: 0, crop: [10, 20, 300, 400] }, [0, 0, 600, 800.004], view), { src: 0, rotate: 0 });
  assert.deepEqual(crop.withCrop({ src: 0, rotate: 0, crop: [10, 20, 300, 400] }, null, view), { src: 0, rotate: 0 });
});

test('visibleOf は切った箱、無ければファイルの見える範囲', () => {
  assert.deepEqual(crop.visibleOf({ src: 0, crop: [1, 2, 3, 4] }, [0, 0, 10, 10]), [1, 2, 3, 4]);
  assert.deepEqual(crop.visibleOf({ src: 0 }, [0, 0, 10, 10]), [0, 0, 10, 10]);
});
