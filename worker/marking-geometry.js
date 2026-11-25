'use strict';

// マーキングの部品（紙の座標）と、番号の数字の折れ線（spec-7-9 確定事項F2・F6）。pdf-lib を知らない純関数。
//
// renderer/marking-glyphs.js・renderer/marking-geometry.js と同じ表と式（プロセスが違うので import できない。
// test/marking-geometry.test.js が、同じ書き込みから同じ部品を作ることを見張る）。部品の形は renderer/marking-geometry.js の説明のとおり。

const SQRT3_HALF = Math.sqrt(3) / 2;
const BANG = Object.freeze({ top: 0.66, bottom: 0.4, dot: 0.22, width: 0.1, dotRatio: 0.6 });
const HEIGHT_RATIO = 0.7;
const WIDTH_RATIO = 0.12;
const CELL = 0.6;
const GAP = 0.2;
const ARC_STEP = 15;

function round(value) {
  return Math.round(value * 100) / 100;
}

function arc(cx, cy, rx, ry, from, to) {
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / ARC_STEP));
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = ((from + ((to - from) * index) / steps) * Math.PI) / 180;
    points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  return points;
}

function sixStrokes() {
  return [arc(0.3, 0.7, 0.27, 0.27, 0, 360), arc(0.58, 0.7, 0.55, 0.67, 255, 180)];
}

// 数字ごとの折れ線（幅 0.6・高さ 1 の枠。y は下向き）。
const GLYPHS = Object.freeze({
  0: [arc(0.3, 0.5, 0.27, 0.47, 0, 360)],
  1: [[[0.12, 0.2], [0.34, 0.03], [0.34, 0.97]]],
  2: [[...arc(0.3, 0.28, 0.26, 0.25, 195, 380), [0.03, 0.97], [0.58, 0.97]]],
  3: [arc(0.3, 0.27, 0.24, 0.23, 200, 450), arc(0.3, 0.73, 0.27, 0.24, 270, 525)],
  4: [[[0.44, 0.97], [0.44, 0.03], [0.02, 0.7], [0.6, 0.7]]],
  5: [[[0.54, 0.03], [0.12, 0.03], ...arc(0.3, 0.68, 0.27, 0.29, 215, 520)]],
  6: sixStrokes(),
  7: [[[0.02, 0.03], [0.58, 0.03], [0.2, 0.97]]],
  8: [arc(0.3, 0.26, 0.22, 0.23, 0, 360), arc(0.3, 0.72, 0.27, 0.25, 0, 360)],
  9: sixStrokes().map((stroke) => stroke.map(([x, y]) => [CELL - x, 1 - y])),
});

function glyphBoxOf(number, fontSize) {
  const digits = String(number).length;
  const height = fontSize * HEIGHT_RATIO;
  const width = height * WIDTH_RATIO;
  const text = height * (digits * CELL + (digits - 1) * GAP);
  return { width: text + width, height: height + width, lineWidth: width, textWidth: text, glyphHeight: height };
}

function numberStrokes(number, fontSize, center) {
  const box = glyphBoxOf(number, fontSize);
  const h = box.glyphHeight;
  const left = center[0] - box.textWidth / 2;
  const top = center[1] + h / 2;
  const strokes = [];
  [...String(number)].forEach((digit, index) => {
    const x0 = left + index * (CELL + GAP) * h;
    for (const stroke of GLYPHS[digit])
      strokes.push(stroke.map(([x, y]) => [round(x0 + x * h), round(top - y * h)]));
  });
  return { strokes, lineWidth: round(box.lineWidth) };
}

function centerOf(rect) {
  return [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2];
}

function circlePart(center, diameter, lineWidth) {
  const width = Math.min(lineWidth, diameter / 2);
  return { type: 'circle', center, r: round(Math.max(0, diameter / 2 - width / 2)), width: round(width) };
}

function crossParts(center, length, width) {
  const [cx, cy] = center;
  const half = length / 2;
  return [
    { type: 'line', from: [round(cx - half), cy], to: [round(cx + half), cy], width, cap: 'butt' },
    { type: 'line', from: [cx, round(cy - half)], to: [cx, round(cy + half)], width, cap: 'butt' },
  ];
}

function cautionParts(center, outer, lineWidth) {
  const [cx, cy] = center;
  const height = outer * SQRT3_HALF;
  const width = round(Math.min(lineWidth, outer / 6));
  const bottom = cy - height / 2;
  const points = [[cx, cy + height / 2 - width / 2], [cx + outer / 2 - width / 2, bottom + width / 2], [cx - outer / 2 + width / 2, bottom + width / 2]]
    .map((point) => point.map(round));
  const bar = round(outer * BANG.width);
  return [
    { type: 'polyline', points, width, closed: true },
    { type: 'line', from: [cx, round(bottom + height * BANG.top)], to: [cx, round(bottom + height * BANG.bottom)], width: bar, cap: 'round' },
    { type: 'disc', center: [cx, round(bottom + height * BANG.dot)], r: round(bar * BANG.dotRatio) },
  ];
}

// 部品の並び（下から上の順）。entry は { rect, lineWidth, marking }。
function partsOf(entry) {
  const { marking, lineWidth } = entry;
  const center = centerOf(entry.rect).map(round);
  if (marking.shape === 'caution')
    return cautionParts(center, marking.outer, lineWidth);
  const outer = circlePart(center, marking.outer, lineWidth);
  if (marking.shape === 'target')
    return [outer, { type: 'disc', center, r: round(marking.dot / 2) }];
  if (marking.shape === 'double')
    return [outer, circlePart(center, marking.ring, lineWidth)];
  if (marking.shape === 'crosshair')
    return [outer, ...crossParts(center, marking.cross, outer.width)];
  const { strokes, lineWidth: width } = numberStrokes(marking.number, marking.fontSize, center);
  return [outer, ...strokes.map((points) => ({ type: 'polyline', points, width, closed: false }))];
}

module.exports = { SQRT3_HALF, GLYPHS, glyphBoxOf, numberStrokes, centerOf, partsOf };
