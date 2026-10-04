(function (root) {
  'use strict';

  // 注釈モードの指揮（spec-4-1 確定事項1〜10・15〜19、spec-4-2 確定事項1・7・8・21、spec-4-3 確定事項12・19、
  // spec-4-4 確定事項13・31）。
  //
  // 道具を持つ・選ぶ・消す・色を変える・履歴に積む、をここで結ぶ。状態の純粋な操作は
  // annotation-state.js、描画は annotation-layer.js、読み込んだ注釈を集めるのは
  // annotation-import.js、右のプロパティは annotation-props.js、ページビューの押し離しは
  // annotate-pointer.js、文字の選択からマークアップを作るのは annotate-markup.js、
  // テキストの置く・直す・動かすは annotate-text.js、図形・ペンの描く・動かす・太さは
  // annotate-shape.js、ノートの置く・動かす・本文・作成者は annotate-note.js、不透明度は
  // annotate-opacity.js、色・塗り・線なし・線種は annotate-color.js、スライダーの下見は annotate-preview.js、
  // サイドパネルの一覧は annotation-list.js が持つ。「いまの道具」と「次に付ける文字の大きさ」は annotate-tools.js、
  // 「選んでいる注釈」は annotate-select.js が握り、ここは同じ名前の口で委ねる（spec-4b-3a で分けた）。Esc と取りやめの順は
  // annotate-cancel.js が持つ（spec-4b-3b で分けた）。

  // プリセット（確定事項33、spec-4-2 確定事項34・35、spec-4-3 確定事項27〜29）は annotation-presets.js が持つ。
  const { TOOLS, TOOL_LABELS, DEFAULT_COLORS } = root.SigK.annotationPresets;

  const state = {
    doc: null,
    win: null,
  };

  // 道具と文字の大きさは annotate-tools.js、選んでいる書き込みは annotate-select.js が持つ（spec-4b-3a で分けた）。
  function tools() {
    return root.SigK.annotateTools;
  }

  function selection() {
    return root.SigK.annotateSelect;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function props() {
    return root.SigK.annotationProps;
  }

  function isOpen() {
    return viewer()?.getState().open === true;
  }

  function annotateColor() {
    return root.SigK.annotateColor;
  }

  function nextStyle() {
    return root.SigK.annotateNextStyle;
  }

  // 開いているテキストの入力欄を確定して閉じる（spec-4-2 確定事項8）。
  function finishEditing() {
    return root.SigK.annotateText?.finishEditing() === true;
  }

  // ---- 印刷（確定事項28） ----

  // ページ src の注釈を canvas 2D に描く口。無ければ null。
  function painterFor(src) {
    const view = viewer();
    if (view === undefined || !isOpen() || !Number.isInteger(src))
      return null;
    const entries = annotationState().annotsOnPage(view.getAnnotations(), view.getImported(), src);
    if (entries.length === 0)
      return null;
    return (ctx, viewport) => root.SigK.annotationLayer.paint(ctx, entries, viewport);
  }

  // ---- 画面の結線（ページビューの押し離しは annotate-pointer.js） ----

  // モードを離れたら入力欄を確定し、表示を引くのを終え（spec-4b-3b 確定事項A3）、選択を解除する。道具は持ち越す（確定事項8）。
  // 入ったらフォントを先読みする（spec-4-2 確定事項33）。
  function onModeChanged(mode) {
    root.SigK.annotationMenu?.close();
    if (mode !== 'annot') {
      finishEditing();
      root.SigK.annotateHand?.cancel();
    }
    if (mode !== 'annot' && selection().getSelection().length > 0)
      selection().select(null);
    props()?.refresh();
    if (mode === 'annot') {
      root.SigK.save?.warnIfUnsaveable();
      root.SigK.freeTextShape?.ensureLoaded(state.doc);
    }
    // サイドパネルの一覧は注釈モードのときだけ（spec-4-4 確定事項9）。
    root.SigK.annotationList?.refresh();
  }

  function init(doc, win) {
    if (win.__sigkAnnotateReady === true)
      return false;
    win.__sigkAnnotateReady = true;
    state.doc = doc;
    state.win = win;

    // 道具のボタンの結線は edit-bar.js が持つ（spec-4b-1a 確定事項37）。
    tools().init(doc);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotate = {
    TOOLS,
    TOOL_LABELS,
    DEFAULT_COLORS,
    init,
    importDocument: (doc, options) => root.SigK.annotationImport.importDocument(doc, options),
    getTool: () => tools().getTool(),
    // 描く道具（「選択」を持っているときは null。spec-4b-3a 確定事項C3）。
    drawingTool: () => tools().drawingTool(),
    setTool: (tool) => tools().setTool(tool),
    toggleTool: (tool) => tools().toggleTool(tool),
    isMarkupTool: (tool) => tools().isMarkupTool(tool),
    // 色・塗り・線なし・線種（次に付ける値は annotate-next-style.js、当てるのは annotate-color.js。spec-4b-1b）。
    getColors: () => nextStyle().getColors(),
    colorOf: (kind) => nextStyle().colorOf(kind),
    fillOf: (kind) => nextStyle().fillOf(kind),
    lineStyleOf: (kind) => nextStyle().lineStyleOf(kind),
    nextStyleOf: (kind) => nextStyle().nextStyleOf(kind),
    applyColors: (colors) => nextStyle().applyColors(colors),
    applyFills: (fills) => nextStyle().applyFills(fills),
    applyStrokeNone: (values) => nextStyle().applyStrokeNone(values),
    applyLineStyles: (lineStyles) => nextStyle().applyLineStyles(lineStyles),
    setColor: (color) => annotateColor().setColor(color),
    setStrokeNone: () => annotateColor().setStrokeNone(),
    setFill: (color) => annotateColor().setFill(color),
    setLineStyle: (lineStyle) => annotateColor().setLineStyle(lineStyle),
    getFontSize: () => tools().getFontSize(),
    applyFontSize: (size) => tools().applyFontSize(size),
    rememberFontSize: (size) => tools().rememberFontSize(size),
    setFontSize: (size) => root.SigK.annotateTextStyle?.setFontSize(size) === true,
    // 太字・斜体（spec-4b-4a 確定事項G3）。field は 'bold' か 'italic'。
    setTextFlag: (field, value) => root.SigK.annotateTextStyle?.setTextFlag(field, value) === true,
    // テキストの枠線の色（spec-4b-4a 確定事項G4）。null は枠線なし。
    setBorder: (color) => root.SigK.annotateTextStyle?.setBorder(color) === true,
    // key が 'callout' なら吹き出しの次に付ける書式（spec-4b-4b 確定事項G4）。
    getTextStyle: (key) => root.SigK.annotateTextStyle?.getNextStyle(key) ?? { bold: false, italic: false },
    setLineWidth: (width) => root.SigK.annotateShape?.setLineWidth(width) === true,
    setShapeKind: (kind) => root.SigK.annotateShape?.setShapeKind(kind) === true,
    getLineWidth: () => root.SigK.annotateShape?.getLineWidth(),
    getShapeKind: () => root.SigK.annotateShape?.getShapeKind(),
    // 不透明度・本文・作成者（spec-4-4）。
    setOpacity: (value) => root.SigK.annotateOpacity?.setOpacity(value) === true,
    getOpacity: (kind) => root.SigK.annotateOpacity?.opacityOf(kind) ?? 1,
    setContents: (text) => root.SigK.annotateNote?.setContents(text) === true,
    setAuthor: (author) => root.SigK.annotateNote?.setAuthor(author) === true,
    getAuthor: () => root.SigK.annotateNote?.getAuthor() ?? '',
    // Enter・ダブルクリック: テキストは入力欄、ノートは「本文」欄。
    editSelected: () => root.SigK.annotateText?.editSelected() === true || root.SigK.annotateNote?.editSelected() === true,
    finishEditing,
    createFromSelection: (kind) => tools().createFromSelection(kind),
    // 選択（spec-4b-3a 確定事項A）。getSelected・selectedEntry は 1 件のときだけ。複数は getSelection・selectedEntries。
    getSelected: () => selection().getSelected(),
    selectedEntry: () => selection().selectedEntry(),
    getSelection: () => selection().getSelection(),
    selectedEntries: () => selection().selectedEntries(),
    primaryKey: () => selection().primaryKey(),
    primaryEntry: () => selection().primaryEntry(),
    isSelected: (key) => selection().isSelected(key),
    select: (key) => selection().select(key),
    selectKeys: (keys) => selection().selectKeys(keys),
    toggleKey: (key) => selection().toggleKey(key),
    addKey: (key) => selection().addKey(key),
    hitTest: (index, point) => selection().hitTest(index, point),
    remove: () => selection().remove(),
    escape: () => root.SigK.annotateCancel.escape(),
    abortGestures: () => root.SigK.annotateCancel.abortGestures(),
    painterFor,
    onModeChanged,
    // jsdom のテストが矩形の測り方を差し替える口（annotate-markup.js へ流す）。
    setRectsOf: (fn) => root.SigK.annotateMarkup?.setRectsOf(fn),
  };
})(typeof window !== 'undefined' ? window : globalThis);
