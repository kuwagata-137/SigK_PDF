'use strict';

// 吹き出しの外観と辞書の欄を組む純粋層（spec-4b-4b 確定事項H2・H3）。free-text-wrapped.js が使う。pdf-lib を知らない。
//
// 箱は書き込みの rect（回す前）、しっぽの先は tip（回す前の紙の座標）。輪郭は callout-outline.js（画面と同じ式）で、文字の向きの
// cm のあとの座標へ直して描く。/BBox は箱と先を含む外接（先は線の太さの半分だけ外へ）、/RD は /BBox と箱の差を［左 下 右 上］で
// （決定59 ③。PDFBox の applyRectDifferences・MuPDF の pdf_annot_rect と同じ並び）、/CL は先と根元の中心（紙の座標。回していれば
// 回した位置）。回していれば /RD は回す前の /BBox からの差（確定事項H2。起草者の判断）。

const { num, colorOps } = require('./annotation-appearance.js');
const { outlineOf, boundsOf, outlineOps, paperOf, localOf } = require('./callout-outline.js');
const { matrixOf } = require('./shape-rotation.js');
const { transformPoint } = require('./pdf-matrix.js');

function round(value, digits = 2) {
  const scale = 10 ** digits;
  const rounded = Math.round(value * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

// 表示の左上（紙の座標）。renderer の free-text-geometry.js の frameOrigin と同じ。
function originOf([x1, y1, x2, y2], rotation) {
  switch (rotation) {
    case 90: return [x1, y1];
    case 180: return [x2, y1];
    case 270: return [x2, y2];
    default: return [x1, y2];
  }
}

// 表示の向きでの箱の大きさ。
function sizeOf([x1, y1, x2, y2], rotation) {
  const width = x2 - x1;
  const height = y2 - y1;
  return rotation % 180 === 0 ? { width, height } : { width: height, height: width };
}

// 吹き出しか（tip を持つか）。
function isCallout(entry) {
  return Array.isArray(entry?.tip);
}

// 吹き出しの形の欄。tip は 2 つの数で、塗りか枠線のどちらかが要る（確定事項A5）。
function validCallout(entry, hasFill, hasBorder) {
  if (!isCallout(entry))
    return entry?.tip === undefined;
  return entry.tip.length === 2 && entry.tip.every(Number.isFinite) && (hasFill || hasBorder);
}

// 吹き出しの部品。rect は丸めた箱、first は文字の向きの cm のあとの箱の左上、fillRgb・borderRgb は RGB か null、borderWidth は
// 枠線の太さ（無ければ 0）。戻り値は { ops（輪郭の塗りと線）, bbox, rd, cl }。
function calloutPartsOf(entry, { rect, first, fillRgb, borderRgb, borderWidth }) {
  const origin = originOf(rect, entry.rotation);
  const { width, height } = sizeOf(rect, entry.rotation);
  const tip = localOf(origin, entry.rotation, entry.tip);
  const outline = outlineOf({ width, height, tip, fontSize: entry.fontSize, inset: borderWidth / 2 });
  const paint = [];
  if (fillRgb !== null)
    paint.push(`${colorOps(fillRgb)} rg`);
  if (borderRgb !== null)
    paint.push(`${colorOps(borderRgb)} RG`, `${num(borderWidth)} w`, '1 j');
  const op = fillRgb !== null && borderRgb !== null ? 'B' : (fillRgb !== null ? 'f' : 'S');
  const ops = [...paint, ...outlineOps(outline.segments, first), op];
  const [l, t, r, b] = boundsOf(width, height, tip, borderWidth);
  const corners = [[l, t], [r, t], [l, b], [r, b]].map((point) => paperOf(origin, entry.rotation, point));
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((value) => round(value));
  const rd = [rect[0] - bbox[0], rect[1] - bbox[1], bbox[2] - rect[2], bbox[3] - rect[3]].map((value) => round(value));
  // /CL は小数 4 桁（回した位置を 2 桁に丸めると、読み戻して回す前へ戻したときに 0.01pt ずれることがある）。
  const turn = Number.isFinite(entry.angle) && entry.angle !== 0 ? matrixOf(rect, entry.angle) : null;
  const onPage = (point) => (turn === null ? point : transformPoint(point, turn)).map((value) => round(value, 4));
  const cl = [...onPage(entry.tip), ...onPage(paperOf(origin, entry.rotation, outline.base))];
  return { ops, bbox, rd, cl };
}

module.exports = { isCallout, validCallout, calloutPartsOf, originOf, sizeOf };
