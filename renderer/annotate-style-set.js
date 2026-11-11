(function (root) {
  'use strict';

  // 一括（spec-7-2 確定事項D。見本 screenshots/office-color-mock-05.png）。線・塗り・文字の色の組を 1 回で当てる。
  //
  // 図形（四角・丸・閉じた多角形）は線の色と塗りに、テキスト・吹き出しは文字の色・塗り・枠線に当てる（組の文字の色が null なら文字の色は変えない）。
  // 選んでいる書き込みがあれば、当てられるもの全部に当てて 1 世代にする。何も選んでいなければ、道具の次に付ける値にする。
  // ［標準の色に戻す］は種類ごとの既定の色（annotation-presets.js）に戻す。

  function annotate() {
    return root.SigK.annotate;
  }

  function presets() {
    return root.SigK.annotationPresets;
  }

  function style() {
    return root.SigK.shapeStyle;
  }

  function patcher() {
    return root.SigK.annotationStylePatch;
  }

  function isTextKind(kind) {
    return kind === 'text' || kind === 'callout';
  }

  // 種類の既定の組（［標準の色に戻す］）。
  function defaultSetOf(kind) {
    if (isTextKind(kind)) {
      const next = kind === 'callout' ? presets().DEFAULT_CALLOUT_STYLE : { fill: null, border: null };
      return { fill: next.fill, stroke: next.border, text: presets().DEFAULT_COLORS[kind] };
    }
    return { fill: presets().DEFAULT_FILLS.shape, stroke: presets().DEFAULT_COLORS.shape, text: null };
  }

  // 書き込み 1 件に当てる欄の並び（[欄, 値]）。当てる順に並べる（線を戻してから塗りを外す。線と塗りを両方なしにはしない）。
  function fieldsOf(kind, set) {
    if (isTextKind(kind))
      return [...(set.text === null ? [] : [['color', set.text]]), ['fill', set.fill], ['border', set.stroke]];
    return [['color', set.stroke], ['fill', set.fill]];
  }

  // 一括を当てられる種類か（塗りを持てる種類）。書き込みは閉じた多角形まで見る。
  function accepts(entry, kind) {
    if (isTextKind(kind))
      return true;
    return entry === undefined ? style().isFillableKind(kind) : style().canFill(entry);
  }

  // 1 件分の patch。欄ごとの patch を、当てたあとの形に重ねながら作る。変わらなければ null。
  function patchOf(entry, set) {
    const kind = presets().kindOf(entry);
    if (entry.readonly === true || !accepts(entry, kind))
      return null;
    let shaped = entry;
    let merged = null;
    for (const [field, value] of fieldsOf(kind, set)) {
      const patch = patcher().patchFor(field, value, shaped);
      if (patch === null)
        continue;
      merged = { ...(merged ?? {}), ...patch };
      shaped = { ...shaped, ...patch };
    }
    return merged;
  }

  // 次に付ける値として覚える（種類ごと）。
  function rememberNext(kind, set) {
    const next = root.SigK.annotateNextStyle;
    if (isTextKind(kind)) {
      if (set.text !== null)
        next.rememberColor(kind, set.text);
      root.SigK.annotateTextStyle.rememberFor('fill', set.fill, kind);
      root.SigK.annotateTextStyle.rememberFor('border', set.stroke, kind);
      return;
    }
    next.rememberColor(kind, set.stroke);
    next.rememberShape('strokeNone', false);
    next.rememberShape('fills', set.fill);
  }

  function toolKind() {
    const tool = annotate().drawingTool();
    if (tool === null)
      return null;
    return root.SigK.annotateShape?.kindOfTool(tool) ?? tool;
  }

  // 選んでいる書き込みに当てて 1 世代。当てられるものが無ければ false。
  function applyToSelection(setFor) {
    const viewer = root.SigK.viewer;
    const keys = annotate().getSelection();
    const targets = annotate().selectedEntries().filter((entry) => entry.readonly !== true && accepts(entry, presets().kindOf(entry)));
    if (targets.length === 0)
      return false;
    const before = viewer.getAnnotations();
    const { annots, keys: renamed } = root.SigK.annotationBulk.updateEach(before, viewer.getImported(), keys,
      (entry) => patchOf(entry, setFor(presets().kindOf(entry))));
    if (annots !== before) {
      const after = keys.map((key) => renamed.get(key) ?? key);
      const selection = root.SigK.annotationSelection;
      root.SigK.pageEdit.commitAnnots(annots, { annot: { before: selection.annotKeys(keys), after: selection.annotKeys(after) }, gesture: 'styleSet' });
      annotate().selectKeys(after);
    }
    for (const kind of new Set(targets.map((entry) => presets().kindOf(entry))))
      rememberNext(kind, setFor(kind));
    root.SigK.annotationProps?.refresh();
    return true;
  }

  function apply(setFor) {
    if (annotate().selectedEntries().length > 0)
      return applyToSelection(setFor);
    const kind = toolKind();
    if (kind === null || !accepts(undefined, kind))
      return false;
    rememberNext(kind, setFor(kind));
    root.SigK.annotationProps?.refresh();
    return true;
  }

  // 組の番号（annotation-palette.js の STYLE_SETS）を当てる。
  function applySet(index) {
    const set = root.SigK.annotationPalette.STYLE_SETS[index];
    if (set === undefined)
      return false;
    return apply(() => set);
  }

  // ［標準の色に戻す］。
  function resetSet() {
    return apply(defaultSetOf);
  }

  // 今の組の番号（右パネルの一覧の印）。対象がそろって同じ組なら番号、そうでなければ null。targets は annotation-style-patch.js の targetOf の形。
  function currentIndexOf(targets) {
    const sets = root.SigK.annotationPalette.STYLE_SETS;
    const live = (targets ?? []).filter((target) => target !== null && target !== undefined && target.readonly !== true);
    if (live.length === 0)
      return null;
    const indexOf = (target) => sets.findIndex((set) => {
      if (target.kind === 'text' || target.kind === 'callout')
        return target.fill === set.fill && target.border === set.stroke && (set.text === null || target.color === set.text);
      return target.fill === set.fill && target.color === set.stroke;
    });
    const indexes = new Set(live.map(indexOf));
    return indexes.size === 1 && !indexes.has(-1) ? [...indexes][0] : null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateStyleSet = { applySet, resetSet, defaultSetOf, patchOf, currentIndexOf };
})(typeof window !== 'undefined' ? window : globalThis);
