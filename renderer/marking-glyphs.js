(function (root) {
  'use strict';

  // 番号付き丸の番号を、線で描く数字（0〜9）にする純粋層（spec-7-9 確定事項F2・F6）。DOM に触れない。
  //
  // フォントを使わず、数字ごとの折れ線（円弧は 15° ごとの点）を、線の太さを付けて丸い端と角で引く（Claude の判断）。画面の SVG・印刷の
  // canvas・保存の外観が同じ点を描くので、どこで見ても同じ形になり、PDF にフォントを埋め込まない。worker/marking-geometry.js が
  // 同じ表と式を持つ（プロセスが違うので import できない。test/marking-geometry.test.js が一致を見張る）。
  //
  // 数字の表は、幅 0.6・高さ 1 の枠の中の座標（y は下向き）。文字の高さは文字サイズの 0.7 倍、線の太さは文字の高さの 0.12 倍、
  // 数字の間は文字の高さの 0.2 倍。

  const HEIGHT_RATIO = 0.7;
  const WIDTH_RATIO = 0.12;
  const CELL = 0.6;
  const GAP = 0.2;
  const ARC_STEP = 15;

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  // 楕円の弧の点（角度は度で、0 が右、90 が下）。
  function arc(cx, cy, rx, ry, from, to) {
    const steps = Math.max(2, Math.ceil(Math.abs(to - from) / ARC_STEP));
    const points = [];
    for (let index = 0; index <= steps; index += 1) {
      const angle = ((from + ((to - from) * index) / steps) * Math.PI) / 180;
      points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
    }
    return points;
  }

  // 6 を点対称に回すと 9。
  function turned(strokes) {
    return strokes.map((stroke) => stroke.map(([x, y]) => [CELL - x, 1 - y]));
  }

  function sixStrokes() {
    return [arc(0.3, 0.7, 0.27, 0.27, 0, 360), arc(0.58, 0.7, 0.55, 0.67, 255, 180)];
  }

  // 数字ごとの折れ線の並び。
  const GLYPHS = Object.freeze({
    0: [arc(0.3, 0.5, 0.27, 0.47, 0, 360)],
    1: [[[0.12, 0.2], [0.34, 0.03], [0.34, 0.97]]],
    2: [[...arc(0.3, 0.28, 0.26, 0.25, 195, 380), [0.03, 0.97], [0.58, 0.97]]],
    3: [arc(0.3, 0.27, 0.24, 0.23, 200, 450), arc(0.3, 0.73, 0.27, 0.24, 270, 525)],
    4: [[[0.44, 0.97], [0.44, 0.03], [0.02, 0.7], [0.6, 0.7]]],
    5: [[[0.54, 0.03], [0.12, 0.03], ...arc(0.3, 0.68, 0.27, 0.29, 215, 520)]],
    6: sixStrokes(),
    7: [[[0.02, 0.03], [0.58, 0.03], [0.2, 0.97]]],
    8: [arc(0.3, 0.26, 0.22, 0.23, 0, 360), arc(0.3, 0.72, 0.27, 0.25, 0, 360)],
    9: turned(sixStrokes()),
  });

  // 番号の文字列の大きさ（pt。線の太さを含む）と線の太さ。
  function boxOf(number, fontSize) {
    const digits = String(number).length;
    const height = fontSize * HEIGHT_RATIO;
    const width = height * WIDTH_RATIO;
    const text = height * (digits * CELL + (digits - 1) * GAP);
    return { width: text + width, height: height + width, lineWidth: width, textWidth: text, glyphHeight: height };
  }

  // 番号を、中心 center（紙の座標・y は上向き）に置いた折れ線の並び。{ strokes, lineWidth }。
  function strokesOf(number, fontSize, center) {
    const box = boxOf(number, fontSize);
    const h = box.glyphHeight;
    const left = center[0] - box.textWidth / 2;
    const top = center[1] + h / 2;
    const strokes = [];
    [...String(number)].forEach((digit, index) => {
      const x0 = left + index * (CELL + GAP) * h;
      for (const stroke of GLYPHS[digit])
        strokes.push(stroke.map(([x, y]) => [round(x0 + x * h), round(top - y * h)]));
    });
    return { strokes, lineWidth: round(box.lineWidth) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.markingGlyphs = { HEIGHT_RATIO, WIDTH_RATIO, CELL, GAP, GLYPHS, boxOf, strokesOf };
})(typeof window !== 'undefined' ? window : globalThis);
