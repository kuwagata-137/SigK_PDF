(function (root) {
  'use strict';

  // 注釈モードの指揮（spec-4-1 確定事項1〜10・15〜19、spec-4-2 確定事項1・7・8・21、spec-4-3 確定事項12・19）。
  //
  // 道具を持つ・選ぶ・消す・色を変える・履歴に積む、をここで結ぶ。状態の純粋な操作は
  // annotation-state.js、描画は annotation-layer.js、読み込んだ注釈を集めるのは
  // annotation-import.js、右のプロパティは annotation-props.js、ページビューの押し離しは
  // annotate-pointer.js、文字の選択からマークアップを作るのは annotate-markup.js、
  // テキストの置く・直す・動かすは annotate-text.js、図形・ペンの描く・動かす・太さは
  // annotate-shape.js が持つ。ここが握るのは「いまの道具」「選んでいる注釈」「次に付ける色と
  // 文字の大きさ」だけである。

  // プリセット（確定事項33、spec-4-2 確定事項34・35、spec-4-3 確定事項27〜29）は annotation-presets.js が持つ。
  // 色は種類ごとの引き出し（paletteOf。図形 4 種は shape、ペンは pen）で引く。
  const { TOOLS, MARKUP_TOOLS, TOOL_LABELS, COLORS, COLOR_NAMES, DEFAULT_COLORS, DEFAULT_FONT_SIZE, isFontSize, paletteOf } = root.SigK.annotationPresets;

  const state = {
    doc: null,
    win: null,
    tool: null,
    selected: null,
    colors: { ...DEFAULT_COLORS },
    fontSize: DEFAULT_FONT_SIZE,
  };

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function props() {
    return root.SigK.annotationProps;
  }

  function inAnnotMode() {
    return state.doc?.documentElement.getAttribute('data-mode') === 'annot';
  }

  function isOpen() {
    return viewer()?.getState().open === true;
  }

  // ---- 道具と色（確定事項1・33・34） ----

  function syncTools() {
    if (state.doc === null)
      return;
    for (const item of state.doc.querySelectorAll('.rail-item.tool[data-tool]'))
      item.classList.toggle('active', item.dataset.tool === state.tool);
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

  // 道具はトグル。マークアップは、押した時点で文字が選ばれていればその場で付ける
  // （確定事項10 ②）。テキストは押しても作らない（spec-4-2 確定事項3）。
  function toggleTool(tool) {
    if (!TOOLS.includes(tool))
      return false;
    if (MARKUP_TOOLS.includes(tool) && inAnnotMode() && isOpen() && createFromSelection(tool))
      return setTool(tool) !== null;
    return setTool(state.tool === tool ? null : tool) !== null;
  }

  function colorOf(kind) {
    const palette = paletteOf(kind);
    return state.colors[palette] ?? DEFAULT_COLORS[palette];
  }

  function applyColors(colors) {
    for (const kind of TOOLS) {
      if (COLORS[kind].includes(colors?.[kind]))
        state.colors[kind] = colors[kind];
    }
    props()?.refresh();
    return { ...state.colors };
  }

  function rememberColor(kind, color) {
    const palette = paletteOf(kind);
    if (!COLORS[palette]?.includes(color))
      return false;
    state.colors[palette] = color;
    root.SigK.shell?.persist?.({ annotColors: { [palette]: color } });
    return true;
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

  // 文字の選択からマークアップを作る（確定事項10〜14。annotate-markup.js）。
  function createFromSelection(kind) {
    return root.SigK.annotateMarkup?.createFromSelection(kind) === true;
  }

  // ---- 選ぶ・消す・色を変える（確定事項6・7） ----

  function getSelected() {
    return state.selected;
  }

  function selectedEntry() {
    if (state.selected === null || !isOpen())
      return null;
    return annotationState().findAnnot(viewer().getAnnotations(), viewer().getImported(), state.selected);
  }

  function select(key) {
    state.selected = key ?? null;
    if (state.selected !== null && selectedEntry() === null)
      state.selected = null;
    viewer()?.redrawAnnotations();
    props()?.refresh();
    return state.selected;
  }

  // 1 つの注釈に点（紙の座標）が当たるか。直線・矢印・ペンは線からの距離、それ以外は四角（spec-4-3 確定事項12）。
  function hits(entry, pdfPoint, viewport) {
    if (!annotationState().isPathKind(entry.kind))
      return root.SigK.markupQuads.hitTest(entry.quads, pdfPoint);
    const geometry = root.SigK.shapeGeometry;
    const tolerance = geometry.hitTolerance(entry.lineWidth, viewport.scale ?? 1);
    return geometry.hitsPath(entry.paths, pdfPoint, tolerance, { arrow: entry.kind === 'arrow', lineWidth: entry.lineWidth });
  }

  // 点（.pdf-page 基準の CSS px）に当たる注釈。上に描いたもの（後ろ）が優先。
  function hitTest(index, point) {
    const view = viewer();
    const viewport = root.SigK.freeTextEditor?.pageOf(index)?.viewport ?? view?.getTextLayer(index)?.viewport;
    const src = view?.getPlan()[index]?.src;
    if (viewport === null || viewport === undefined || !Number.isInteger(src))
      return null;
    const pdfPoint = viewport.convertToPdfPoint(point[0], point[1]);
    const entries = annotationState().annotsOnPage(view.getAnnotations(), view.getImported(), src);
    for (let position = entries.length - 1; position >= 0; position -= 1) {
      if (hits(entries[position], pdfPoint, viewport))
        return root.SigK.annotationLayer.keyOf(entries[position]);
    }
    return null;
  }

  function remove() {
    const entry = selectedEntry();
    if (entry === null)
      return false;
    const key = state.selected;
    const annots = annotationState().removeAnnot(viewer().getAnnotations(), entry);
    state.selected = null;
    root.SigK.pageEdit.commitAnnots(annots, { annot: { before: key, after: null } });
    props()?.refresh();
    return true;
  }

  // 色を変える。注釈を選んでいればその注釈、選んでいなければ道具の色（次に付ける色）。
  function setColor(color) {
    const entry = selectedEntry();
    if (entry === null) {
      const kind = state.tool;
      if (kind === null || !rememberColor(kind, color))
        return false;
      props()?.refresh();
      return true;
    }
    if (!COLORS[paletteOf(entry.kind)].includes(color))
      return false;
    const before = state.selected;
    const annots = annotationState().recolorAnnot(viewer().getAnnotations(), entry, color);
    // 読み込んだものは写しに変わる（確定事項17）。選択はその写しへ移す。
    const after = entry.ref !== undefined ? annots.added.at(-1).id : before;
    state.selected = after;
    rememberColor(entry.kind, color);
    root.SigK.pageEdit.commitAnnots(annots, { annot: { before, after } });
    props()?.refresh();
    return true;
  }

  // 開いているテキストの入力欄を確定して閉じる（spec-4-2 確定事項8）。
  function finishEditing() {
    return root.SigK.annotateText?.finishEditing() === true;
  }

  // Esc。描いている途中なら捨て、入力欄が開いていれば確定、選んでいる注釈があれば解除、
  // 無ければ道具を離す（確定事項7、spec-4-3 確定事項3）。
  function escape() {
    if (root.SigK.annotateShape?.cancelDraft() === true)
      return true;
    if (finishEditing())
      return true;
    if (state.selected !== null) {
      select(null);
      return true;
    }
    if (state.tool !== null) {
      setTool(null);
      return true;
    }
    return false;
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

  // モードを離れたら入力欄を確定し、選択を解除する。道具は持ち越す（確定事項8）。
  // 入ったらフォントを先読みする（spec-4-2 確定事項33）。
  function onModeChanged(mode) {
    if (mode !== 'annot')
      finishEditing();
    if (mode !== 'annot' && state.selected !== null)
      select(null);
    props()?.refresh();
    if (mode === 'annot') {
      root.SigK.save?.warnIfUnsaveable();
      root.SigK.freeTextShape?.ensureLoaded(state.doc);
    }
  }

  function init(doc, win) {
    if (win.__sigkAnnotateReady === true)
      return false;
    win.__sigkAnnotateReady = true;
    state.doc = doc;
    state.win = win;

    for (const item of doc.querySelectorAll('.rail-item.tool[data-tool]')) {
      item.addEventListener('click', () => {
        if (item.getAttribute('aria-disabled') !== 'true')
          toggleTool(item.dataset.tool);
      });
    }
    syncTools();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotate = {
    TOOLS,
    TOOL_LABELS,
    COLORS,
    COLOR_NAMES,
    DEFAULT_COLORS,
    init,
    importDocument: (doc, isCurrent) => root.SigK.annotationImport.importDocument(doc, isCurrent),
    getTool: () => state.tool,
    setTool,
    toggleTool,
    isMarkupTool,
    getColors: () => ({ ...state.colors }),
    colorOf,
    applyColors,
    getFontSize,
    applyFontSize,
    rememberFontSize,
    setFontSize: (size) => root.SigK.annotateText?.setFontSize(size) === true,
    setLineWidth: (width) => root.SigK.annotateShape?.setLineWidth(width) === true,
    setShapeKind: (kind) => root.SigK.annotateShape?.setShapeKind(kind) === true,
    getLineWidth: () => root.SigK.annotateShape?.getLineWidth(),
    getShapeKind: () => root.SigK.annotateShape?.getShapeKind(),
    editSelected: () => root.SigK.annotateText?.editSelected() === true,
    finishEditing,
    createFromSelection,
    getSelected,
    selectedEntry,
    select,
    hitTest,
    remove,
    setColor,
    escape,
    painterFor,
    onModeChanged,
    // jsdom のテストが矩形の測り方を差し替える口（annotate-markup.js へ流す）。
    setRectsOf: (fn) => root.SigK.annotateMarkup?.setRectsOf(fn),
  };
})(typeof window !== 'undefined' ? window : globalThis);
