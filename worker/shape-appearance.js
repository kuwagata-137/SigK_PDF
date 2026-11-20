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
const { centerOf, rotatePoint, matrixOf, rectOf } = require('./shape-rotation.js');
const { KINDS, styleOf, isShapeEntry } = require('./shape-style-rules.js');
const { ARROW_MIN_LENGTH, ARROW_LENGTH_RATIO, ARROW_ANGLE, arrowHead } = require('./arrow-head.js');
const { dashOps, lineOps, arrowOps, closedArrowOps, crossOps, polygonOps, inkOps } = require('./shape-path-ops.js');
const { KAPPA, drawWidthOf, rectPath, ellipsePath } = require('./box-path-ops.js');
const { isApart, apartAppearanceOf } = require('./fill-apart-appearance.js');

const SUBTYPES = Object.freeze({ square: 'Square', circle: 'Circle', line: 'PolyLine', arrow: 'PolyLine', cross: 'Ink', ink: 'Ink' });

function round(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
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
    case 'cross': return { ops: crossOps(entry.paths, entry.lineWidth, style), cloud: null };
    case 'polygon': return { ops: polygonOps(entry.paths[0], entry.lineWidth, style, entry.closed === true), cloud: null };
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
  // ×印は小数 4 桁（読み戻しで角度を形から求めるため。spec-4b-5a 確定事項35・39）。
  if (entry.kind === 'cross')
    return { inkList: entry.paths.map((path) => path.flat().map(round4)) };
  // 多角形は回した位置の頂点を小数 4 桁で（読み戻しで回す前の頂点に戻すため。spec-4b-5a 確定事項36・40）。回すのは丸めない cos・sin で
  // （/Matrix の 4 桁の丸めで回すと、大きな多角形では開き直すたびに頂点が 0.01pt ずつずれる）。中心は /BBox（回す前の箱）の中心。
  if (entry.kind === 'polygon') {
    const turned = Number.isFinite(entry.angle) && entry.angle !== 0;
    const center = centerOf(entry.rect.map(round));
    return { vertices: entry.paths[0].flatMap((at) => (turned ? rotatePoint(at, center, entry.angle) : at).map(round4)) };
  }
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

// 中身と透明グループ。塗りと枠線を分けて描く図形（spec-7-9 確定事項B4・B5・C2）は fill-apart-appearance.js が組み、外観が不透明度を
// 持つので opacity（辞書の /CA と外側の /GS）は 1 にする。
function bodyOf(entry, style, alpha) {
  if (isApart(entry, style, alpha)) {
    const { content, mask, states, properties, cloud } = apartAppearanceOf(entry, style, alpha);
    return { content, group: false, cloud, opacity: 1, apart: { mask, states, properties } };
  }
  const { ops, cloud } = opsOf(entry, style);
  // マーカーは不透明度によらず透明グループで包み、外側で乗算する（spec-4b-5b 確定事項10。線どうしの交わりを濃くしない。事前調査 E）。
  const group = alpha < 1 || entry.blend === 'multiply';
  return { content: group ? ops : `/GS gs\n${ops}`, group, cloud, opacity: alpha };
}

// 外観の中身。戻り値は { content, group, bbox, subtype, rgb, fillRgb, dash, opacity, lineWidth, cloudIntensity?, rectDifference?,
// vertices?, lineEndings?, inkList?, matrix?, rect?, apart? }。rgb は線が無ければ null。matrix と rect は回した四角・丸だけ（bbox は
// 回す前の箱のまま）。apart は塗りと枠線を分けて描く時の資源（op-annotate.js が ExtGState・SMask・Properties にする）。形が違えば null。
function shapeAppearanceOf(entry) {
  if (!isShapeEntry(entry))
    return null;
  const style = styleOf(entry);
  const alpha = Number.isFinite(entry.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : 1;
  const { cloud, ...body } = bodyOf(entry, style, alpha);
  const marker = entry.blend === 'multiply';
  const turn = turnOf(entry, entry.rect.map(round));
  return {
    ...body,
    bbox: entry.rect.map(round),
    subtype: entry.kind === 'polygon' ? (entry.closed === true ? 'Polygon' : 'PolyLine') : SUBTYPES[entry.kind],
    rgb: style.stroke,
    ...styleFieldsOf(style, cloud, turn.matrix !== undefined),
    // 塗った三角は /IC に線の色（spec-4b-5a 確定事項34）。
    ...(isClosedArrow(entry) ? { fillRgb: style.stroke } : {}),
    ...(marker ? { blend: 'Multiply' } : {}),
    lineWidth: round(entry.lineWidth),
    ...fieldsOf(entry),
    ...turn,
  };
}

module.exports = { KAPPA, ARROW_MIN_LENGTH, ARROW_LENGTH_RATIO, ARROW_ANGLE, KINDS, SUBTYPES, arrowHead, isShapeEntry, shapeAppearanceOf };
