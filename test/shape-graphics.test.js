'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

require('../renderer/free-text-geometry.js');
require('../renderer/arrow-head.js');
require('../renderer/shape-geometry.js');
require('../renderer/cross-geometry.js');
require('../renderer/polygon-geometry.js');
require('../renderer/shape-style.js');
require('../renderer/shape-outline.js');
require('../renderer/cloud-geometry.js');
require('../renderer/shape-figure.js');
require('../renderer/shape-rotation.js');
require('../renderer/shape-print-layer.js');
require('../renderer/shape-graphics.js');

// 画面の図形・ペン（spec-4-3 確定事項8・11・25、spec-4b-1b 確定事項29〜33・40〜42）。SVG の要素と、印刷用の canvas 2D の描き手。
// 部品の幾何は shape-figure.test.js で見る。

const graphics = globalThis.SigK.shapeGraphics;
const geo = globalThis.SigK.shapeGeometry;

function makeDoc() {
  return new JSDOM('<!doctype html><div class="pdf-page"></div>').window.document;
}

// 回転 0・倍率 scale の viewport（A4）。回転 90 は pdf.js と同じ変換。
function viewport({ scale = 1, rotation = 0 } = {}) {
  const [w, h] = [595.28, 841.89];
  if (rotation === 90) {
    return {
      width: h * scale, height: w * scale, scale, rotation,
      convertToViewportPoint: (x, y) => [y * scale, x * scale],
    };
  }
  return {
    width: w * scale, height: h * scale, scale, rotation,
    convertToViewportPoint: (x, y) => [x * scale, (h - y) * scale],
  };
}

const SQUARE = { id: 'sigk-1', src: 0, kind: 'square', color: '#d92c2c', opacity: 1, lineWidth: 2, rect: [100, 600, 300, 700], quads: [[100, 700, 300, 700, 100, 600, 300, 600]] };
const CIRCLE = { ...SQUARE, id: 'sigk-2', kind: 'circle' };
const LINE = { id: 'sigk-3', src: 0, kind: 'line', color: '#2c5cd9', opacity: 1, lineWidth: 3, rect: [98.5, 548.5, 301.5, 601.5], quads: [[98.5, 601.5, 301.5, 601.5, 98.5, 548.5, 301.5, 548.5]], paths: [[[100, 600], [300, 550]]] };
const ARROW = { ...LINE, id: 'sigk-4', kind: 'arrow', head: 'open' };
const INK = { id: 'sigk-5', src: 0, kind: 'ink', color: '#2f9e5a', opacity: 1, lineWidth: 2, rect: [89, 479, 151, 511], quads: [[89, 511, 151, 511, 89, 479, 151, 479]], paths: [[[100, 500], [120, 480], [150, 510]], [[90, 505], [95, 506]]] };

function num(value) {
  return Math.round(value * 100) / 100;
}

// 呼ばれた口と代入を calls に残す ctx。fixed の名前（canvas など）はその値を返す。
function recordingContext(calls, fixed = {}) {
  return new Proxy({}, {
    get: (_target, name) => (name in fixed ? fixed[name] : (...args) => { calls.push([name, ...args]); }),
    set: (_target, name, value) => { calls.push(['set', name, value]); return true; },
  });
}

test('svgOf は矩形を線幅の半分だけ内側の <rect> にし、線の属性は <g> に付ける', () => {
  const g = graphics.svgOf(makeDoc(), SQUARE, viewport({ scale: 2 }));
  assert.equal(g.tagName.toLowerCase(), 'g');
  assert.equal(g.getAttribute('class'), 'shape square');
  assert.equal(g.getAttribute('stroke'), '#d92c2c');
  assert.equal(g.getAttribute('stroke-width'), '4');
  assert.equal(g.getAttribute('fill'), 'none');
  assert.equal(g.getAttribute('stroke-linecap'), 'butt');
  assert.equal(g.getAttribute('stroke-linejoin'), 'miter');
  const rect = g.querySelector('rect');
  assert.deepEqual(['x', 'y', 'width', 'height'].map((name) => rect.getAttribute(name)), ['202', '285.78', '396', '196']);
  assert.equal(g.children.length, 1);
});

test('svgOf は楕円を中心と半径の <ellipse> にする（回転した紙でも軸に沿う）', () => {
  const ellipse = graphics.svgOf(makeDoc(), CIRCLE, viewport({ scale: 2 })).querySelector('ellipse');
  assert.deepEqual(['cx', 'cy', 'rx', 'ry'].map((name) => ellipse.getAttribute(name)), ['400', '383.78', '198', '98']);
  const rotated = graphics.svgOf(makeDoc(), CIRCLE, viewport({ rotation: 90 })).querySelector('ellipse');
  assert.deepEqual(['cx', 'cy', 'rx', 'ry'].map((name) => rotated.getAttribute(name)), ['650', '200', '49', '99']);
});

test('svgOf は直線を丸い端の <line> にする', () => {
  const g = graphics.svgOf(makeDoc(), LINE, viewport());
  assert.equal(g.getAttribute('class'), 'shape line');
  assert.equal(g.getAttribute('stroke-linecap'), 'round');
  assert.equal(g.getAttribute('stroke-linejoin'), 'round');
  assert.equal(g.getAttribute('stroke-width'), '3');
  const line = g.querySelector('line');
  assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map((name) => line.getAttribute(name)), ['100', '241.89', '300', '291.89']);
  assert.equal(g.children.length, 1);
});

test('svgOf は矢印に翼の <polyline> を足す（翼は紙の座標で計算してから表示へ直す）', () => {
  const g = graphics.svgOf(makeDoc(), ARROW, viewport({ scale: 2 }));
  assert.equal(g.getAttribute('class'), 'shape arrow');
  assert.equal(g.children.length, 2);
  const [left, right] = geo.arrowHead([100, 600], [300, 550], 3);
  const vp = viewport({ scale: 2 });
  const expected = [left, [300, 550], right].map((p) => vp.convertToViewportPoint(p[0], p[1]).map(num).join(',')).join(' ');
  assert.equal(g.querySelector('polyline').getAttribute('points'), expected);
  assert.equal(g.querySelector('polyline').getAttribute('fill'), 'none');
});

test('svgOf はペンを path ごとの <polyline> にする', () => {
  const g = graphics.svgOf(makeDoc(), INK, viewport());
  assert.equal(g.getAttribute('class'), 'shape ink');
  const polylines = [...g.querySelectorAll('polyline')];
  assert.equal(polylines.length, 2);
  assert.equal(polylines[0].getAttribute('points'), '100,341.89 120,361.89 150,331.89');
  assert.equal(polylines[1].getAttribute('points'), '90,336.89 95,335.89');
});

test('paint は canvas 2D に同じ絵を描く', () => {
  const calls = [];
  const ctx = recordingContext(calls);
  assert.equal(graphics.paint(ctx, SQUARE, viewport({ scale: 2 })), 1);
  assert.deepEqual(calls[0], ['save']);
  assert.deepEqual(calls.at(-1), ['restore']);
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'strokeStyle' && value === '#d92c2c'));
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'lineWidth' && value === 4));
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'lineCap' && value === 'butt'));
  assert.deepEqual(calls.find(([name]) => name === 'strokeRect'), ['strokeRect', 202, 285.78, 396, 196]);

  calls.length = 0;
  graphics.paint(ctx, CIRCLE, viewport({ scale: 2 }));
  const ellipse = calls.find(([name]) => name === 'ellipse');
  assert.deepEqual(ellipse.slice(1, 5).map(num), [400, 383.78, 198, 98]);
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 1);

  calls.length = 0;
  graphics.paint(ctx, ARROW, viewport());
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'lineCap' && value === 'round'));
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'lineJoin' && value === 'round'));
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 2);
  assert.equal(calls.filter(([name]) => name === 'moveTo').length, 2);
  assert.deepEqual(calls.find(([name]) => name === 'moveTo').slice(1).map(num), [100, 241.89]);

  calls.length = 0;
  graphics.paint(ctx, INK, viewport());
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 2);
  assert.equal(calls.filter(([name]) => name === 'lineTo').length, 3);

  calls.length = 0;
  graphics.paint(ctx, { ...LINE, opacity: 0.5 }, viewport());
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'globalAlpha' && value === 0.5));
});

// ---- 塗り・線なし・線幅の頭打ち・破線・雲形（spec-4b-1b 確定事項29〜33・41） ----

test('svgOf は塗りを <g> の fill に、線なしを stroke="none" にし、線なしは箱そのものを塗る', () => {
  const filled = graphics.svgOf(makeDoc(), { ...SQUARE, fill: '#ffff00' }, viewport({ scale: 2 }));
  assert.deepEqual([filled.getAttribute('stroke'), filled.getAttribute('fill')], ['#d92c2c', '#ffff00']);
  const noStroke = graphics.svgOf(makeDoc(), { ...CIRCLE, color: null, fill: '#ffff00' }, viewport({ scale: 2 }));
  assert.deepEqual([noStroke.getAttribute('stroke'), noStroke.getAttribute('fill')], ['none', '#ffff00']);
  const ellipse = noStroke.querySelector('ellipse');
  assert.deepEqual(['cx', 'cy', 'rx', 'ry'].map((name) => ellipse.getAttribute(name)), ['400', '383.78', '200', '100']);
});

test('svgOf は太い線の四角の線幅を短い辺の半分で頭打ちにする（確定事項30）', () => {
  const g = graphics.svgOf(makeDoc(), { ...SQUARE, lineWidth: 40, rect: [100, 600, 130, 620] }, viewport());
  assert.equal(g.getAttribute('stroke-width'), '10');
  const rect = g.querySelector('rect');
  assert.deepEqual(['x', 'y', 'width', 'height'].map((name) => rect.getAttribute(name)), ['105', '226.89', '20', '10']);
});

test('svgOf は破線の四角を保存と同じ点列の <path> にし、間隔と切りっぱなしの端を付ける（確定事項41）', () => {
  const g = graphics.svgOf(makeDoc(), { ...SQUARE, lineStyle: 'dashed' }, viewport({ scale: 2 }));
  assert.equal(g.children.length, 1);
  const path = g.querySelector('path');
  assert.equal(path.getAttribute('d'), 'M202,481.78 L598,481.78 L598,285.78 L202,285.78 Z');
  assert.equal(path.getAttribute('stroke-dasharray'), '12 8');
  assert.equal(path.getAttribute('stroke-linecap'), 'butt');
});

test('svgOf は雲形を丸い角の <path> にし、破線の矢印は軸だけ破線で矢じりは実線にする', () => {
  const cloud = graphics.svgOf(makeDoc(), { ...SQUARE, rect: [60, 600, 260, 760], lineStyle: 'cloudy', cloudIntensity: 2 }, viewport());
  assert.equal(cloud.getAttribute('stroke-linejoin'), 'round');
  const d = cloud.querySelector('path').getAttribute('d');
  assert.match(d, /^M[\d.]+,[\d.]+ C/);
  assert.equal(d.endsWith(' Z'), true);
  assert.equal(cloud.querySelector('path').hasAttribute('stroke-dasharray'), false);

  const arrow = graphics.svgOf(makeDoc(), { ...ARROW, lineStyle: 'dashed' }, viewport());
  assert.equal(arrow.getAttribute('stroke-linecap'), 'round');
  const axis = arrow.querySelector('path');
  assert.equal(axis.getAttribute('d'), 'M100,241.89 L300,291.89');
  assert.equal(axis.getAttribute('stroke-dasharray'), '9 6');
  assert.equal(axis.getAttribute('stroke-linecap'), 'butt');
  const head = arrow.querySelector('polyline');
  assert.equal(head.hasAttribute('stroke-dasharray'), false);
  assert.equal(head.hasAttribute('stroke-linecap'), false);
});

test('paint は塗りを先に、線をあとに描き、線なしは線を引かない', () => {
  const calls = [];
  graphics.paint(recordingContext(calls), { ...SQUARE, fill: '#ffff00' }, viewport({ scale: 2 }));
  const names = calls.map(([name]) => name);
  assert.ok(names.includes('fillRect') && names.indexOf('fillRect') < names.indexOf('strokeRect'));
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'fillStyle' && value === '#ffff00'));

  calls.length = 0;
  graphics.paint(recordingContext(calls), { ...CIRCLE, color: null, fill: '#ffff00' }, viewport({ scale: 2 }));
  assert.equal(calls.filter(([name]) => name === 'fill').length, 1);
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 0);
  assert.equal(calls.some(([name, key]) => name === 'set' && key === 'strokeStyle'), false);
});

test('paint は破線に間隔を当てて矢じりでは外し、雲形は同じ点列を bezierCurveTo で引く', () => {
  const calls = [];
  graphics.paint(recordingContext(calls), { ...ARROW, lineStyle: 'dashed' }, viewport());
  assert.deepEqual(calls.filter(([name]) => name === 'setLineDash').map(([, dash]) => dash), [[9, 6], []]);
  assert.deepEqual(calls.filter(([name, key]) => name === 'set' && key === 'lineCap').map(([, , value]) => value), ['butt', 'round']);
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 2);

  calls.length = 0;
  const entry = { ...SQUARE, rect: [60, 600, 260, 760], lineStyle: 'cloudy', cloudIntensity: 2 };
  graphics.paint(recordingContext(calls), entry, viewport());
  const cloud = globalThis.SigK.cloudGeometry.cloudOf({ kind: 'square', box: entry.rect, intensity: 2, lineWidth: 2 });
  assert.equal(calls.filter(([name]) => name === 'bezierCurveTo').length, cloud.segments.filter((segment) => segment.op === 'C').length);
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'lineJoin' && value === 'round'));
  assert.equal(calls.filter(([name]) => name === 'closePath').length, 1);
});

// 不透明度が 1 未満なら、図形の外接だけの別の canvas に不透明で描いてから alpha で重ねる（確定事項40。塗りと線が重なっても
// 濃くならない）。
test('paint は半透明の図形を別の canvas に描いてから重ね、ページの外に出る分は切る', () => {
  const calls = [];
  const layerCalls = [];
  const made = [];
  const doc = {
    createElement: (tag) => {
      const canvas = { tag, width: 0, height: 0, getContext: () => { made.push([canvas.width, canvas.height]); return recordingContext(layerCalls); } };
      return canvas;
    },
  };
  const page = { width: 1191, height: 1684, ownerDocument: doc };
  graphics.paint(recordingContext(calls, { canvas: page }), { ...SQUARE, fill: '#ffff00', opacity: 0.5 }, viewport({ scale: 2 }));
  // 外接は rect 202〜598 × 285.78〜481.78 に、線幅 4 と余白 2 を足したもの。
  assert.deepEqual(made, [[408, 209]]);
  assert.deepEqual(layerCalls[0], ['translate', -196, -279]);
  assert.ok(layerCalls.some(([name]) => name === 'fillRect'));
  assert.ok(layerCalls.some(([name]) => name === 'strokeRect'));
  assert.equal(layerCalls.some(([name, key]) => name === 'set' && key === 'globalAlpha'), false, '別の canvas には不透明で描く');
  assert.deepEqual(calls.map(([name, ...rest]) => (name === 'drawImage' ? [name, rest[1], rest[2]] : [name, ...rest])), [
    ['save'], ['set', 'globalAlpha', 0.5], ['drawImage', 196, 279], ['restore'],
  ]);
  const image = calls.find(([name]) => name === 'drawImage')[1];
  assert.deepEqual([image.width, image.height], [0, 0], '描いたら手放す');

  // 不透明なら別の canvas を作らない。ページの外の図形は作らずに（描く所が無い）そのまま描く。
  calls.length = 0;
  graphics.paint(recordingContext(calls, { canvas: page }), { ...SQUARE, fill: '#ffff00' }, viewport({ scale: 2 }));
  graphics.paint(recordingContext(calls, { canvas: page }), { ...SQUARE, rect: [700, 600, 800, 700], opacity: 0.5 }, viewport({ scale: 2 }));
  assert.equal(made.length, 1);
  assert.equal(calls.filter(([name]) => name === 'strokeRect').length, 2);
});

// ---- 回した四角・丸（spec-4b-2 確定事項6・7） ----

test('svgOf は回した四角・丸の <g> を、表示の座標で箱の中心まわりに回す（回していなければ付けない）', () => {
  const doc = makeDoc();
  assert.equal(graphics.svgOf(doc, SQUARE, viewport({ scale: 2 })).getAttribute('transform'), null);
  // 箱 [100 600 300 700] の中心 (200, 650) は、倍率 2 の表示で (400, 383.78)
  const g = graphics.svgOf(doc, { ...SQUARE, angle: 30 }, viewport({ scale: 2 }));
  assert.equal(g.getAttribute('transform'), 'rotate(30 400 383.78)');
  // 部品は回す前のまま（<rect> は軸に沿う）
  assert.deepEqual(['x', 'y', 'width', 'height'].map((name) => Number(g.querySelector('rect').getAttribute(name))), [202, 285.78, 396, 196]);
  // 回した紙でも、中心を表示の座標へ直して同じ角度で回す
  const turned = graphics.svgOf(doc, { ...CIRCLE, angle: 45 }, viewport({ rotation: 90 }));
  assert.equal(turned.getAttribute('transform'), 'rotate(45 650 200)');
});

test('paint は回した四角・丸の canvas を箱の中心まわりに回してから描く', () => {
  const calls = [];
  graphics.paint(recordingContext(calls), { ...SQUARE, angle: 90 }, viewport({ scale: 2 }));
  const names = calls.map(([name]) => name);
  assert.deepEqual(calls.filter(([name]) => name === 'translate' || name === 'rotate').map(([name, ...rest]) => [name, ...rest.map(num)]), [
    ['translate', 400, 383.78], ['rotate', num(Math.PI / 2)], ['translate', -400, -383.78],
  ]);
  assert.ok(names.indexOf('rotate') < names.indexOf('strokeRect'), '回してから描く');

  calls.length = 0;
  graphics.paint(recordingContext(calls), SQUARE, viewport({ scale: 2 }));
  assert.equal(calls.some(([name]) => name === 'rotate'), false, '回していなければ回さない');
});

test('paint は回した半透明の図形の別の canvas を、回した外接の大きさで作る', () => {
  const layerCalls = [];
  const made = [];
  const doc = {
    createElement: (tag) => {
      const canvas = { tag, width: 0, height: 0, getContext: () => { made.push([canvas.width, canvas.height]); return recordingContext(layerCalls); } };
      return canvas;
    },
  };
  const page = { width: 1191, height: 1684, ownerDocument: doc };
  const calls = [];
  graphics.paint(recordingContext(calls, { canvas: page }), { ...SQUARE, opacity: 0.5, angle: 90 }, viewport({ scale: 2 }));
  // 回す前の外接 196〜604 × 279.78〜487.78（408×208）を 90° 回すと、296〜504 × 179.78〜587.78（中心 400, 383.78）
  assert.deepEqual(made, [[208, 409]]);
  assert.deepEqual(layerCalls[0], ['translate', -296, -179]);
  assert.deepEqual(layerCalls.filter(([name]) => name === 'rotate').length, 1, '別の canvas の上で回す');
  assert.deepEqual(calls.find(([name]) => name === 'drawImage').slice(2), [296, 179]);
  assert.equal(calls.some(([name]) => name === 'rotate'), false, 'ページの canvas は回さない');
});

// ---- 塗った三角の矢印（spec-4b-5a 確定事項7） ----

test('svgOf は塗った三角を線の色で塗った <polygon>（線なし）にし、paint は三角を同じ色で fill するだけ', () => {
  const closed = { ...ARROW, head: undefined };
  const g = graphics.svgOf(makeDoc(), closed, viewport());
  const polygon = g.querySelector('polygon');
  assert.equal(polygon.getAttribute('fill'), '#2c5cd9');
  assert.equal(polygon.getAttribute('stroke'), 'none');
  assert.equal(g.querySelectorAll('polyline').length, 0);
  const calls = [];
  graphics.paint(recordingContext(calls), closed, viewport());
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 1, '線は軸だけ');
  assert.equal(calls.filter(([name]) => name === 'fill').length, 1);
  assert.equal(calls.filter(([name]) => name === 'closePath').length, 1);
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'fillStyle' && value === '#2c5cd9'));
});

test('svgOf は閉じた多角形を <g> の線と塗りのままの <polygon> にし、paint は閉じて塗ってから線を引く（spec-4b-5a 確定事項10）', () => {
  const polygon = { id: 'p', src: 0, kind: 'polygon', closed: true, color: '#c00000', fill: '#ffff00', opacity: 1, lineWidth: 2, paths: [[[100, 600], [180, 620], [200, 720]]], rect: [99, 599, 201, 721], quads: [[99, 721, 201, 721, 99, 599, 201, 599]] };
  const g = graphics.svgOf(makeDoc(), polygon, viewport());
  assert.equal(g.getAttribute('fill'), '#ffff00');
  const node = g.querySelector('polygon');
  assert.equal(node.hasAttribute('fill'), false);
  assert.equal(node.hasAttribute('stroke'), false);
  const calls = [];
  graphics.paint(recordingContext(calls), polygon, viewport());
  const names = calls.map(([name]) => name);
  assert.equal(names.filter((name) => name === 'closePath').length, 1);
  assert.ok(names.indexOf('fill') < names.indexOf('stroke'));
});

// ---- マーカー（spec-4b-5b 確定事項8） ----

test('paint はマーカーを不透明度 100% でも別の canvas に描き、乗算で重ねる（交わりを濃くしない）', () => {
  const calls = [];
  const layerCalls = [];
  const made = [];
  const doc = {
    createElement: (tag) => {
      const canvas = { tag, width: 0, height: 0, getContext: () => { made.push([canvas.width, canvas.height]); return recordingContext(layerCalls); } };
      return canvas;
    },
  };
  const page = { width: 1191, height: 1684, ownerDocument: doc };
  graphics.paint(recordingContext(calls, { canvas: page }), { ...INK, color: '#ffff00', lineWidth: 12, blend: 'multiply' }, viewport({ scale: 2 }));
  assert.equal(made.length, 1);
  assert.ok(layerCalls.some(([name]) => name === 'stroke'));
  assert.equal(layerCalls.some(([name, key]) => name === 'set' && key === 'globalCompositeOperation'), false, '別の canvas にはふつうに描く');
  assert.deepEqual(calls.map(([name, ...rest]) => (name === 'drawImage' ? [name] : [name, ...rest])), [
    ['save'], ['set', 'globalAlpha', 1], ['set', 'globalCompositeOperation', 'multiply'], ['drawImage'], ['restore'],
  ]);
  // 半透明のマーカーも同じ（不透明度は重ねるときに当てる）。
  calls.length = 0;
  graphics.paint(recordingContext(calls, { canvas: page }), { ...INK, blend: 'multiply', opacity: 0.4 }, viewport({ scale: 2 }));
  assert.deepEqual(calls.filter(([name]) => name === 'set').map((call) => call.slice(1)), [['globalAlpha', 0.4], ['globalCompositeOperation', 'multiply']]);
});

test('paint は別の canvas を作れないとき、マーカーを乗算のまま直に描く', () => {
  const calls = [];
  graphics.paint(recordingContext(calls), { ...INK, blend: 'multiply' }, viewport());
  assert.ok(calls.some(([name, key, value]) => name === 'set' && key === 'globalCompositeOperation' && value === 'multiply'));
  assert.ok(calls.some(([name]) => name === 'stroke'));
  assert.equal(calls.some(([name]) => name === 'drawImage'), false);
});
