(function (root) {
  'use strict';

  // 線の太さと不透明度のスライダーの下見（spec-4b-1b 確定事項8）と、つまみ・回転の行の形の下見（spec-4b-2 確定事項20・38。
  // updateShape。確定は annotate-transform.js が持つ）。
  //
  // 書き込みを選んでいてスライダーを動かしている間（input）は、その書き込みを下見の値で描き直す（履歴に積まない）。離したとき
  // （change）と数値欄の確定は commit で、annotate-shape.setLineWidth・annotate-opacity.setOpacity が 1 世代積む。下見の途中で
  // Esc・選択の変更・別の欄の操作があれば cancel で捨てる。何も選んでいなければ下見は無く、commit は次に付ける値を覚えるだけ。
  // 描くときは page-render.js が previewFor で差し替える（選択の枠も下見の箱に付いてくる）。

  const FIELDS = Object.freeze(['lineWidth', 'opacity']);

  // { field, key, value }。下見が無ければ null。
  let preview = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function redraw() {
    root.SigK.viewer?.redrawAnnotations();
  }

  function keyOf(entry) {
    return entry.ref ?? entry.id;
  }

  // スライダーを動かしている間。選んでいる書き込みが無いか、表示のみなら下見はしない。
  function update(field, value) {
    const entry = annotate()?.selectedEntry() ?? null;
    if (!FIELDS.includes(field) || !Number.isFinite(value) || entry === null || entry.readonly === true)
      return false;
    preview = { field, key: keyOf(entry), value };
    redraw();
    return true;
  }

  // つまみや回転の行を動かしている間の形（spec-4b-2 確定事項20・38）。patch は rect・quads・paths・angle（updateAnnot に渡すもの）。
  function updateShape(key, patch) {
    if (typeof key !== 'string' || patch === null || typeof patch !== 'object')
      return false;
    preview = { field: 'shape', key, patch };
    redraw();
    return true;
  }

  // 描く entry。下見の書き込みなら下見の値に差し替える（太さは /Rect も作り直す。直線・矢印・ペンは箱が線幅で変わる）。
  function previewFor(entry) {
    if (preview === null || keyOf(entry) !== preview.key)
      return entry;
    if (preview.field === 'shape') {
      const shaped = { ...entry, ...preview.patch };
      if (shaped.angle === 0)
        delete shaped.angle;
      return shaped;
    }
    if (preview.field === 'opacity')
      return { ...entry, opacity: preview.value };
    const shape = root.SigK.shapeGeometry.rectOfShape({ kind: entry.kind, rect: entry.rect, paths: entry.paths, lineWidth: preview.value, angle: entry.angle });
    return { ...entry, lineWidth: preview.value, ...shape };
  }

  // 離したとき・数値欄の確定。下見を捨ててから値を当てる（当てた結果が同じ値で積まれなくても、下見の絵は消す）。
  function commit(field, value) {
    const active = preview !== null;
    preview = null;
    const done = field === 'opacity' ? annotate().setOpacity(value) : annotate().setLineWidth(value);
    if (active)
      redraw();
    return done;
  }

  function cancel() {
    if (preview === null)
      return false;
    preview = null;
    redraw();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotatePreview = { FIELDS, update, updateShape, previewFor, commit, cancel, isActive: () => preview !== null };
})(typeof window !== 'undefined' ? window : globalThis);
