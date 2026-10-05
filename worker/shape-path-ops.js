'use strict';

// 線の図形（直線・矢印・ペン）の外観の命令を組む純粋層（spec-4-3 確定事項20〜22、spec-4b-1b 確定事項32）。pdf-lib を知らない。
//
// shape-appearance.js から移した（spec-4b-5a a0。中身は変えていない）。content stream の文字列を返し、色と線種は styleOf の形
// （shape-style-rules.js）で受ける。矢じりの点は arrow-head.js。

const { num, colorOps } = require('./annotation-appearance.js');
const { arrowHead } = require('./arrow-head.js');

function point(values) {
  return values.map(num).join(' ');
}

function dashOps(dash) {
  return `[${dash.map(num).join(' ')}] 0 d`;
}

function pathOps(path) {
  return `${path.map((at, index) => `${point(at)} ${index === 0 ? 'm' : 'l'}`).join(' ')} S`;
}

// 直線: 実線は丸い端の 1 本、破線は切りっぱなしの端（確定事項32）。
function lineOps([from, to], width, style) {
  const head = style.dash !== null ? `${num(width)} w ${dashOps(style.dash)}` : `${num(width)} w 1 J`;
  return `${colorOps(style.stroke)} RG\n${head} ${pathOps([from, to])}`;
}

// 矢印: 直線のあとに終点の翼 2 本（丸い角）。破線でも矢じりは実線で描く。
function arrowOps([from, to], width, style) {
  const [left, right] = arrowHead(from, to, width);
  if (style.dash === null)
    return [`${colorOps(style.stroke)} RG`, `${num(width)} w 1 J 1 j`, pathOps([from, to]), pathOps([left, to, right])].join('\n');
  return [`${colorOps(style.stroke)} RG`, `${num(width)} w ${dashOps(style.dash)}`, pathOps([from, to]),
    '[] 0 d 1 J 1 j', pathOps([left, to, right])].join('\n');
}

// ペン: path ごとの折れ線（丸い端と角）。
function inkOps(paths, width, style) {
  return [`${colorOps(style.stroke)} RG`, `${num(width)} w 1 J 1 j`, ...paths.map(pathOps)].join('\n');
}

module.exports = { point, dashOps, pathOps, lineOps, arrowOps, inkOps };
