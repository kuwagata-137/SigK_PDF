'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  KAPPA, ARROW_MIN_LENGTH, ARROW_LENGTH_RATIO, ARROW_ANGLE, SUBTYPES,
  arrowHead, isShapeEntry, shapeAppearanceOf,
} = require('../worker/shape-appearance.js');

// 図形・ペン注釈の外観（/AP /N）の中身（spec-4-3 確定事項20〜22・30）。pdf-lib を知らない純粋層。

const RED = '#d92c2c';

function square(overrides = {}) {
  return { src: 0, kind: 'square', color: RED, opacity: 1, rect: [100, 600, 300, 700], lineWidth: 2, ...overrides };
}

function line(overrides = {}) {
  return { src: 0, kind: 'line', color: '#2c5cd9', opacity: 1, rect: [98.5, 548.5, 301.5, 601.5], lineWidth: 3, paths: [[[100, 600], [300, 550]]], ...overrides };
}

function ink(overrides = {}) {
  return { src: 1, kind: 'ink', color: '#2f9e5a', opacity: 1, rect: [99, 479, 151, 511], lineWidth: 2, paths: [[[100, 500], [120, 480], [150, 510]]], ...overrides };
}

test('矢じりの寸法と翼の式は renderer/shape-geometry.js と同値', () => {
  require('../renderer/free-text-geometry.js');
  require('../renderer/arrow-head.js');
  require('../renderer/shape-geometry.js');
  const geo = globalThis.SigK.shapeGeometry;
  assert.equal(ARROW_MIN_LENGTH, geo.ARROW_MIN_LENGTH);
  assert.equal(ARROW_LENGTH_RATIO, geo.ARROW_LENGTH_RATIO);
  assert.equal(ARROW_ANGLE, geo.ARROW_ANGLE);
  for (const [from, to, width] of [[[0, 0], [100, 0], 2], [[10, 10], [10, -20], 3], [[100, 600], [300, 550], 1]])
    assert.deepEqual(arrowHead(from, to, width), geo.arrowHead(from, to, width));
  assert.equal(KAPPA, 0.5523);
});

test('Subtype は矩形 Square・楕円 Circle・直線と矢印 PolyLine・×印とペン Ink', () => {
  assert.deepEqual(SUBTYPES, { square: 'Square', circle: 'Circle', line: 'PolyLine', arrow: 'PolyLine', cross: 'Ink', ink: 'Ink' });
});

test('矩形は線幅の半分だけ内側に re S を書く', () => {
  const appearance = shapeAppearanceOf(square());
  assert.equal(appearance.content, '/GS gs\n0.851 0.173 0.173 RG\n2 w 101 601 198 98 re S');
  assert.deepEqual(appearance.bbox, [100, 600, 300, 700]);
  assert.equal(appearance.subtype, 'Square');
  assert.equal(appearance.lineWidth, 2);
  assert.equal(appearance.opacity, 1);
  assert.deepEqual(appearance.rgb.map((v) => Math.round(v * 100) / 100), [0.85, 0.17, 0.17]);
  assert.equal('vertices' in appearance, false);
  assert.equal('inkList' in appearance, false);
});

test('楕円はベジェ 4 本で、線幅の半分だけ内側に描く', () => {
  const appearance = shapeAppearanceOf(square({ kind: 'circle', rect: [330, 650, 500, 780], lineWidth: 3 }));
  assert.equal(appearance.subtype, 'Circle');
  assert.equal(appearance.content, [
    '/GS gs', '0.851 0.173 0.173 RG', '3 w',
    '498.5 715 m',
    '498.5 750.07 461.12 778.5 415 778.5 c',
    '368.88 778.5 331.5 750.07 331.5 715 c',
    '331.5 679.93 368.88 651.5 415 651.5 c',
    '461.12 651.5 498.5 679.93 498.5 715 c',
    'h S',
  ].join('\n'));
});

// 線が箱より太いと何も描かれなかった（事前調査 D）。描く線幅を短い辺の半分で頭打ちにし、線で箱をすべて覆う。
// /BS /W には選んだ太さを書く（spec-4b-1b 確定事項30）。
test('線が箱より太いときは、描く線幅を短い辺の半分で頭打ちにして箱を覆う', () => {
  const appearance = shapeAppearanceOf(square({ rect: [100, 600, 101, 601], lineWidth: 8 }));
  assert.equal(appearance.content, '/GS gs\n0.851 0.173 0.173 RG\n0.5 w 100.25 600.25 0.5 0.5 re S');
  assert.equal(appearance.lineWidth, 8);
  assert.match(shapeAppearanceOf(square({ kind: 'circle', rect: [100, 600, 101, 601], lineWidth: 8 })).content, /^\/GS gs\n0\.851 0\.173 0\.173 RG\n0\.5 w\n100\.75 600\.5 m\n/);
  assert.equal(shapeAppearanceOf(square({ rect: [60, 300, 90, 330], lineWidth: 40 })).content, '/GS gs\n0.851 0.173 0.173 RG\n15 w 67.5 307.5 15 15 re S');
});

test('直線は丸い端の m l S で、/Vertices と /LE を返す', () => {
  const appearance = shapeAppearanceOf(line());
  assert.equal(appearance.content, '/GS gs\n0.173 0.361 0.851 RG\n3 w 1 J 100 600 m 300 550 l S');
  assert.equal(appearance.subtype, 'PolyLine');
  assert.deepEqual(appearance.vertices, [100, 600, 300, 550]);
  assert.deepEqual(appearance.lineEndings, ['None', 'None']);
  assert.deepEqual(appearance.bbox, [98.5, 548.5, 301.5, 601.5]);
});

test('矢印は直線のあとに翼 2 本を丸い角で描き、/LE は終点だけ OpenArrow', () => {
  const appearance = shapeAppearanceOf(line({ kind: 'arrow', head: 'open', rect: [98.5, 543.55, 301.5, 601.5] }));
  const [left, right] = arrowHead([100, 600], [300, 550], 3);
  assert.equal(appearance.content, [
    '/GS gs', '0.173 0.361 0.851 RG', '3 w 1 J 1 j',
    '100 600 m 300 550 l S',
    `${left.map((v) => String(Math.round(v * 100) / 100)).join(' ')} m 300 550 l ${right.map((v) => String(Math.round(v * 100) / 100)).join(' ')} l S`,
  ].join('\n'));
  assert.deepEqual(appearance.vertices, [100, 600, 300, 550]);
  assert.deepEqual(appearance.lineEndings, ['None', 'OpenArrow']);
});

test('ペンは path ごとに m l … S で、/InkList は平たい数の並び', () => {
  const appearance = shapeAppearanceOf(ink({ paths: [[[100, 500], [120, 480], [150, 510]], [[90, 505], [95.5, 506.25]]] }));
  assert.equal(appearance.content, [
    '/GS gs', '0.184 0.62 0.353 RG', '2 w 1 J 1 j',
    '100 500 m 120 480 l 150 510 l S',
    '90 505 m 95.5 506.25 l S',
  ].join('\n'));
  assert.equal(appearance.subtype, 'Ink');
  assert.deepEqual(appearance.inkList, [[100, 500, 120, 480, 150, 510], [90, 505, 95.5, 506.25]]);
  assert.equal('vertices' in appearance, false);
});

test('不透明度は 0〜1 に丸め、無ければ 1。座標は小数 2 桁', () => {
  assert.equal(shapeAppearanceOf(square({ opacity: 2 })).opacity, 1);
  assert.equal(shapeAppearanceOf(square({ opacity: 0.5 })).opacity, 0.5);
  assert.equal(shapeAppearanceOf(square({ opacity: undefined })).opacity, 1);
  const appearance = shapeAppearanceOf(line({ paths: [[[100.004, 600.006], [300.126, 550]]], rect: [98.499, 548.5, 301.626, 601.506] }));
  assert.deepEqual(appearance.vertices, [100, 600.01, 300.13, 550]);
  assert.deepEqual(appearance.bbox, [98.5, 548.5, 301.63, 601.51]);
});

test('isShapeEntry は形だけを見る', () => {
  assert.equal(isShapeEntry(square()), true);
  assert.equal(isShapeEntry(line()), true);
  assert.equal(isShapeEntry(ink()), true);
  assert.equal(isShapeEntry(square({ kind: 'text' })), false);
  assert.equal(isShapeEntry(square({ kind: 'highlight' })), false);
  assert.equal(isShapeEntry(square({ lineWidth: 0 })), false);
  assert.equal(isShapeEntry(square({ color: 'red' })), false);
  assert.equal(isShapeEntry(square({ rect: [1, 2, 3] })), false);
  assert.equal(isShapeEntry(line({ paths: undefined })), false);
  assert.equal(isShapeEntry(line({ paths: [[[100, 600]]] })), false);
  assert.equal(isShapeEntry(line({ paths: [[[100, 600], [300, 550], [1, 1]]] })), false);
  assert.equal(isShapeEntry(line({ paths: [[[100, 600], [300, 550]], [[0, 0], [1, 1]]] })), false);
  assert.equal(isShapeEntry(ink({ paths: [] })), false);
  assert.equal(isShapeEntry(ink({ paths: [[[100, 500], [120, NaN]]] })), false);
  assert.equal(isShapeEntry(ink({ paths: [[[1, 2], [3, 4]], [[5, 6], [7, 8], [9, 10]]] })), true);
  assert.equal(isShapeEntry(null), false);
});

test('形が違えば null', () => {
  assert.equal(shapeAppearanceOf(square({ kind: 'stamp' })), null);
  assert.equal(shapeAppearanceOf(line({ paths: [] })), null);
  assert.equal(shapeAppearanceOf(square({ color: '#12345' })), null);
});

// ---- 塗り・線なし・線種・透明グループ（spec-4b-1b 確定事項29〜35） ----

test('塗りは線と同じ path を B で塗り、/IC に渡す色を返す', () => {
  const appearance = shapeAppearanceOf(square({ fill: '#ffd966' }));
  assert.equal(appearance.content, '/GS gs\n0.851 0.173 0.173 RG\n1 0.851 0.4 rg\n2 w 101 601 198 98 re B');
  assert.deepEqual(appearance.fillRgb.map((v) => Math.round(v * 1000) / 1000), [1, 0.851, 0.4]);
  assert.match(shapeAppearanceOf(square({ kind: 'circle', fill: '#ffd966' })).content, /1 0\.851 0\.4 rg\n2 w\n[\s\S]*c\nh B$/);
  assert.equal(shapeAppearanceOf(square()).fillRgb, null);
});

// 線なしは箱そのものを f で塗る。/C を書かないよう rgb は null（確定事項29・34）。
test('線なしは箱そのものを塗り、線の色は null', () => {
  const appearance = shapeAppearanceOf(square({ color: null, fill: '#a9ce91' }));
  assert.equal(appearance.content, '/GS gs\n0.663 0.808 0.569 rg\n100 600 200 100 re f');
  assert.equal(appearance.rgb, null);
  assert.equal(appearance.lineWidth, 2, '線を戻したときの太さは持つ');
  assert.match(shapeAppearanceOf(square({ kind: 'circle', color: null, fill: '#a9ce91' })).content, /rg\n300 650 m\n[\s\S]*c\nh f$/);
  assert.equal(shapeAppearanceOf(square({ color: null })), null, '線も塗りも無いものは書かない');
});

// 破線の間隔は線の太さの 3:2 倍（読み込んだ間隔はその倍数）。端は切りっぱなし、矢じりは実線（確定事項32）。
test('破線は線の太さの倍数の間隔を d で書き、矢印の矢じりは実線で描く', () => {
  const dashed = shapeAppearanceOf(square({ lineStyle: 'dashed' }));
  assert.equal(dashed.content, '/GS gs\n0.851 0.173 0.173 RG\n2 w [6 4] 0 d 101 601 198 98 re S');
  assert.deepEqual(dashed.dash, [6, 4]);
  assert.deepEqual(shapeAppearanceOf(square({ lineStyle: 'dashed', dash: [4, 2], lineWidth: 1.5 })).dash, [6, 3]);
  assert.equal(shapeAppearanceOf(line({ lineStyle: 'dashed' })).content, '/GS gs\n0.173 0.361 0.851 RG\n3 w [9 6] 0 d 100 600 m 300 550 l S');
  const arrowAppearance = shapeAppearanceOf(line({ kind: 'arrow', head: 'open', lineStyle: 'dashed' }));
  const lines = arrowAppearance.content.split('\n');
  assert.deepEqual(lines.slice(0, 5), [
    '/GS gs', '0.173 0.361 0.851 RG', '3 w [9 6] 0 d', '100 600 m 300 550 l S', '[] 0 d 1 J 1 j',
  ]);
  assert.match(lines[5], / m 300 550 l [\d.]+ [\d.]+ l S$/);
  assert.equal(shapeAppearanceOf(square()).dash, null);
});

// 雲形は雲の path を描き、/BE の強さと /RD の余白（4 つとも同じ値）を返す（確定事項33）。
test('雲形は雲の path に線を引き、強さと /RD の余白を返す', () => {
  const { cloudPathOf } = require('../worker/cloud-appearance.js');
  const cloud = cloudPathOf({ kind: 'square', box: [100, 600, 300, 700], intensity: 1, lineWidth: 2 });
  const appearance = shapeAppearanceOf(square({ lineStyle: 'cloudy' }));
  assert.equal(appearance.content, `/GS gs\n0.851 0.173 0.173 RG\n2 w 1 j\n${cloud.ops}\nS`);
  assert.equal(appearance.cloudIntensity, 1);
  assert.deepEqual(appearance.rectDifference, [6, 6, 6, 6]);
  assert.deepEqual(appearance.bbox, [100, 600, 300, 700], '外観の箱と /Rect は箱そのもの');
  const strong = shapeAppearanceOf(square({ lineStyle: 'cloudy', cloudIntensity: 2, fill: '#ffd966' }));
  assert.equal(strong.cloudIntensity, 2);
  assert.match(strong.content, /rg\n2 w 1 j\n[\s\S]*\nh\nB$/);
  const filledOnly = shapeAppearanceOf(square({ lineStyle: 'cloudy', color: null, fill: '#ffd966' }));
  assert.match(filledOnly.content, /^\/GS gs\n1 0\.851 0\.4 rg\n1 j\n[\d.]+ [\d.]+ m\n[\s\S]*\nh\nf$/);
  // 描けないほど小さな箱の雲形は、普通の四角で描いて /BE だけを書く。
  const tiny = shapeAppearanceOf(square({ lineStyle: 'cloudy', rect: [100, 600, 200, 605] }));
  assert.equal(tiny.content, '/GS gs\n0.851 0.173 0.173 RG\n2 w 101 601 98 3 re S');
  assert.equal(tiny.cloudIntensity, 1);
  assert.equal(tiny.rectDifference, undefined);
});

// 不透明度が 1 未満なら透明グループで包む（外側の /GS gs は op-annotate.js が書く。確定事項31）。
test('不透明度が 1 未満なら group を立て、中身に /GS gs を書かない', () => {
  const half = shapeAppearanceOf(square({ opacity: 0.5, fill: '#ffd966' }));
  assert.equal(half.group, true);
  assert.equal(half.content, '0.851 0.173 0.173 RG\n1 0.851 0.4 rg\n2 w 101 601 198 98 re B');
  assert.equal(shapeAppearanceOf(square()).group, false);
  assert.equal(shapeAppearanceOf(ink({ opacity: 0.25 })).group, true);
});

test('isShapeEntry は見た目の欄の決まりも見る', () => {
  assert.equal(isShapeEntry(square({ color: null, fill: '#ffd966' })), true);
  assert.equal(isShapeEntry(square({ color: null })), false);
  assert.equal(isShapeEntry(square({ fill: 'yellow' })), false);
  assert.equal(isShapeEntry(line({ fill: '#ffd966' })), false);
  assert.equal(isShapeEntry(line({ color: null })), false);
  assert.equal(isShapeEntry(line({ lineStyle: 'cloudy' })), false);
  assert.equal(isShapeEntry(ink({ lineStyle: 'dashed' })), false);
  assert.equal(isShapeEntry(square({ lineStyle: 'solid', dash: [3, 2] })), false);
  assert.equal(isShapeEntry(square({ lineStyle: 'dashed', dash: [0, 0] })), false);
  assert.equal(isShapeEntry(square({ lineStyle: 'cloudy', cloudIntensity: 3 })), false);
});

// 見た目の欄の決まりは renderer/shape-style.js と同じ（プロセスが違うので読み込み合わない）。
test('見た目の欄の決まりは画面（shape-style.js）と同じ', () => {
  require('../renderer/shape-style.js');
  const screen = globalThis.SigK.shapeStyle;
  const rules = require('../worker/shape-style-rules.js');
  assert.deepEqual(rules.DEFAULT_DASH, screen.DEFAULT_DASH);
  assert.equal(rules.DEFAULT_CLOUD_INTENSITY, screen.DEFAULT_CLOUD_INTENSITY);
  assert.deepEqual(rules.LINE_STYLES, screen.LINE_STYLES);
  const cases = [
    square(), square({ color: null, fill: '#ffd966' }), square({ color: null }), square({ fill: '#FFD966' }), square({ fill: 'x' }),
    square({ lineStyle: 'cloudy', cloudIntensity: 2 }), square({ lineStyle: 'cloudy', cloudIntensity: 2.5 }), square({ lineStyle: 'wavy' }),
    square({ lineStyle: 'dashed', dash: [4, 2] }), square({ lineStyle: 'dashed', dash: [] }), square({ lineStyle: 'solid', dash: [4, 2] }),
    line(), line({ lineStyle: 'dashed' }), line({ lineStyle: 'cloudy' }), line({ fill: '#ffd966' }), line({ color: null }),
    ink(), ink({ lineStyle: 'dashed' }), ink({ lineStyle: 'solid' }),
  ];
  for (const entry of cases)
    assert.equal(rules.styleOf(entry) !== null, screen.validStyle(entry), JSON.stringify(entry));
  for (const kind of ['square', 'circle', 'line', 'arrow', 'ink'])
    assert.deepEqual(rules.lineStylesOf(kind), [...screen.lineStylesOf(kind)], kind);
});

// 四角・丸の輪郭は画面（shape-outline.js）と同じ点（破線の切れ目の位置がそろう。確定事項41）。
test('四角・丸の輪郭は画面の点列と同じ始点・同じ向き', () => {
  require('../renderer/shape-outline.js');
  const outline = globalThis.SigK.shapeOutline;
  const fmt = (value) => String(Math.round(value * 100) / 100);
  for (const [rect, lineWidth] of [[[100, 600, 300, 700], 2], [[10.5, 20.25, 70.75, 40], 3], [[60, 300, 90, 330], 40]]) {
    const width = outline.drawWidthOf(rect, lineWidth);
    const squareOps = shapeAppearanceOf(square({ rect, lineWidth, lineStyle: 'dashed' })).content.split('\n').at(-1);
    const rectPoints = outline.rectOutline(rect, width).slice(0, 4).map((segment) => segment.points[0]);
    const [x, y] = rectPoints[0];
    const expected = `${fmt(x)} ${fmt(y)} ${fmt(rectPoints[1][0] - x)} ${fmt(rectPoints[2][1] - y)} re S`;
    assert.ok(squareOps.endsWith(expected), `${squareOps} / ${expected}`);
    const circleLines = shapeAppearanceOf(square({ kind: 'circle', rect, lineWidth })).content.split('\n');
    const bezier = outline.ellipseOutline(rect, width).slice(0, 5)
      .map((segment, index) => `${segment.points.flat().map(fmt).join(' ')} ${index === 0 ? 'm' : 'c'}`);
    assert.deepEqual(circleLines.slice(3, 8), bezier);
  }
});

// ---- 回した四角・丸（spec-4b-2 確定事項1・29・30） ----

test('isShapeEntry は四角・丸の角度だけを 0 以上 360 未満で受ける', () => {
  assert.equal(isShapeEntry(square({ angle: 30 })), true);
  assert.equal(isShapeEntry(square({ kind: 'circle', angle: 359.5 })), true);
  assert.equal(isShapeEntry(square({ angle: 360 })), false);
  assert.equal(isShapeEntry(square({ angle: -5 })), false);
  assert.equal(isShapeEntry(square({ angle: '30' })), false);
  assert.equal(isShapeEntry(line({ angle: 30 })), false);
  assert.equal(isShapeEntry(ink({ angle: 30 })), false);
});

test('shapeAppearanceOf は回した四角・丸に /Matrix と外接の /Rect を付け、bbox と中身は回す前のまま', () => {
  const { matrixOf, rectOf } = require('../worker/shape-rotation.js');
  const plain = shapeAppearanceOf(square());
  const turned = shapeAppearanceOf(square({ angle: 30 }));
  assert.equal(plain.matrix, undefined);
  assert.equal(plain.rect, undefined);
  assert.deepEqual(turned.bbox, [100, 600, 300, 700]);
  assert.equal(turned.content, plain.content);
  assert.deepEqual(turned.matrix, matrixOf([100, 600, 300, 700], 30));
  assert.deepEqual(turned.rect, rectOf([100, 600, 300, 700], 30));
  assert.equal(shapeAppearanceOf(square({ angle: 0 })).matrix, undefined);
});

test('shapeAppearanceOf は回した雲形に /RD の余白を付けない（/BE の強さは付ける）', () => {
  const flat = shapeAppearanceOf(square({ lineStyle: 'cloudy' }));
  const turned = shapeAppearanceOf(square({ lineStyle: 'cloudy', angle: 20 }));
  assert.ok(Array.isArray(flat.rectDifference));
  assert.equal(turned.rectDifference, undefined);
  assert.equal(turned.cloudIntensity, 1);
});

// ---- 塗った三角の矢印（spec-4b-5a 確定事項4・7・34） ----

test('新しい矢印（head が無い）は軸を三角の底で止めて三角を f で塗り、/LE は ClosedArrow、/IC に線の色を返す', () => {
  const { closedHead } = require('../worker/arrow-head.js');
  const appearance = shapeAppearanceOf(line({ kind: 'arrow' }));
  const { left, right, base } = closedHead([100, 600], [300, 550], 3);
  const r = (v) => String(Math.round(v * 100) / 100);
  const lines = appearance.content.split('\n');
  assert.equal(lines[0], '/GS gs');
  assert.equal(lines[1], '0.173 0.361 0.851 RG');
  assert.equal(lines[2], `3 w 1 J 100 600 m ${r(base[0])} ${r(base[1])} l S`);
  assert.equal(lines[3], '0.173 0.361 0.851 rg');
  assert.equal(lines[4], `${r(left[0])} ${r(left[1])} m 300 550 l ${r(right[0])} ${r(right[1])} l h f`);
  assert.deepEqual(appearance.lineEndings, ['None', 'ClosedArrow']);
  assert.deepEqual(appearance.fillRgb, appearance.rgb);
});

test('破線の塗った三角は軸だけ破線で、三角は塗る', () => {
  const appearance = shapeAppearanceOf(line({ kind: 'arrow', lineStyle: 'dashed' }));
  const lines = appearance.content.split('\n');
  assert.match(lines[2], /^3 w \[9 6\] 0 d 100 600 m [\d.]+ [\d.]+ l S$/);
  assert.match(lines[4], / h f$/);
});

test('isShapeEntry は矢印の先の欄を、矢印の open だけ受ける', () => {
  assert.equal(isShapeEntry(line({ kind: 'arrow', head: 'open' })), true);
  assert.equal(isShapeEntry(line({ kind: 'arrow', head: 'closed' })), false);
  assert.equal(isShapeEntry(line({ head: 'open' })), false);
  assert.equal(shapeAppearanceOf(line({ kind: 'arrow', head: 'open' })).fillRgb, null);
});

// ---- ×印（spec-4b-5a 確定事項35） ----

test('×印は Ink で、対角線 2 本を引き、/InkList は小数 4 桁。破線は間隔を書く', () => {
  const crossEntry = { src: 0, kind: 'cross', color: RED, opacity: 1, rect: [99, 599, 161, 641], lineWidth: 2, paths: [[[100, 640], [160.12345, 600]], [[160.12345, 640], [100, 600]]] };
  assert.equal(SUBTYPES.cross, 'Ink');
  const appearance = shapeAppearanceOf(crossEntry);
  assert.equal(appearance.subtype, 'Ink');
  assert.deepEqual(appearance.inkList, [[100, 640, 160.1235, 600], [160.1235, 640, 100, 600]]);
  assert.match(appearance.content, /^\/GS gs\n0\.851 0\.173 0\.173 RG\n2 w 1 J 1 j\n100 640 m [\d.]+ 600 l S\n[\d.]+ 640 m 100 600 l S$/);
  assert.match(shapeAppearanceOf({ ...crossEntry, lineStyle: 'dashed' }).content, /\n2 w \[6 4\] 0 d\n/);
  assert.equal(appearance.matrix, undefined);
  assert.equal(isShapeEntry({ ...crossEntry, paths: crossEntry.paths.slice(0, 1) }), false);
  assert.equal(isShapeEntry({ ...crossEntry, fill: '#ffffff' }), false);
  assert.equal(isShapeEntry({ ...crossEntry, angle: 30 }), false, '角度は対角線に入れて渡す');
});
