(function (root) {
  'use strict';

  // 編集モードの「いまの道具」と「次に付ける文字の大きさ」（spec-4-1 確定事項1・8・10・33・34、spec-4-2 確定事項1・3・21・34）。
  //
  // 300 行に近づいた annotate.js から移した（spec-4b-3a。中身は変えていない）。annotate.js は同じ名前の口でここへ委ねる。

  // プリセット（確定事項33、spec-4-2 確定事項34・35、spec-4-3 確定事項27〜29）は annotation-presets.js が持つ。
  const { TOOLS, MARKUP_TOOLS, DEFAULT_FONT_SIZE, isFontSize } = root.SigK.annotationPresets;

  const state = {
    doc: null,
    tool: null,
    fontSize: DEFAULT_FONT_SIZE,
  };

  function props() {
    return root.SigK.annotationProps;
  }

  function inAnnotMode() {
    return state.doc?.documentElement.getAttribute('data-mode') === 'annot';
  }

  function isOpen() {
    return root.SigK.viewer?.getState().open === true;
  }

  function syncTools() {
    if (state.doc === null)
      return;
    // 道具の段の押している印（spec-4b-1a 確定事項1〜5。edit-bar.js）。図形は種類まで見る。
    root.SigK.editBar?.sync(state.tool, root.SigK.annotateShape?.getShapeKind() ?? null);
    // CSS がカーソルを変えるための印（テキストの道具で紙の上は text。spec-4-2 確定事項1）。
    if (state.tool === null)
      state.doc.documentElement.removeAttribute('data-tool');
    else
      state.doc.documentElement.setAttribute('data-tool', state.tool);
    props()?.refresh();
  }

  function isMarkupTool(tool) {
    return MARKUP_TOOLS.includes(tool);
  }

  function setTool(tool) {
    state.tool = TOOLS.includes(tool) ? tool : null;
    if (state.tool === 'text')
      root.SigK.freeTextShape?.ensureLoaded(state.doc);
    syncTools();
    return state.tool;
  }

  // 文字の選択からマークアップを作る（確定事項10〜14。annotate-markup.js）。
  function createFromSelection(kind) {
    return root.SigK.annotateMarkup?.createFromSelection(kind) === true;
  }

  // 道具はトグル。マークアップは、押した時点で文字が選ばれていればその場で付ける
  // （確定事項10 ②）。テキストは押しても作らない（spec-4-2 確定事項3）。
  function toggleTool(tool) {
    if (!TOOLS.includes(tool))
      return false;
    if (MARKUP_TOOLS.includes(tool) && inAnnotMode() && isOpen() && createFromSelection(tool))
      return setTool(tool) !== null;
    return setTool(state.tool === tool ? null : tool) !== null;
  }

  // 次に置くテキストの文字の大きさ（spec-4-2 確定事項21・34）。
  function getFontSize() {
    return state.fontSize;
  }

  function applyFontSize(size) {
    if (isFontSize(size))
      state.fontSize = size;
    props()?.refresh();
    return state.fontSize;
  }

  function rememberFontSize(size) {
    if (!isFontSize(size))
      return false;
    state.fontSize = size;
    root.SigK.shell?.persist?.({ annotFontSize: size });
    return true;
  }

  function init(doc) {
    state.doc = doc;
    syncTools();
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateTools = {
    init,
    getTool: () => state.tool,
    syncTools,
    setTool,
    toggleTool,
    isMarkupTool,
    createFromSelection,
    getFontSize,
    applyFontSize,
    rememberFontSize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
