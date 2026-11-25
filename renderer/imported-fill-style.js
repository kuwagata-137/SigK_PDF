(function (root) {
  'use strict';

  // 読み込んだ四角・丸・閉じた多角形に、外観から読んだ塗りの不透明度・枠線の不透明度・ハッチングを当てる層（spec-7-9 確定事項B2・C1。
  // 読み戻し）。口の答えの欄は worker/appearance-fill-style.js の fillStyleOf（{ opacity, fillOpacity, hatch } か null）。
  //
  // SigK PDF が塗りと枠線を分けて描いた外観は、辞書の /CA を 1 にして、不透明度を外観の属性に持つ。属性が無いもの（ほかのアプリの
  // PDF・今までのファイル）と、範囲の外の値があるものは、今までどおり辞書の値のまま読む。

  function fill() {
    return root.SigK.fillStyle;
  }

  function hatchOf(raw) {
    if (raw === null || raw === undefined)
      return null;
    const color = root.SigK.importedValues.hexOfComponents(Array.isArray(raw.color) && raw.color.length === 3 ? raw.color : null);
    const hatch = { pattern: raw.pattern, color: color === null ? null : color.toLowerCase(), gap: raw.gap, width: raw.width };
    return fill().validHatch(hatch) ? hatch : undefined;
  }

  function validOpacity(value) {
    return fill().validFillOpacity(value);
  }

  // 1 件に当てる。当てられなければ entry のまま。
  function withFillStyle(entry, fillStyle) {
    if (fillStyle === null || fillStyle === undefined || !root.SigK.shapeStyle.canFill(entry))
      return entry;
    const hatch = hatchOf(fillStyle.hatch);
    if (!validOpacity(fillStyle.opacity) || !validOpacity(fillStyle.fillOpacity) || hatch === undefined)
      return entry;
    const next = { ...entry, opacity: fillStyle.opacity };
    delete next.fillOpacity;
    delete next.hatch;
    if (fillStyle.fillOpacity !== fillStyle.opacity)
      next.fillOpacity = fillStyle.fillOpacity;
    if (hatch !== null)
      next.hatch = hatch;
    return next;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.importedFillStyle = { withFillStyle };
})(typeof window !== 'undefined' ? window : globalThis);
