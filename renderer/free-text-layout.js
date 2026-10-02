(function (root) {
  'use strict';

  // テキストの箱の組み立ての純粋層（spec-4-2 確定事項11〜14・20、spec-4b-4a 確定事項B）。DOM には触れない
  // （1 行の幅は widthOf として外から受ける。画面では free-text-shape.js の measure）。
  // annotate-text.js から箱の大きさ・四隅・紙の中への寄せ方を移した（spec-4b-4a。中身は変えていない）。

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  // 本文と大きさから箱の大きさ（表示の向き・pt）。widthOf(line) は 1 行の幅（pt）。
  function boxOf(text, fontSize, widthOf) {
    return geometry().boxOfLines(geometry().linesOf(text), fontSize, widthOf);
  }

  // 箱の四隅と四角。origin は表示の左上（紙の座標）。
  function frameOf(origin, size, rotation) {
    const rect = geometry().rectFromOrigin(origin, size, rotation);
    return { rect, quads: [geometry().quadOfRect(rect)] };
  }

  // 右端・下端をはみ出す箱は紙の中へ寄せる（spec-4-2 起草者判断）。viewport が無ければそのまま。
  function fitOrigin(origin, size, viewport) {
    if (viewport === undefined || viewport === null)
      return origin;
    const scale = viewport.scale ?? 1;
    const [x, y] = viewport.convertToViewportPoint(origin[0], origin[1]);
    const fx = Math.max(0, Math.min(x, viewport.width - size.width * scale));
    const fy = Math.max(0, Math.min(y, viewport.height - size.height * scale));
    if (fx === x && fy === y)
      return origin;
    return viewport.convertToPdfPoint(fx, fy).map((value) => Math.round(value * 100) / 100);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextLayout = { boxOf, frameOf, fitOrigin };
})(typeof window !== 'undefined' ? window : globalThis);
