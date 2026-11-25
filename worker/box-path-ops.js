'use strict';

// 四角・丸・閉じた多角形の輪郭の path の命令を組む純粋層（spec-4b-1b 確定事項29〜33、spec-4b-5a 確定事項36、spec-7-9 確定事項B5）。
// pdf-lib を知らない。四角・丸の path（drawWidthOf・rectPath・ellipsePath）は shape-appearance.js から移した（spec-7-9。200 行の目安）。
// outlineOf は、塗りと枠線を分けて描く外観（fill-apart-appearance.js）が、塗り・切り抜き・枠線に同じ path を使うためのもの。

const { num } = require('./annotation-appearance.js');
const { cloudPathOf } = require('./cloud-appearance.js');
const { point, dashOps } = require('./shape-path-ops.js');

const KAPPA = 0.5523;

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

// 四角・丸の輪郭。雲形は雲の path、ほかは線があれば描く線幅の半分だけ内側の path（線なしは箱そのもの）。
function boxOutline(entry, style) {
  const cloud = style.cloudIntensity === null ? null
    : cloudPathOf({ kind: entry.kind, box: entry.rect, intensity: style.cloudIntensity, lineWidth: entry.lineWidth });
  if (cloud !== null)
    return { path: cloud.ops, head: `${num(cloud.drawWidth)} w 1 j`, cloud };
  const width = drawWidthOf(entry.rect, entry.lineWidth);
  const inset = style.stroke !== null ? width / 2 : 0;
  const head = [`${num(width)} w`, ...(style.dash !== null ? [dashOps(style.dash)] : [])].join(' ');
  const path = entry.kind === 'square' ? rectPath(entry.rect, inset) : `${ellipsePath(entry.rect, inset)}\nh`;
  return { path, head, cloud: null };
}

// 閉じた多角形の輪郭（頂点の折れ線を h で閉じる。丸い端と角）。
function polygonOutline(entry, style) {
  const width = num(entry.lineWidth);
  const head = style.dash !== null ? `${width} w ${dashOps(style.dash)} 1 j` : `${width} w 1 J 1 j`;
  const path = `${entry.paths[0].map((at, index) => `${point(at)} ${index === 0 ? 'm' : 'l'}`).join(' ')} h`;
  return { path, head, cloud: null };
}

// 塗れる図形の輪郭。{ path（path を組む命令）, head（線の太さ・破線・角の命令）, cloud（雲形の形か null） }。
function outlineOf(entry, style) {
  return entry.kind === 'polygon' ? polygonOutline(entry, style) : boxOutline(entry, style);
}

module.exports = { KAPPA, drawWidthOf, rectPath, ellipsePath, outlineOf };
