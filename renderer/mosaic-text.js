(function (root) {
  'use strict';

  // モザイクの範囲に重なる文字を、選択・コピー・検索の対象から外す（spec-4b-6b 確定事項9。決定66 ③。事前調査 K）。DOM にも pdf.js にも触れない。
  //
  // pdf.js の getTextContent の項目（ふつう 1 行が 1 つ）のうち、範囲に重なるものの文字を空にした写しを返す。項目は消さない。
  // 文字の層の span と項目の 1 対 1（検索のハイライト・マーカーの四角が頼っている）を崩さないためである。
  //
  // 項目の四角は transform（文字の向きの行列。e・f が書き始めの点）と幅・高さから作る。pdf.js は横書きなら width に送りの長さ・
  // height に文字の大きさを、縦書き（styles[fontName].vertical）なら width に文字の大きさ・height に送りの長さを入れる。
  // 重なりを取りこぼさないよう、横書きは下へ文字の大きさの 1/4（ディセンダー）、縦書きは左右と上下に文字の大きさの半分を足す。

  function unit(x, y) {
    const length = Math.hypot(x, y);
    return length > 0 ? [x / length, y / length] : [0, 0];
  }

  // 項目の外接の四角 [x1, y1, x2, y2]（紙の座標）。読めなければ null。
  function boundsOf(item, vertical) {
    const t = item?.transform;
    if (!Array.isArray(t) || t.length < 6 || !t.every(Number.isFinite))
      return null;
    const u = unit(t[0], t[1]);
    const v = unit(t[2], t[3]);
    const width = Number(item.width) || 0;
    const height = Number(item.height) || 0;
    // [u の向きの始まり, 終わり, v の向きの始まり, 終わり]
    const [u1, u2, v1, v2] = vertical
      ? [-width, width, -(height + width / 2), width / 2]
      : [0, width, -height / 4, height];
    const corners = [[u1, v1], [u2, v1], [u1, v2], [u2, v2]].map(([a, b]) => [t[4] + u[0] * a + v[0] * b, t[5] + u[1] * a + v[1] * b]);
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  function overlaps(a, b) {
    return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  }

  // 範囲に重なる項目の文字を空にした写し。mosaic が無ければ items をそのまま返す。styles は getTextContent の styles。
  function blankItems(items, mosaic, styles = {}) {
    if (!Array.isArray(items) || !Array.isArray(mosaic) || mosaic.length === 0)
      return items;
    const boxes = mosaic.map((entry) => entry?.box).filter((box) => Array.isArray(box) && box.length === 4);
    return items.map((item) => {
      if (typeof item?.str !== 'string' || item.str === '')
        return item;
      const bounds = boundsOf(item, styles?.[item.fontName]?.vertical === true);
      return bounds !== null && boxes.some((box) => overlaps(bounds, box)) ? { ...item, str: '' } : item;
    });
  }

  // getTextContent の結果（{ items, styles, ... }）へ当てた写し。
  function blankContent(content, mosaic) {
    if (!Array.isArray(content?.items) || !Array.isArray(mosaic) || mosaic.length === 0)
      return content;
    return { ...content, items: blankItems(content.items, mosaic, content.styles) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.mosaicText = { boundsOf, blankItems, blankContent };
})(typeof window !== 'undefined' ? window : globalThis);
