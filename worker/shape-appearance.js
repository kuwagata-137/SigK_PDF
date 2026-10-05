'use strict';

// 図形・ペン注釈の外観（/AP /N）の中身を組む純粋層（spec-4-3 確定事項20〜22・30、spec-4b-1b 確定事項29〜35）。
//
// pdf-lib を知らない。content stream を文字列で返し、Form XObject と辞書に包むのは op-annotate.js。矢じりは
// renderer/shape-geometry.js（ここでは arrow-head.js）、四角・丸の輪郭は renderer/shape-outline.js、雲形は renderer/cloud-geometry.js と同じ式で、
// 一致はテストで見張る（プロセスが違うので import できない）。四角・丸の線は /Rect の内側に収め、描く線幅は短い辺の半分で
// 頭打ちにする。見た目の欄と形の決まり（isShapeEntry）は shape-style-rules.js。不透明度が 1 未満なら透明グループで包むよう group を立てる。
// 直線・矢印・ペンの命令は shape-path-ops.js（spec-4b-5a a0 で移した）。

const { num, colorOps } = require('./annotation-appearance.js');
const { cloudPathOf } = require('./cloud-appearance.js');
const { matrixOf, rectOf } = require('./shape-rotation.js');
const { KINDS, styleOf, isShapeEntry } = require('./shape-style-rules.js');
const { ARROW_MIN_LENGTH, ARROW_LENGTH_RATIO, ARROW_ANGLE, arrowHead } = require('./arrow-head.js');
const { point, dashOps, lineOps, arrowOps, closedArrowOps, inkOps } = require('./shape-path-ops.js');

const KAPPA = 0.5523;

const SUBTYPES = Object.freeze({ square: 'Square', circle: 'Circle', line: 'PolyLine', arrow: 'PolyLine', ink: 'Ink' });

function round(value) {
  return Math.round(value * 100) / 100;
}

// 四角・丸を描く線幅。短い辺の半分で頭打ちにする（線が箱より太くても、箱をすべて覆う。確定事項30）。
function drawWidthOf([x1, y1, x2, y2], lineWidth) {
  return Math.max(0, Math.min(lineWidth, Math.min(x2 - x1, y2 - y1) / 2));
}

// 四角の path（inset だけ内側の re。小さすぎる箱では幅 0 で、負にしない）。
function rectPath([x1, y1, x2, y2], inset) {
  const inner = [Math.max(0, x2 - x1 - inset * 2), Math.max(0, y2 - y1 - inset * 2)];
  return `${point([x1 + inset, y1 + inset])} ${point(inner)} re`;
}

// 楕円の path（箱の中心を保ち、inset だけ内側の半径でベジェ 4 本。右端から反時計回り）。
function ellipsePath([x1, y1, x2, y2], inset) {
  const rx = Math.max(0, (x2 - x1) / 2 - inset);
  const ry = Math.max(0, (y2 - y1) / 2 - inset);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    `${point([cx + rx, cy])} m`,
    `${point([cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry])} c`,
    `${point([cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy])} c`,
    `${point([cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry])} c`,
    `${point([cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy])} c`,
  ].join('\n');
}

// 四角・丸（spec-4b-1b 確定事項29〜33）。線があれば描く線幅の半分だけ内側の path に線を引き、塗りがあれば同じ path を塗る。
// 線なしなら箱そのものを塗る。雲形は雲の path（線なしでも書き込みの太さで組む）を同じように塗って線を引く。
function boxOps(entry, style) {
  const width = drawWidthOf(entry.rect, entry.lineWidth);
  const paint = style.stroke !== null && style.fill !== null ? 'B' : (style.stroke !== null ? 'S' : 'f');
  const lines = [];
  if (style.stroke !== null)
    lines.push(`${colorOps(style.stroke)} RG`);
  if (style.fill !== null)
    lines.push(`${colorOps(style.fill)} rg`);
  const cloud = style.cloudIntensity === null ? null
    : cloudPathOf({ kind: entry.kind, box: entry.rect, intensity: style.cloudIntensity, lineWidth: entry.lineWidth });
  if (cloud !== null) {
    lines.push(`${style.stroke !== null ? `${num(cloud.drawWidth)} w ` : ''}1 j`, cloud.ops, paint);
    return { ops: lines.join('\n'), cloud };
  }
  const inset = style.stroke !== null ? width / 2 : 0;
  const head = style.stroke !== null ? [`${num(width)} w`, ...(style.dash !== null ? [dashOps(style.dash)] : [])] : [];
  if (entry.kind === 'square')
    lines.push([...head, rectPath(entry.rect, inset), paint].join(' '));
  else
    lines.push(...(head.length > 0 ? [head.join(' ')] : []), ellipsePath(entry.rect, inset), `h ${paint}`);
  return { ops: lines.join('\n'), cloud: null };
}

function opsOf(entry, style) {
  switch (entry.kind) {
    case 'square':
    case 'circle': return boxOps(entry, style);
    case 'line': return { ops: lineOps(entry.paths[0], entry.lineWidth, style), cloud: null };
    case 'arrow': return { ops: (isClosedArrow(entry) ? closedArrowOps : arrowOps)(entry.paths[0], entry.lineWidth, style), cloud: null };
    default: return { ops: inkOps(entry.paths, entry.lineWidth, style), cloud: null };
  }
}

// 塗った三角の矢印か（head が 'open' でない矢印。spec-4b-5a 確定事項4）。
function isClosedArrow(entry) {
  return entry.kind === 'arrow' && entry.head !== 'open';
}

function lineEndingOf(entry) {
  if (entry.kind !== 'arrow')
    return 'None';
  return isClosedArrow(entry) ? 'ClosedArrow' : 'OpenArrow';
}

// 種類ごとの辞書の欄（pdf-lib の名前は op-annotate.js が付ける）。
function fieldsOf(entry) {
  if (entry.kind === 'line' || entry.kind === 'arrow') {
    return {
      vertices: entry.paths[0].flat().map(round),
      lineEndings: ['None', lineEndingOf(entry)],
    };
  }
  if (entry.kind === 'ink')
    return { inkList: entry.paths.map((path) => path.flat().map(round)) };
  return {};
}

// 見た目の辞書の欄（annotation-fields.js が /IC・/BS・/BE・/RD にする）。雲形は /RD に余白を 4 つ（どちらの順で読まれても
// 同じ意味）、描けないほど小さな箱の雲形は /BE だけを書く（確定事項33）。回した図形には /RD を書かない（/Rect に対する軸平行の
// 余白で、回した箱とは意味が合わない。spec-4b-2 確定事項30）。
function styleFieldsOf(style, cloud, turned) {
  const fields = { fillRgb: style.fill, dash: style.dash === null ? null : style.dash.map(round) };
  if (style.cloudIntensity !== null)
    fields.cloudIntensity = style.cloudIntensity;
  if (cloud !== null && !turned)
    fields.rectDifference = Array(4).fill(round(cloud.margin));
  return fields;
}

// 回した四角・丸の外側の Form の /Matrix と、注釈の /Rect（回した外接。spec-4b-2 確定事項29）。回していなければ空。
function turnOf(entry, bbox) {
  if (!Number.isFinite(entry.angle) || entry.angle === 0)
    return {};
  return { matrix: matrixOf(bbox, entry.angle), rect: rectOf(bbox, entry.angle) };
}

// 外観の中身。戻り値は { content, group, bbox, subtype, rgb, fillRgb, dash, opacity, lineWidth, cloudIntensity?, rectDifference?,
// vertices?, lineEndings?, inkList?, matrix?, rect? }。rgb は線が無ければ null。matrix と rect は回した四角・丸だけ（bbox は回す前の
// 箱のまま）。形が違えば null。
function shapeAppearanceOf(entry) {
  if (!isShapeEntry(entry))
    return null;
  const style = styleOf(entry);
  const alpha = Number.isFinite(entry.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : 1;
  const { ops, cloud } = opsOf(entry, style);
  const group = alpha < 1;
  const turn = turnOf(entry, entry.rect.map(round));
  return {
    content: group ? ops : `/GS gs\n${ops}`,
    group,
    bbox: entry.rect.map(round),
    subtype: SUBTYPES[entry.kind],
    rgb: style.stroke,
    ...styleFieldsOf(style, cloud, turn.matrix !== undefined),
    // 塗った三角は /IC に線の色（spec-4b-5a 確定事項34）。
    ...(isClosedArrow(entry) ? { fillRgb: style.stroke } : {}),
    opacity: alpha,
    lineWidth: round(entry.lineWidth),
    ...fieldsOf(entry),
    ...turn,
  };
}

module.exports = { KAPPA, ARROW_MIN_LENGTH, ARROW_LENGTH_RATIO, ARROW_ANGLE, KINDS, SUBTYPES, arrowHead, isShapeEntry, shapeAppearanceOf };
