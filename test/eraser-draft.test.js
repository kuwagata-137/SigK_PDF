'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/shape-style.js');
require('../renderer/shape-outline.js');
require('../renderer/cloud-geometry.js');
require('../renderer/cross-geometry.js');
require('../renderer/ink-cut.js');
require('../renderer/eraser-reach.js');
require('../renderer/eraser-draft.js');

// 消しゴムでなぞっている途中の状態と下見（spec-4b-5b 確定事項19〜22）。ページの座標は、画面の px を倍率で割っただけの簡単な
// viewport で見る（上下を返さない）。

const draft = globalThis.SigK.eraserDraft;

function viewportOf(scale) {
  return { scale, convertToPdfPoint: (x, y) => [x / scale, y / scale] };
}

// 紙の pt を、倍率 scale の画面の px にする。
const px = (point, scale = 1) => point.map((value) => value * scale);

const pen = (fields = {}) => ({ id: 'p1', kind: 'ink', color: '#000000', opacity: 1, lineWidth: 2, paths: [[[0, 100], [200, 100]]], rect: [-1, 99, 201, 101], ...fields });
const square = (fields = {}) => ({ id: 's1', kind: 'square', color: '#c00000', opacity: 1, lineWidth: 2, rect: [100, 150, 200, 250], ...fields });

function begin(entries, point, { scale = 1, index = 0 } = {}) {
  return draft.begin({ index, src: index, viewport: viewportOf(scale), point: px(point, scale), entries });
}

test.afterEach(() => draft.cancel());

test('消しゴムの半径は画面で 8px、丸ごと消える図形の下見は不透明度 ×0.3', () => {
  assert.equal(draft.RADIUS_PX, 8);
  assert.equal(draft.FADE, 0.3);
});

test('押した点の輪の中も消す。半径は 8px を押したときの倍率で割った pt（決定62 ③）', () => {
  // 倍率 1: 半径 8pt。線の太さの半分 1pt を足して、押した x=100 の前後 9pt を切る
  begin([pen()], [100, 100]);
  assert.equal(draft.isErasing(), true);
  assert.equal(draft.pageIndex(), 0);
  const one = draft.finish();
  assert.deepEqual(one.remove, []);
  assert.deepEqual([...one.update.get('p1')], [[[0, 100], [91, 100]], [[109, 100], [200, 100]]]);
  // 倍率 2: 半径 4pt で前後 5pt
  begin([pen()], [100, 100], { scale: 2 });
  assert.deepEqual([...draft.finish().update.get('p1')], [[[0, 100], [95, 100]], [[105, 100], [200, 100]]]);
});

test('動かすたびに伸ばした線分だけで切り直し、触れた所がたまる', () => {
  const entries = [pen()];
  begin(entries, [50, 120]);
  draft.extend(px([50, 80]), entries);
  draft.extend(px([150, 80]), entries);
  draft.extend(px([150, 120]), entries);
  const { remove, update } = draft.finish();
  assert.deepEqual(remove, []);
  assert.deepEqual([...update.get('p1')], [[[0, 100], [41, 100]], [[59, 100], [141, 100]], [[159, 100], [200, 100]]]);
  assert.equal(draft.isErasing(), false);
  assert.equal(draft.pageIndex(), null);
});

test('図形は一度触れたら丸ごと消す印を付け、何度触れても 1 回だけ数える', () => {
  const entries = [square(), pen()];
  // 四角の上の辺（y=151 が線の中心）を横切り、もう一度戻る
  begin(entries, [150, 140]);
  draft.extend(px([150, 160]), entries);
  draft.extend(px([160, 140]), entries);
  const { remove, update } = draft.finish();
  assert.deepEqual(remove, ['s1']);
  assert.equal(update.size, 0, 'ペンには触れていない');
});

test('線が全部消えたペン・マーカーは remove へ回し、切れ端の残るものだけ update に入る', () => {
  const short = pen({ id: 'p2', paths: [[[100, 100], [103, 100]]], rect: [99, 99, 104, 101] });
  const marker = pen({ id: 'm1', blend: 'multiply', lineWidth: 12, paths: [[[0, 130], [300, 130]]], rect: [-6, 124, 306, 136] });
  begin([short, marker], [101, 100]);
  draft.extend(px([101, 130]), [short, marker]);
  const { remove, update } = draft.finish();
  assert.deepEqual(remove, ['p2']);
  // マーカーは太さの半分 6pt＋半径 8pt で、x=101 の前後 14pt を切る
  assert.deepEqual([...update.get('m1')], [[[0, 130], [87, 130]], [[115, 130], [300, 130]]]);
});

test('読み込んだ書き込みは ref を鍵にし、表示のみのペン・テキスト・ハイライトは消さない', () => {
  const imported = pen({ id: undefined, ref: '12 0 R' });
  const readonly = pen({ id: 'r1', readonly: true });
  const text = { id: 't1', kind: 'text', rect: [80, 90, 120, 110], contents: 'あ' };
  const highlight = { id: 'h1', kind: 'highlight', color: '#ffff00', opacity: 1, rect: [80, 90, 120, 110], quads: [[80, 110, 120, 110, 80, 90, 120, 90]] };
  begin([imported, readonly, text, highlight], [100, 100]);
  const { remove, update } = draft.finish();
  assert.deepEqual(remove, []);
  assert.deepEqual([...update.keys()], ['12 0 R']);
});

test('回した図形は、回した外接で絞り込んでから当たりを見る', () => {
  // 45° 回した四角の右の角は x=220.71 まで出る。回す前の箱（右端 200）だけで絞ると落ちる点
  const rotated = square({ rect: [100, 100, 200, 200], angle: 45 });
  begin([rotated], [215, 150]);
  assert.deepEqual(draft.finish().remove, ['s1']);
});

test('取りやめると、なぞっていた状態を捨てる。なぞっていなければ何もしない', () => {
  begin([pen()], [100, 100]);
  assert.equal(draft.cancel(), true);
  assert.equal(draft.isErasing(), false);
  assert.equal(draft.cancel(), false);
  assert.equal(draft.finish(), null);
  assert.equal(draft.extend([0, 0], []), false);
});

test('下見: 切ったペンは切った形と箱、線が残らないものは描かず、丸ごと消える図形は薄く、ほかはそのまま', () => {
  const cut = pen();
  const gone = pen({ id: 'p2', paths: [[[100, 160], [103, 160]]], rect: [99, 159, 104, 161] });
  const faded = square({ opacity: 0.5 });
  const kept = pen({ id: 'p3', paths: [[[0, 400], [50, 400]]], rect: [-1, 399, 51, 401] });
  const entries = [cut, gone, faded, kept];
  begin(entries, [100, 100]);
  draft.extend(px([100, 160]), entries);
  const shown = draft.shownOf(0, entries);
  assert.deepEqual(shown.map((entry) => entry.id), ['p1', 's1', 'p3']);
  assert.deepEqual(shown[0].paths, [[[0, 100], [91, 100]], [[109, 100], [200, 100]]]);
  assert.deepEqual(shown[0].rect, [-1, 99, 201, 101]);
  assert.equal(shown[1].opacity, 0.15);
  assert.equal(shown[2], kept, '触れていないものは同じもの');
  assert.equal(cut.paths.length, 1, '元の書き込みは変えない');
  // ほかのページ・なぞっていないときは並びをそのまま返す
  assert.equal(draft.shownOf(1, entries), entries);
  draft.cancel();
  assert.equal(draft.shownOf(0, entries), entries);
});

test('下見の箱は切った形から引き直す（端を削ると箱が縮む）', () => {
  begin([pen()], [0, 100]);
  const [shown] = draft.shownOf(0, [pen()]);
  assert.deepEqual(shown.paths, [[[9, 100], [200, 100]]]);
  assert.deepEqual(shown.rect, [8, 99, 201, 101]);
});
