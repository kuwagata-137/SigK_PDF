(function (root) {
  'use strict';

  // テキストの箱の座標を扱う純粋層（spec-4-2 確定事項11〜12・19）。DOM には触れない。
  //
  // 箱は「置いたときの表示の左上 origin（紙の座標 pt）」と「表示の向きでの大きさ size」で
  // 決まり、置いたときの表示の回転 rotation で紙の /Rect へ回す。紙に貼った文字は紙と一緒に
  // 回るので、あとでページを回しても rotation は変えない。画面の角度は screenAngle で出す。

  // 行の寸法。worker/free-text-appearance.js に同じ値を持ち、一致はテストで見張る。
  const FONT_ASCENT = 1.16;
  const FONT_DESCENT = 0.288;
  const LINE_HEIGHT = 1.25;
  const BASELINE = 1.061;
  const PADDING = 2;
  const ROTATIONS = Object.freeze([0, 90, 180, 270]);

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  // /Rect [x1 y1 x2 y2] を UL・UR・LL・LR の四角にする（markup-quads.js と同じ順）。
  function quadOfRect([x1, y1, x2, y2]) {
    return [x1, y2, x2, y2, x1, y1, x2, y1];
  }

  // 表示の左上 origin と表示の向きでの大きさから、紙の /Rect を作る。
  function rectFromOrigin([x, y], { width, height }, rotation) {
    switch (rotation) {
      case 90: return [x, y, x + height, y + width].map(round);
      case 180: return [x - width, y, x, y + height].map(round);
      case 270: return [x - height, y - width, x, y].map(round);
      default: return [x, y - height, x + width, y].map(round);
    }
  }

  // /Rect から表示の左上（紙の座標）。worker の frameOf の起点を紙の座標で見たもの。
  function frameOrigin([x1, y1, x2, y2], rotation) {
    switch (rotation) {
      case 90: return [x1, y1];
      case 180: return [x2, y1];
      case 270: return [x2, y2];
      default: return [x1, y2];
    }
  }

  // /Rect の表示の向きでの大きさ。
  function frameSize([x1, y1, x2, y2], rotation) {
    const width = round(x2 - x1);
    const height = round(y2 - y1);
    return rotation % 180 === 0 ? { width, height } : { width: height, height: width };
  }

  // いま画面に描く角度（時計回り）。表示の回転と、置いたときの回転の差。
  function screenAngle(viewportRotation, rotation) {
    return (((viewportRotation - rotation) % 360) + 360) % 360;
  }

  // 行の並びから箱の大きさ（表示の向き・pt）。幅は最長行、高さは行数 × 行送り、四方に余白。
  function boxOfLines(lines, fontSize, widthOf) {
    const rows = Math.max(1, lines.length);
    const longest = lines.reduce((max, line) => Math.max(max, widthOf(line)), 0);
    return { width: round(longest + PADDING * 2), height: round(rows * fontSize * LINE_HEIGHT + PADDING * 2) };
  }

  // 本文を行に分ける。CR は捨てる（/Contents と textarea の改行は LF に揃える）。
  function linesOf(text) {
    return text.replace(/\r/g, '').split('\n');
  }

  root.SigK = root.SigK || {};
  root.SigK.freeTextGeometry = {
    FONT_ASCENT,
    FONT_DESCENT,
    LINE_HEIGHT,
    BASELINE,
    PADDING,
    ROTATIONS,
    quadOfRect,
    rectFromOrigin,
    frameOrigin,
    frameSize,
    screenAngle,
    boxOfLines,
    linesOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
