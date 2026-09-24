'use strict';

// 透かしの文字を字形の輪郭（パス）にする（spec-4-5 確定事項20。論点1）。pdf-lib を知らない純関数。
//
// 文字として書くと、/Artifact の印を付けても pdf.js が透かしの文字を本文として返し、本アプリの
// 検索・選択・コピーに混ざる（事前調査 A）。輪郭で描けば見た目は同じで混ざらず、フォントも埋めない。
// fontkit のフォント（font.layout・glyph.path.commands・glyph.bbox）を受け取り、PDF のパスの演算子を返す。

const { num } = require('./annotation-appearance.js');
const { FONT_ASCENT, FONT_DESCENT } = require('./free-text-appearance.js');

// 大きさ 100 で組む（XObject の中の座標。置くときの拡大は watermark-layout.js が決める）。
const UNITS = 100;
// 素の箱の高さ（144.8）と、中心から見たベースラインの位置（−43.6）。浮動小数の端数を落とす。
const round2 = (value) => Math.round(value * 100) / 100;
const HEIGHT = round2((FONT_ASCENT + FONT_DESCENT) * UNITS);
const BASELINE = -round2(((FONT_ASCENT - FONT_DESCENT) / 2) * UNITS);

// fontkit の Path.commands を PDF のパス演算子へ。TrueType の二次曲線は三次へ直す
// （制御点は、始点と終点から二次の制御点へ 2/3 の内分）。知らないコマンドは飛ばす。
function pathOps(commands, scale, dx, dy) {
  const ops = [];
  const point = (x, y) => `${num(dx + x * scale)} ${num(dy + y * scale)}`;
  let current = [0, 0];
  for (const { command, args } of commands) {
    if (command === 'moveTo' || command === 'lineTo') {
      ops.push(`${point(args[0], args[1])} ${command === 'moveTo' ? 'm' : 'l'}`);
      current = [args[0], args[1]];
    } else if (command === 'quadraticCurveTo') {
      const [qx, qy, x, y] = args;
      const c1 = [current[0] + (2 / 3) * (qx - current[0]), current[1] + (2 / 3) * (qy - current[1])];
      const c2 = [x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y)];
      ops.push(`${point(...c1)} ${point(...c2)} ${point(x, y)} c`);
      current = [x, y];
    } else if (command === 'bezierCurveTo') {
      ops.push(`${point(args[0], args[1])} ${point(args[2], args[3])} ${point(args[4], args[5])} c`);
      current = [args[4], args[5]];
    } else if (command === 'closePath') {
      ops.push('h');
    }
  }
  return ops;
}

// 外接の箱を広げる。輪郭の無いグリフ（空白）の bbox は Infinity なので入れない。
function extend(box, glyphBox) {
  if (![glyphBox[0], glyphBox[1], glyphBox[2], glyphBox[3]].every(Number.isFinite))
    return box;
  if (box === null)
    return glyphBox;
  return [Math.min(box[0], glyphBox[0]), Math.min(box[1], glyphBox[1]), Math.max(box[2], glyphBox[2]), Math.max(box[3], glyphBox[3])];
}

// 1 行の文字を輪郭にする。戻り値は { ops, width, height, inkBox }。
//   ops    … m・l・c・h の並び（塗りの f は付けない。watermark-appearance.js が付ける）
//   width  … 字送りの合計、height … ascent＋descent（どちらも大きさ 100 での値）
//   inkBox … 字形の外接の箱（輪郭が 1 つも無ければ null）
// 素の箱の中心を原点に置く。ベースラインは中心から (ascent − descent)/2 下。
function outlineOf(font, text) {
  const run = font.layout(text);
  const scale = UNITS / font.unitsPerEm;
  const width = run.advanceWidth * scale;
  const ops = [];
  let inkBox = null;
  let x = -width / 2;
  run.glyphs.forEach((glyph, index) => {
    const position = run.positions[index];
    const dx = x + position.xOffset * scale;
    const dy = BASELINE + position.yOffset * scale;
    ops.push(...pathOps(glyph.path.commands, scale, dx, dy));
    const bbox = glyph.bbox;
    inkBox = extend(inkBox, [dx + bbox.minX * scale, dy + bbox.minY * scale, dx + bbox.maxX * scale, dy + bbox.maxY * scale]);
    x += position.xAdvance * scale;
  });
  return { ops, width, height: HEIGHT, inkBox };
}

module.exports = { UNITS, HEIGHT, BASELINE, pathOps, outlineOf };
