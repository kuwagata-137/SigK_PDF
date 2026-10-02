(function (root) {
  'use strict';

  // テキストの箱の組み立ての純粋層（spec-4-2 確定事項11〜14・20、spec-4b-4a 確定事項B・C）。DOM には触れない
  // （字や行の幅は外から受ける。画面では free-text-shape.js の advanceOf・measure）。
  //
  // 今までの形（width を持たない）は折り返さず、箱は最長行に合わせて広がる。新しい形（width が 'auto' か数）は 1 字ずつ折り返し
  // （free-text-wrap.js）、中身の幅は自動なら最長行・固定なら width。箱 ＝ 中身＋余白（＋斜体の分）。

  // 自動の幅は全角 12 字（確定事項C2）。塗りか枠線があるときの余白は大きさの 0.3（確定事項B2）。斜体は左右に足す（確定事項B3）。
  const AUTO_CHARS = 12;
  const DECOR_PADDING = 0.3;
  const ITALIC_LEFT = 0.08;
  const ITALIC_RIGHT = 0.25;

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  function wrap() {
    return root.SigK.freeTextWrap;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  // 本文と大きさから箱の大きさ（表示の向き・pt）。今までの形。widthOf(line) は 1 行の幅（pt）。
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

  // 余白（pt）。飾りが無ければ 2、塗りか枠線があれば max(2, 大きさ×0.3 を四捨五入)＋枠線の太さ（枠線は箱の内側）。
  function paddingOf(entry) {
    const border = (entry.borderColor ?? null) !== null;
    if (!border && (entry.fill ?? null) === null)
      return geometry().PADDING;
    const base = Math.max(geometry().PADDING, Math.round(entry.fontSize * DECOR_PADDING));
    return base + (border && Number.isFinite(entry.borderWidth) ? entry.borderWidth : 0);
  }

  // 箱の内側の寸法。left・top は箱の左上から中身の左上まで、horizontal・vertical は左右・上下の和。どれも 0.01pt に丸める
  // （箱の幅＝中身の幅＋horizontal を 0.01pt の刻みに収め、開き直したときに固定の幅を同じ値で読み戻せるように。確定事項J3）。
  function insetOf(entry) {
    const padding = round(paddingOf(entry));
    const left = entry.italic === true ? round(entry.fontSize * ITALIC_LEFT) : 0;
    const right = entry.italic === true ? round(entry.fontSize * ITALIC_RIGHT) : 0;
    return { padding, left: round(padding + left), top: padding, horizontal: round(padding * 2 + left + right), vertical: round(padding * 2) };
  }

  // 自動の幅（確定事項C2）。pageLength は文字の向きに沿った紙の長さ（pt）。分からなければ 12 字。下限は 1 字。
  function autoWidthOf(entry, pageLength = null) {
    const full = entry.fontSize * AUTO_CHARS;
    const room = Number.isFinite(pageLength) ? pageLength - insetOf(entry).horizontal : full;
    return Math.max(entry.fontSize, Math.min(full, room));
  }

  // 折り返しの幅（pt）。固定の下限は 1 字（確定事項C3）。今までの形は null（折り返さない）。
  function wrapWidthOf(entry, pageLength = null) {
    if (entry.width === undefined)
      return null;
    return entry.width === 'auto' ? autoWidthOf(entry, pageLength) : Math.max(entry.fontSize, entry.width);
  }

  // 行と箱（確定事項B1・B4）。advanceOf(unit) は字の送り幅（em。太字なら Bold で測ったもの）、lineWidthOf(line) は今までの形の
  // 1 行の幅（pt）。戻り値は { lines, inset（insetOf）, contentWidth, size（表示の向き・pt） }。
  function layoutOf(entry, { advanceOf, lineWidthOf, pageLength = null }) {
    const { fontSize } = entry;
    if (entry.width === undefined) {
      const lines = geometry().linesOf(entry.text);
      const size = geometry().boxOfLines(lines, fontSize, lineWidthOf);
      return { lines, inset: insetOf({ fontSize }), contentWidth: round(size.width - geometry().PADDING * 2), size };
    }
    const advance = (unit) => advanceOf(unit) * fontSize;
    const lines = wrap().wrapLines(entry.text, wrapWidthOf(entry, pageLength), advance);
    const longest = lines.reduce((max, line) => Math.max(max, wrap().widthOf(line, advance)), 0);
    const contentWidth = entry.width === 'auto' ? longest : Math.max(fontSize, entry.width);
    const inset = insetOf(entry);
    const rows = Math.max(1, lines.length);
    return {
      lines,
      inset,
      contentWidth: round(contentWidth),
      size: { width: round(contentWidth + inset.horizontal), height: round(rows * fontSize * geometry().LINE_HEIGHT + inset.vertical) },
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextLayout = {
    AUTO_CHARS, DECOR_PADDING, ITALIC_LEFT, ITALIC_RIGHT,
    boxOf, frameOf, fitOrigin, paddingOf, insetOf, autoWidthOf, wrapWidthOf, layoutOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
