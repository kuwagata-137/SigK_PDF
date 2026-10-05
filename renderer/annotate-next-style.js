(function (root) {
  'use strict';

  // 次に付ける見た目（色・塗り・線なし・線種）の置き場（spec-4-1 確定事項34、spec-4b-1b 確定事項22〜25・28）。
  //
  // 道具ごとの「次に付ける値」を持ち、起動時に settings.json（annotColors・annotFills・annotStrokeNone・annotLineStyles）から戻し、
  // 変えたら書く。道具を替えても既定に戻さない（決定33 ⑥）。塗り・線なし・線種は図形の道具（shape）だけが持ち、塗りと線なしは
  // 四角・丸、線種は四角・丸（実線・破線・雲形）と直線・矢印（実線・破線。雲形は実線として扱う）に効く。線なしは塗りがあるときだけ。
  // 右パネルから来た値を書き込みに当てるのは annotate-color.js。

  const state = { colors: {}, fills: {}, strokeNone: {}, lineStyles: {} };

  function presets() {
    return root.SigK.annotationPresets;
  }

  function palette() {
    return root.SigK.annotationPalette;
  }

  function style() {
    return root.SigK.shapeStyle;
  }

  function refresh() {
    root.SigK.annotationProps?.refresh();
  }

  function reset() {
    state.colors = { ...presets().DEFAULT_COLORS };
    state.fills = { ...presets().DEFAULT_FILLS };
    state.strokeNone = { ...presets().DEFAULT_STROKE_NONE };
    state.lineStyles = { ...presets().DEFAULT_LINE_STYLES };
  }

  function colorOf(kind) {
    const key = presets().paletteOf(kind);
    return state.colors[key] ?? presets().DEFAULT_COLORS[key];
  }

  // 塗りは四角・丸・多角形だけ（ほかは null）。多角形は閉じて確定したときだけ当てる（spec-4b-5a 確定事項30）。
  function fillOf(kind) {
    return style().isFillableKind(kind) ? state.fills.shape ?? null : null;
  }

  // 線なしは四角・丸・多角形で、塗りがあるときだけ。
  function strokeNoneOf(kind) {
    return style().isFillableKind(kind) && state.strokeNone.shape === true && fillOf(kind) !== null;
  }

  // 線種はその種類で選べるものだけ（直線・矢印の雲形は実線）。
  function lineStyleOf(kind) {
    const value = state.lineStyles.shape ?? 'solid';
    return style().lineStylesOf(kind).includes(value) ? value : 'solid';
  }

  // 次に描く書き込みの見た目（shape-draft.begin・右パネルへ渡す）。線なしなら color は null。
  function nextStyleOf(kind) {
    return { color: strokeNoneOf(kind) ? null : colorOf(kind), fill: fillOf(kind), lineStyle: lineStyleOf(kind) };
  }

  // ---- 起動時に settings.json から戻す（範囲の外は捨てる） ----

  function applyColors(colors) {
    for (const tool of presets().TOOLS) {
      const value = palette().normalizeHex(colors?.[tool]);
      if (value !== null)
        state.colors[tool] = value;
    }
    refresh();
    return { ...state.colors };
  }

  function applyFills(fills) {
    const value = fills?.shape;
    if (value === null || palette().isHexColor(value))
      state.fills.shape = value === null ? null : palette().normalizeHex(value);
    refresh();
    return { ...state.fills };
  }

  function applyStrokeNone(values) {
    if (typeof values?.shape === 'boolean')
      state.strokeNone.shape = values.shape;
    refresh();
    return { ...state.strokeNone };
  }

  function applyLineStyles(lineStyles) {
    if (style().LINE_STYLES.includes(lineStyles?.shape))
      state.lineStyles.shape = lineStyles.shape;
    refresh();
    return { ...state.lineStyles };
  }

  // ---- 覚える（settings.json へ） ----

  function rememberColor(kind, color) {
    const value = palette().normalizeHex(color);
    const key = presets().paletteOf(kind);
    if (value === null || !presets().TOOLS.includes(key))
      return false;
    state.colors[key] = value;
    root.SigK.shell?.persist?.({ annotColors: { [key]: value } });
    return true;
  }

  const SHAPE_KEYS = Object.freeze({ fills: 'annotFills', strokeNone: 'annotStrokeNone', lineStyles: 'annotLineStyles' });

  // 図形の道具の塗り（fills）・線なし（strokeNone）・線種（lineStyles）を覚える。変わらなければ書かない。
  function rememberShape(field, value) {
    if (state[field].shape === value)
      return;
    state[field].shape = value;
    root.SigK.shell?.persist?.({ [SHAPE_KEYS[field]]: { shape: value } });
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
    applyFills,
    applyStrokeNone,
    applyLineStyles,
    rememberColor,
    rememberShape,
  };
})(typeof window !== 'undefined' ? window : globalThis);
