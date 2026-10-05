(function (root) {
  'use strict';

  // 編集モードの「いまの道具」と「次に付ける文字の大きさ」（spec-4-1 確定事項1・8・10・33・34、spec-4-2 確定事項1・3・21・34）。
  //
  // 300 行に近づいた annotate.js から移した（spec-4b-3a）。annotate.js は同じ名前の口でここへ委ねる。描かない道具の「選択」
  // （spec-4b-3a 確定事項C）と「ハンド」、左＋右で戻る先（spec-4b-3b 確定事項B。判断は tool-switch.js）もここで持つ。

  // プリセット（確定事項33、spec-4-2 確定事項34・35、spec-4-3 確定事項27〜29）は annotation-presets.js が持つ。
  const { TOOLS, MARKUP_TOOLS, DEFAULT_FONT_SIZE, isFontSize } = root.SigK.annotationPresets;

  // 書き込みを描かない道具（spec-4b-3a 確定事項C3、spec-4b-3b 確定事項A2）。色の既定を持つ描く道具（TOOLS）とは別に持つ。
  // 「選択」は紙のどこから引いても範囲選択になり、「ハンド」は紙のどこを引いても表示が動く。
  const POINTER_TOOLS = Object.freeze(['select', 'hand']);

  const state = {
    doc: null,
    tool: null,
    // 戻り先（最後に持っていた「道具なし」か「選択」。spec-4b-3b 確定事項B1）。左＋右でハンドから戻る先。
    base: null,
    fontSize: DEFAULT_FONT_SIZE,
  };

  function toolSwitch() {
    return root.SigK.toolSwitch;
  }

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

  function isTool(tool) {
    return TOOLS.includes(tool) || POINTER_TOOLS.includes(tool);
  }

  // 描く道具。「選択」など描かない道具を持っているときは null（右パネル・色・不透明度・図形の種類はこちらを見る）。
  function drawingTool() {
    return TOOLS.includes(state.tool) ? state.tool : null;
  }

  function setTool(tool) {
    // 描いている途中の多角形は、道具を替える前に開いたまま確定する（spec-4b-5a 確定事項16）。
    root.SigK.annotatePolygon?.commitPending();
    root.SigK.annotateLineAnchor?.cancel();
    state.tool = isTool(tool) ? tool : null;
    state.base = toolSwitch().remember(state.base, state.tool);
    if (state.tool === 'text' || state.tool === 'callout')
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
    if (!isTool(tool))
      return false;
    if (MARKUP_TOOLS.includes(tool) && inAnnotMode() && isOpen() && createFromSelection(tool))
      return setTool(tool) !== null;
    return setTool(toolSwitch().next({ tool: state.tool, base: state.base }, 'button', tool).tool) !== null;
  }

  // 左＋右で道具を切り替える（spec-4b-3b 確定事項B4・E2）。ハンドからは戻り先へ、ほかからはハンドへ。切り替えた道具を返す。
  function chord() {
    return setTool(toolSwitch().next({ tool: state.tool, base: state.base }, 'chord').tool);
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
    POINTER_TOOLS,
    init,
    getTool: () => state.tool,
    getBase: () => state.base,
    chord,
    drawingTool,
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
