(function (root) {
  'use strict';

  // 塗りの透明度とハッチングの指揮と、次に追加する書き込みの値（spec-7-9 確定事項B2・C3）。
  //
  // プロパティパネルの塗りの見出しの行（塗りの透明度・ハッチング・ハッチング色・ハッチング間隔・ハッチング線幅）から来た値を、選択中の
  // 書き込みに当てて 1 世代積むか、選択していなければ図形の書き込みツールの「次に追加する書き込みの値」として記憶する。記憶は書き込み
  // ツール（四角・丸・多角形）ごとで、shape-tool-memory.js に置く（決定102 ⑨・質問 SH7 案B。settings.json の annotShapeStyles）。
  // 2 件以上を選択していれば、塗りを持てる全部に当てる（annotate-bulk.js）。当てる値と比べ方は annotation-style-patch.js。

  const DEFAULT_MEMO = Object.freeze({ pattern: 'none', color: '#ff0000', gap: 6, width: 1 });

  function annotate() {
    return root.SigK.annotate;
  }

  function fill() {
    return root.SigK.fillStyle;
  }

  function style() {
    return root.SigK.shapeStyle;
  }

  function refresh() {
    root.SigK.annotationProps?.refresh();
  }

  function memory() {
    return root.SigK.shapeToolMemory;
  }

  // ---- 次に追加する書き込みの値 ----

  // 次に追加する書き込みの塗りの欄（塗りを持てる種類だけ。ハッチングはなしなら null）。
  function nextFillOf(kind) {
    if (!style().isFillableKind(kind))
      return {};
    const { pattern, color, gap, width } = hatchMemo(kind);
    return { fillOpacity: memory().get(kind, 'fillOpacity'), hatch: pattern === 'none' ? null : { pattern, color, gap, width } };
  }

  // 今がなしの書き込みにハッチングの種類を当てる時に使う、書き込みツール kind の色・間隔・線幅の記憶。
  function hatchMemo(kind) {
    return memory()?.isShapeKind(kind) ? memory().get(kind, 'hatch') : { ...DEFAULT_MEMO };
  }

  function validPartial(partial) {
    if (typeof partial !== 'object' || partial === null)
      return false;
    const probe = { ...fill().DEFAULT_HATCH, ...partial, pattern: partial.pattern === 'none' ? 'diagonal' : partial.pattern ?? 'diagonal' };
    return Object.keys(partial).length > 0 && Object.keys(partial).every((key) => key in DEFAULT_MEMO) && fill().validHatch(probe);
  }

  // 書き込みツール kind の塗りの透明度とハッチングを記憶する（塗りを持てる種類だけ。変わらなければ書かない）。
  function rememberFillOpacity(value, kind) {
    if (style().isFillableKind(kind))
      memory().set(kind, 'fillOpacity', value);
  }

  function rememberHatch(partial, kind) {
    if (style().isFillableKind(kind))
      memory().setHatch(kind, partial);
  }

  // ---- 当てる ----

  // いまの書き込みツールが描く種類（図形は編集ツールバーで選んだ種類）。描く書き込みツールが無ければ null。
  function toolKind() {
    const tool = annotate().drawingTool();
    if (tool === null)
      return null;
    return root.SigK.annotateShape?.kindOfTool(tool) ?? tool;
  }

  // 選択中の 1 件に当てて 1 世代積む（同じ欄を続けて変えたら 1 世代に畳む）。読み込んだものは写しに変わり、選択はその写しへ移す。
  function updateSelected(entry, field, value) {
    const patch = root.SigK.annotationStylePatch.patchFor(field, value, entry);
    if (patch === null)
      return;
    const annots = root.SigK.viewer.getAnnotations();
    const changed = root.SigK.annotationState.updateAnnot(annots, entry, patch);
    if (changed === annots)
      return;
    const before = annotate().getSelected();
    const after = entry.ref !== undefined ? changed.added.at(-1).id : before;
    root.SigK.pageEdit.commitAnnots(changed, { annot: { before, after }, gesture: gestureOf(field, value) });
    annotate().select(after);
  }

  // 続けて変えたら 1 世代に畳む時の欄の名前。ハッチングは種類・色・間隔・線幅を別の欄として扱う（種類を選んでから間隔を変えた時に、
  // Ctrl+Z で間隔だけが戻るように）。
  function gestureOf(field, value) {
    return field === 'hatch' ? `hatch.${Object.keys(value)[0]}` : field;
  }

  // 1 件か、書き込みツールの次の値か、複数か。当てられる相手が無ければ false。
  function apply(field, value, remember) {
    if (annotate().getSelection().length > 1)
      return root.SigK.annotateBulk.applyField(field, value);
    const entry = annotate().selectedEntry();
    if (entry === null) {
      if (!style().isFillableKind(toolKind()))
        return false;
      remember(value, toolKind());
      refresh();
      return true;
    }
    if (entry.readonly === true || !style().canFill(entry))
      return false;
    updateSelected(entry, field, value);
    remember(value, root.SigK.annotationPresets.kindOf(entry));
    refresh();
    return true;
  }

  // 塗りの透明度の行（不透明度 0.1〜1）から。
  function setFillOpacity(value) {
    if (!fill().validFillOpacity(value) || value < 0.1)
      return false;
    return apply('fillOpacity', value, rememberFillOpacity);
  }

  // ハッチングの行から。partial は { pattern }（'none' はなし）・{ color }・{ gap }・{ width } のどれか。
  function setHatch(partial) {
    if (!validPartial(partial))
      return false;
    return apply('hatch', partial, rememberHatch);
  }

  function reset() {
    memory()?.reset();
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateFill = {
    DEFAULT_MEMO,
    nextFillOf,
    hatchMemo,
    rememberFillOpacity,
    rememberHatch,
    setFillOpacity,
    setHatch,
    gestureOf,
    reset,
  };
})(typeof window !== 'undefined' ? window : globalThis);
