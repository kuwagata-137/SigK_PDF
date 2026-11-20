'use strict';

// マーキングの外観（/AP /N）の中身を組む純粋層（spec-7-9 確定事項F6）。pdf-lib を知らない。
//
// PDF 標準の丸の注釈 /Circle に、5 種の見た目の外観を付けて保存する（ほかのアプリでも同じ見た目で表示される）。部品は
// marking-geometry.js（画面と同じ式）で、円はベジェ 4 本、番号と「！」は線で描く（フォントは埋め込まない）。マーキングの値
// （形・外の円の直径・中の円の直径・十字線の長さ・文字サイズ・番号）は、外観の中を PDF 標準のマーク付き内容 /SigKMark /MK BDC … EMC で囲み、
// 外観の /Resources /Properties /MK の属性辞書に書く（読み戻しは appearance-marking.js。注釈の辞書には独自の欄を追加しない。決定61 ②）。
// /C（線の色）・/BS /W（線の太さ）・/CA（不透明度）は標準どおり書き、/IC は書かない（読み込む側が /IC のある丸を塗るため）。
// 不透明度が 1 未満なら透明グループで包む（線どうしが重なっても濃くならない。図形と同じ）。

const { num, colorOps, parseColor } = require('./annotation-appearance.js');
const { point } = require('./shape-path-ops.js');
const { ellipsePath } = require('./box-path-ops.js');
const { partsOf } = require('./marking-geometry.js');

// 形 → 属性の名前（appearance-marking.js が逆に引く）。
const SHAPE_NAMES = Object.freeze({ target: 'Target', double: 'Double', crosshair: 'Crosshair', number: 'Number', caution: 'Caution' });
// 大きさの範囲（renderer/marking-rules.js と同じ。test/marking-geometry.test.js が一致を見張る）。
const RANGES = Object.freeze({ outer: [4, 720], dot: [1, 720], ring: [1, 720], cross: [4, 1440], fontSize: [4, 200] });
const NUMBER_MAX = 9999;

function round(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function validMarking(marking) {
  if (marking === null || typeof marking !== 'object' || SHAPE_NAMES[marking.shape] === undefined)
    return false;
  if (!Object.entries(RANGES).every(([field, [min, max]]) => Number.isFinite(marking[field]) && marking[field] >= min && marking[field] <= max))
    return false;
  if (marking.dot > marking.outer || marking.ring > marking.outer)
    return false;
  const numbered = Number.isInteger(marking.number) && marking.number >= 1 && marking.number <= NUMBER_MAX;
  return marking.shape === 'number' ? numbered : marking.number === undefined;
}

// 保存の形（renderer/annotation-entry.js の toSaveEntry）として読めるか。
function isMarkingEntry(entry) {
  return entry?.kind === 'marking' && Array.isArray(entry.rect) && entry.rect.length === 4 && entry.rect.every(Number.isFinite)
    && Number.isFinite(entry.lineWidth) && entry.lineWidth > 0 && parseColor(entry.color) !== null && validMarking(entry.marking);
}

function circlePath(center, r) {
  return `${ellipsePath([center[0] - r, center[1] - r, center[0] + r, center[1] + r], 0)}\nh`;
}

// 部品 1 つの命令。線は部品ごとに太さと端（J）を付け、角（j）は丸。
function partOps(part) {
  switch (part.type) {
    case 'circle': return `${num(part.width)} w\n${circlePath(part.center, part.r)} S`;
    case 'disc': return `${circlePath(part.center, part.r)} f`;
    case 'line': return `${num(part.width)} w ${part.cap === 'butt' ? 0 : 1} J ${point(part.from)} m ${point(part.to)} l S`;
    default: {
      const path = part.points.map((at, index) => `${point(at)} ${index === 0 ? 'm' : 'l'}`).join(' ');
      return `${num(part.width)} w 1 J ${path}${part.closed ? ' h' : ''} S`;
    }
  }
}

// マーク付き内容の属性（/Resources /Properties /MK）。
function propertiesOf(marking) {
  const properties = {
    Shape: SHAPE_NAMES[marking.shape], Outer: round4(marking.outer), Dot: round4(marking.dot), Ring: round4(marking.ring),
    Cross: round4(marking.cross), FontSize: round4(marking.fontSize),
  };
  if (marking.number !== undefined)
    properties.Number = marking.number;
  return properties;
}

// 外観。戻り値は shape-appearance.js と同じ形（{ content, group, bbox, subtype, rgb, fillRgb, dash, opacity, lineWidth }）に、
// マーク付き内容の marked（{ tag, name, properties }。op-annotate.js が中身を BDC … EMC で囲み、/Properties に書く）を加えたもの。
// 形が違えば null。
function markingAppearanceOf(entry) {
  if (!isMarkingEntry(entry))
    return null;
  const rgb = parseColor(entry.color);
  const alpha = Number.isFinite(entry.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : 1;
  const ops = [`${colorOps(rgb)} RG ${colorOps(rgb)} rg 1 j`, ...partsOf(entry).map(partOps)].join('\n');
  const group = alpha < 1;
  return {
    content: group ? ops : `/GS gs\n${ops}`,
    group,
    bbox: entry.rect.map(round),
    subtype: 'Circle',
    rgb,
    fillRgb: null,
    dash: null,
    opacity: alpha,
    lineWidth: round(entry.lineWidth),
    marked: { tag: 'SigKMark', name: 'MK', properties: { MK: propertiesOf(entry.marking) } },
  };
}

module.exports = { SHAPE_NAMES, RANGES, validMarking, isMarkingEntry, markingAppearanceOf };
