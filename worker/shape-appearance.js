'use strict';

// 図形・ペン注釈の外観（/AP /N）の中身を組む純粋層（spec-4-3 確定事項20〜22・30）。
//
// annotation-appearance.js と同じく pdf-lib を知らない。content stream は文字列で返し、
// Form XObject と注釈の辞書に包むのは op-annotate.js の仕事である。
// 矢じりの寸法と翼の式は renderer/shape-geometry.js と同じもので、一致はテストで見張る
// （プロセスが違うので import できない）。楕円はベジェ 4 本（κ = 0.5523）。
// 線は矩形・楕円の /Rect の内側に収める（線幅の半分だけ内へ。画面の描き方と同じ）。

const { num, parseColor } = require('./annotation-appearance.js');

const KAPPA = 0.5523;
const ARROW_MIN_LENGTH = 9;
const ARROW_LENGTH_RATIO = 6;
const ARROW_ANGLE = Math.PI / 6;

const KINDS = Object.freeze(['square', 'circle', 'line', 'arrow', 'ink']);
const SUBTYPES = Object.freeze({ square: 'Square', circle: 'Circle', line: 'PolyLine', arrow: 'PolyLine', ink: 'Ink' });

function round(value) {
  return Math.round(value * 100) / 100;
}

// 矢じりの翼 2 点（終点 to から線の逆向きへ開く）。renderer/shape-geometry.js の arrowHead と同値。
function arrowHead(from, to, lineWidth) {
  const length = Math.max(ARROW_MIN_LENGTH, lineWidth * ARROW_LENGTH_RATIO);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const wing = (turn) => [to[0] + Math.cos(angle + turn) * length, to[1] + Math.sin(angle + turn) * length];
  return [wing(Math.PI - ARROW_ANGLE), wing(-(Math.PI - ARROW_ANGLE))];
}

function isPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
}

// 点列は 1 本以上で各 path が 2 点以上。直線・矢印は 1 本ちょうどで 2 点（renderer/annotation-entry.js と同じ約束）。
function validPaths(kind, paths) {
  if (!Array.isArray(paths) || paths.length === 0)
    return false;
  if (!paths.every((path) => Array.isArray(path) && path.length >= 2 && path.every(isPoint)))
    return false;
  return kind === 'ink' || (paths.length === 1 && paths[0].length === 2);
}

// 図形・ペンの entry の形。線幅が正、/Rect が 4 つの数、色が #rrggbb、点列は種類ごとの形。
function isShapeEntry(entry) {
  if (!KINDS.includes(entry?.kind) || !Number.isFinite(entry.lineWidth) || entry.lineWidth <= 0)
    return false;
  if (!Array.isArray(entry.rect) || entry.rect.length !== 4 || !entry.rect.every(Number.isFinite))
    return false;
  if (parseColor(entry.color) === null)
    return false;
  return entry.kind === 'square' || entry.kind === 'circle' ? true : validPaths(entry.kind, entry.paths);
}

function point(values) {
  return values.map(num).join(' ');
}

// 矩形: 線幅の半分だけ内側の re。小さすぎる箱では幅 0（負にしない）。
function squareOps([x1, y1, x2, y2], width) {
  const half = width / 2;
  const inner = [Math.max(0, x2 - x1 - width), Math.max(0, y2 - y1 - width)];
  return `${num(width)} w ${point([x1 + half, y1 + half])} ${point(inner)} re S`;
}

// 楕円: 箱の中心を保ち、線幅の半分だけ内側の半径でベジェ 4 本。
function circleOps([x1, y1, x2, y2], width) {
  const rx = Math.max(0, (x2 - x1 - width) / 2);
  const ry = Math.max(0, (y2 - y1 - width) / 2);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    `${num(width)} w`,
    `${point([cx + rx, cy])} m`,
    `${point([cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry])} c`,
    `${point([cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy])} c`,
    `${point([cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry])} c`,
    `${point([cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy])} c`,
    'h S',
  ].join('\n');
}

function pathOps(path) {
  return `${path.map((at, index) => `${point(at)} ${index === 0 ? 'm' : 'l'}`).join(' ')} S`;
}

// 直線: 丸い端の 1 本。
function lineOps([from, to], width) {
  return `${num(width)} w 1 J ${pathOps([from, to])}`;
}

// 矢印: 直線のあとに終点の翼 2 本（丸い角）。
function arrowOps([from, to], width) {
  const [left, right] = arrowHead(from, to, width);
  return [`${num(width)} w 1 J 1 j`, pathOps([from, to]), pathOps([left, to, right])].join('\n');
}

// ペン: path ごとの折れ線（丸い端と角）。
function inkOps(paths, width) {
  return [`${num(width)} w 1 J 1 j`, ...paths.map(pathOps)].join('\n');
}

function opsOf(entry) {
  switch (entry.kind) {
    case 'square': return squareOps(entry.rect, entry.lineWidth);
    case 'circle': return circleOps(entry.rect, entry.lineWidth);
    case 'line': return lineOps(entry.paths[0], entry.lineWidth);
    case 'arrow': return arrowOps(entry.paths[0], entry.lineWidth);
    default: return inkOps(entry.paths, entry.lineWidth);
  }
}

// 種類ごとの辞書の欄（pdf-lib の名前は op-annotate.js が付ける）。
function fieldsOf(entry) {
  if (entry.kind === 'line' || entry.kind === 'arrow') {
    return {
      vertices: entry.paths[0].flat().map(round),
      lineEndings: ['None', entry.kind === 'arrow' ? 'OpenArrow' : 'None'],
    };
  }
  if (entry.kind === 'ink')
    return { inkList: entry.paths.map((path) => path.flat().map(round)) };
  return {};
}

// 外観の中身。戻り値は { content, bbox, subtype, rgb, opacity, lineWidth, vertices?, lineEndings?, inkList? }。
// 形が違えば null。
function shapeAppearanceOf(entry) {
  if (!isShapeEntry(entry))
    return null;
  const rgb = parseColor(entry.color);
  const alpha = Number.isFinite(entry.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : 1;
  const content = ['/GS gs', `${point(rgb)} RG`, opsOf(entry)].join('\n');
  return {
    content,
    bbox: entry.rect.map(round),
    subtype: SUBTYPES[entry.kind],
    rgb,
    opacity: alpha,
    lineWidth: round(entry.lineWidth),
    ...fieldsOf(entry),
  };
}

module.exports = { KAPPA, ARROW_MIN_LENGTH, ARROW_LENGTH_RATIO, ARROW_ANGLE, KINDS, SUBTYPES, arrowHead, isShapeEntry, shapeAppearanceOf };
