'use strict';

// 透かしの Form XObject の中身（spec-4-5 確定事項21・22）。pdf-lib を知らない純関数。
// 中身の文字列と /BBox を組むだけで、XObject に包んでページへ置くのは op-watermark.js の仕事。
//
// 素の箱は XObject の中の座標で中心が原点。文字は glyph-outline.js が大きさ 100 で組んだ輪郭、
// 画像は幅 100 の箱に縦横比で置く。不透明度は /GS（ExtGState の ca・CA）で当てる。

const { num, parseColor } = require('./annotation-appearance.js');
const { num4 } = require('./watermark-layout.js');

// 画像の素の箱の幅（文字の大きさ 100 と桁を揃える）。
const IMAGE_WIDTH = 100;

const round2 = (value) => Math.round(value * 100) / 100;
const floor2 = (value) => Math.floor(value * 100 + 1e-9) / 100;
const ceil2 = (value) => Math.ceil(value * 100 - 1e-9) / 100;

// 0 は見えないので受けない。
function isOpacity(value) {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

// 文字の透かし。/BBox は描画を切り抜くので、字形が素の箱からはみ出した分は外へ広げる
// （大きさと位置の計算は素の箱で行う。確定事項22）。
function textMarkOf(outline, { color, opacity }) {
  const rgb = parseColor(color);
  if (rgb === null || !isOpacity(opacity) || !(outline?.width > 0) || !(outline.height > 0) || outline.ops.length === 0)
    return null;
  const halfWidth = outline.width / 2;
  const halfHeight = outline.height / 2;
  const ink = outline.inkBox ?? [-halfWidth, -halfHeight, halfWidth, halfHeight];
  const bbox = [
    floor2(Math.min(-halfWidth, ink[0])), floor2(Math.min(-halfHeight, ink[1])),
    ceil2(Math.max(halfWidth, ink[2])), ceil2(Math.max(halfHeight, ink[3])),
  ];
  const content = ['/GS gs', `${num(rgb[0])} ${num(rgb[1])} ${num(rgb[2])} rg`, ...outline.ops, 'f'].join('\n');
  return { content, bbox, width: outline.width, height: outline.height, opacity };
}

// 画像の透かし。width・height は画像の画素数。高さは小数 2 桁に丸め、箱と中身で同じ値を使う。
function imageMarkOf({ width, height, opacity }) {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height) || !isOpacity(opacity))
    return null;
  const boxWidth = IMAGE_WIDTH;
  const boxHeight = round2((IMAGE_WIDTH * height) / width);
  const content = ['/GS gs', `q ${num4(boxWidth)} 0 0 ${num4(boxHeight)} ${num4(-boxWidth / 2)} ${num4(-boxHeight / 2)} cm`, '/Im Do', 'Q'].join('\n');
  return { content, bbox: [-boxWidth / 2, -boxHeight / 2, boxWidth / 2, boxHeight / 2], width: boxWidth, height: boxHeight, opacity };
}

module.exports = { IMAGE_WIDTH, isOpacity, textMarkOf, imageMarkOf };
