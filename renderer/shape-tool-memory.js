(function (root) {
  'use strict';

  // 図形の書き込みツールごとの、次に追加する書き込みの値（docs/spec-7-10-shape-tools.md。決定102 ⑨・質問 SH7 案B）。
  //
  // 四角・丸・直線・矢印・×印・多角形の 6 つの書き込みツールごとに、線の色・塗りつぶし・枠線のあり・なし・線種・線の太さ・透明度・
  // 塗りの透明度・ハッチングを記憶する（丸に切り替えると、丸で前に使った値に戻る）。版 1.4.0 までは 6 つで 1 つの値を共有していた。
  // settings.json の annotShapeStyles に書く（既定と検証は shape-style-settings.js）。ペン・マーカー・マーキングの値は今までどおり別に記憶する。
  // 読み出しと記憶は、annotate-next-style.js（色・塗りつぶし・枠線のあり・なし・線種）、annotate-shape-kind.js（線の太さ）、
  // annotate-opacity.js（透明度）、annotate-fill.js（塗りの透明度・ハッチング）が、図形の種類の時にここへ委ねる。

  const FIELDS = Object.freeze(['color', 'fill', 'strokeNone', 'lineStyle', 'lineWidth', 'opacity', 'fillOpacity', 'hatch']);
  const HATCH_FIELDS = Object.freeze(['pattern', 'color', 'gap', 'width']);

  let state = null;

  function presets() {
    return root.SigK.annotationPresets;
  }

  function isShapeKind(kind) {
    return presets().isShapeKind(kind);
  }

  // 既定（shape-style-settings.js の DEFAULT_SHAPE_STYLE と同じ）。
  function defaultStyle() {
    return {
      color: presets().DEFAULT_COLORS.shape, fill: null, strokeNone: false, lineStyle: 'solid', lineWidth: presets().DEFAULT_LINE_WIDTH,
      opacity: presets().DEFAULT_OPACITY, fillOpacity: 1, hatch: { pattern: 'none', color: '#ff0000', gap: 6, width: 1 },
    };
  }

  function reset() {
    state = Object.fromEntries(presets().SHAPE_KINDS.map((kind) => [kind, defaultStyle()]));
  }

  function ensure() {
    if (state === null)
      reset();
    return state;
  }

  // 欄ごとに受け取れる値か（メインで検証済みの値を受けるので、形だけを見る）。
  const VALID = Object.freeze({
    color: (value) => root.SigK.shapeStyle.isHexColor(value),
    fill: (value) => value === null || root.SigK.shapeStyle.isHexColor(value),
    strokeNone: (value) => typeof value === 'boolean',
    lineStyle: (value) => root.SigK.shapeStyle.LINE_STYLES.includes(value),
    lineWidth: (value) => presets().isLineWidth(value),
    opacity: (value) => presets().isOpacity(value),
    fillOpacity: (value) => presets().isOpacity(value),
  });

  function validHatchField(field, value) {
    const probe = { ...root.SigK.fillStyle.DEFAULT_HATCH, [field]: value };
    return field === 'pattern' ? value === 'none' || root.SigK.fillStyle.validHatch(probe) : root.SigK.fillStyle.validHatch(probe);
  }

  function get(kind, field) {
    const style = ensure()[kind];
    if (style === undefined)
      return undefined;
    return field === 'hatch' ? { ...style.hatch } : style[field];
  }

  function persist(kind, patch) {
    root.SigK.shell?.persist?.({ annotShapeStyles: { [kind]: patch } });
  }

  // 1 つの欄を記憶する。変わらなければ書かない。記憶したら true。
  function set(kind, field, value) {
    const style = ensure()[kind];
    if (style === undefined || field === 'hatch' || VALID[field]?.(value) !== true)
      return false;
    const stored = typeof value === 'string' ? value.toLowerCase() : value;
    if (style[field] === stored)
      return false;
    style[field] = stored;
    persist(kind, { [field]: stored });
    return true;
  }

  // ハッチングの記憶の一部（{ pattern }・{ color }・{ gap }・{ width }）を重ねる。
  function setHatch(kind, partial) {
    const style = ensure()[kind];
    if (style === undefined || typeof partial !== 'object' || partial === null)
      return false;
    const picked = Object.fromEntries(Object.entries(partial)
      .filter(([field, value]) => HATCH_FIELDS.includes(field) && validHatchField(field, value))
      .map(([field, value]) => [field, typeof value === 'string' ? value.toLowerCase() : value]));
    if (Object.keys(picked).every((field) => style.hatch[field] === picked[field]))
      return false;
    style.hatch = { ...style.hatch, ...picked };
    persist(kind, { hatch: picked });
    return true;
  }

  // 版 1.4.0 までの共有の値（settings.json の ui）。メインが annotShapeStyles を渡さない時（試験の起動など）に転記する。
  function legacyOf(ui) {
    return {
      color: ui?.annotColors?.shape, fill: ui?.annotFills?.shape, strokeNone: ui?.annotStrokeNone?.shape, lineStyle: ui?.annotLineStyles?.shape,
      lineWidth: ui?.annotLineWidth, opacity: ui?.annotOpacity?.shape, fillOpacity: ui?.annotFillOpacity?.shape, hatch: ui?.annotHatch?.shape,
    };
  }

  function applyKind(style, source, legacy) {
    for (const field of FIELDS.filter((each) => each !== 'hatch')) {
      const value = [source?.[field], legacy[field]].find((each) => each !== undefined && VALID[field](each));
      if (value !== undefined)
        style[field] = typeof value === 'string' ? value.toLowerCase() : value;
    }
    for (const field of HATCH_FIELDS) {
      const value = [source?.hatch?.[field], legacy.hatch?.[field]].find((each) => each !== undefined && validHatchField(field, each));
      if (value !== undefined)
        style.hatch[field] = typeof value === 'string' ? value.toLowerCase() : value;
    }
    if (style.fill === null)
      style.strokeNone = false;
  }

  // 起動時に settings.json の ui から戻す。種類の値が無い欄は、共有の値を転記する。
  function apply(ui) {
    reset();
    const legacy = legacyOf(ui);
    for (const kind of presets().SHAPE_KINDS)
      applyKind(state[kind], ui?.annotShapeStyles?.[kind], legacy);
    root.SigK.annotationProps?.refresh();
    return JSON.parse(JSON.stringify(state));
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeToolMemory = { FIELDS, isShapeKind, get, set, setHatch, apply, reset, styles: () => JSON.parse(JSON.stringify(ensure())) };
})(typeof window !== 'undefined' ? window : globalThis);
