'use strict';

// テキストの塗りと枠線の外観の演算子を組む純粋層（spec-4b-4a 確定事項I2・I3）。free-text-wrapped.js が使う。
//
// 箱 clip（回転後の座標の [x y 幅 高さ]）に、塗りは箱いっぱい、枠線は箱の内側（線の太さの半分だけ入れた四角）に描く（画面の
// free-text-decor-graphics.js と同じ）。半透明のときに塗りと枠線と文字が重なって濃くならないよう、外観は透明グループで包み、
// pdf.js が文字の大きさと色を読めるよう、外側の先頭に何も描かない文字の命令を置く（事前調査 J の a2）。

const { num, colorOps } = require('./annotation-appearance.js');

// 塗りと枠線の演算子。fill・border は RGB（0〜1）か null、borderWidth は枠線の太さ（pt）。
function decorOps({ clip, fill, border, borderWidth }) {
  const [x, y, width, height] = clip;
  const ops = [];
  if (fill !== null)
    ops.push(`${colorOps(fill)} rg`, `${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`);
  if (border !== null) {
    const half = borderWidth / 2;
    ops.push(`${colorOps(border)} RG`, `${num(borderWidth)} w`, '0 j',
      `${num(x + half)} ${num(y + half)} ${num(width - borderWidth)} ${num(height - borderWidth)} re S`);
  }
  return ops;
}

// 透明グループの外側の先頭に置く、何も描かない文字の命令（pdf.js は外観の最初の文字の命令までの Tf と塗りの色を読む。
// グループの中までは入らないので、これが無いと「10pt・黒」と読む。q・Q の外に置く）。
function readableTextOps({ name, fontSize, rgb }) {
  return `BT /${name} ${num(fontSize)} Tf ${colorOps(rgb)} rg ET`;
}

module.exports = { decorOps, readableTextOps };
