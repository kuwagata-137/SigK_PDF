(function (root) {
  'use strict';

  // 次に付ける見た目（色・塗り・線なし・線種）の置き場（spec-4-1 確定事項34、spec-4b-1b 確定事項22〜25・28）。
  //
  // 道具ごとの「次に付ける値」を持ち、変えたら settings.json に書く。道具を替えても既定に戻さない（決定33 ⑥）。図形（四角・丸・直線・
  // 矢印・×印・多角形）の値は、書き込みツールごとに shape-tool-memory.js に記憶する（決定102 ⑨・質問 SH7 案B。settings.json の
  // annotShapeStyles）。図形以外の色は今までどおり annotColors に書く。塗りと線なしは四角・丸・多角形、線種は四角・丸（実線・破線・
  // 雲形）と直線・矢印（実線・破線。雲形は実線として扱う）に効く。線なしは塗りがあるときだけ。
  // 右パネルから来た値を書き込みに当てるのは annotate-color.js。

  const state = { colors: {} };

  function presets() {
    return root.SigK.annotationPresets;
  }

  function palette() {
    return root.SigK.annotationPalette;
  }

  function style() {
    return root.SigK.shapeStyle;
  }

  function memory() {
    return root.SigK.shapeToolMemory;
  }

  function refresh() {
    root.SigK.annotationProps?.refresh();
  }

  function reset() {
    state.colors = { ...presets().DEFAULT_COLORS };
    memory()?.reset();
  }

  function colorOf(kind) {
    if (memory()?.isShapeKind(kind))
      return memory().get(kind, 'color');
    const key = presets().paletteOf(kind);
    return state.colors[key] ?? presets().DEFAULT_COLORS[key];
  }

  // 塗りは四角・丸・多角形だけ（ほかは null）。多角形は閉じて確定したときだけ当てる（spec-4b-5a 確定事項30）。
  function fillOf(kind) {
    return style().isFillableKind(kind) ? memory().get(kind, 'fill') ?? null : null;
  }

  // 線なしは四角・丸・多角形で、塗りがあるときだけ。
  function strokeNoneOf(kind) {
    return style().isFillableKind(kind) && memory().get(kind, 'strokeNone') === true && fillOf(kind) !== null;
  }

  // 線種はその種類で選べるものだけ（直線・矢印の雲形は実線）。
  function lineStyleOf(kind) {
    const value = memory()?.isShapeKind(kind) ? memory().get(kind, 'lineStyle') : 'solid';
    return style().lineStylesOf(kind).includes(value) ? value : 'solid';
  }

  // 次に描く書き込みの見た目（shape-draft.begin・右パネルへ渡す）。線なしなら color は null。
  // 塗りを持てる種類は、塗りの透明度とハッチング（annotate-fill.js。spec-7-9 確定事項B2・C3）も載せる。
  function nextStyleOf(kind) {
    return { color: strokeNoneOf(kind) ? null : colorOf(kind), fill: fillOf(kind), lineStyle: lineStyleOf(kind), ...root.SigK.annotateFill?.nextFillOf(kind) };
  }

  // 起動時に settings.json から戻す（範囲の外は捨てる）。図形の値は shape-tool-memory.js の apply が戻す。
  function applyColors(colors) {
    for (const tool of presets().TOOLS) {
      const value = palette().normalizeHex(colors?.[tool]);
      if (value !== null)
        state.colors[tool] = value;
    }
    refresh();
    return { ...state.colors };
  }

  // ---- 覚える（settings.json へ） ----

  function rememberColor(kind, color) {
    const value = palette().normalizeHex(color);
    if (memory()?.isShapeKind(kind))
      return value !== null && (memory().set(kind, 'color', value) || memory().get(kind, 'color') === value);
    const key = presets().paletteOf(kind);
    if (value === null || !presets().TOOLS.includes(key))
      return false;
    state.colors[key] = value;
    root.SigK.shell?.persist?.({ annotColors: { [key]: value } });
    return true;
  }

  // 今までの欄の名前 → 図形の書き込みツールごとの記憶の欄。
  const SHAPE_FIELDS = Object.freeze({ fills: 'fill', strokeNone: 'strokeNone', lineStyles: 'lineStyle' });

  // 図形の書き込みツール kind の塗り（fills）・線なし（strokeNone）・線種（lineStyles）を覚える。変わらなければ書かない。
  function rememberShape(field, value, kind) {
    if (memory()?.isShapeKind(kind))
      memory().set(kind, SHAPE_FIELDS[field], value);
  }

  reset();

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateNextStyle = {
    reset,
    colorOf,
    fillOf,
    strokeNoneOf,
    lineStyleOf,
    nextStyleOf,
    getColors: () => ({ ...state.colors }),
    applyColors,
    rememberColor,
    rememberShape,
  };
})(typeof window !== 'undefined' ? window : globalThis);
