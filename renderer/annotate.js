(function (root) {
  'use strict';

  // 注釈モードの指揮（spec-4-1 確定事項1〜10・15〜19）。
  //
  // 道具を持つ・文字の選択から注釈を作る・選ぶ・消す・色を変える・履歴に積む、を
  // ここで結ぶ。状態の純粋な操作は annotation-state.js、四角の計算は markup-quads.js／
  // markup-selection.js、描画は annotation-layer.js、読み込んだ注釈を集めるのは
  // annotation-import.js、右のプロパティは annotation-props.js が持つ。ここが握るのは
  // 「いまの道具」と「選んでいる注釈」だけである。

  const TOOLS = Object.freeze(['highlight', 'underline', 'strikeout']);
  const TOOL_LABELS = Object.freeze({ highlight: 'ハイライト', underline: '下線', strikeout: '取り消し線' });
  // プリセット（確定事項33）。settings.js の ANNOT_COLORS と同じ並びであること
  // （プロセスが違うので import はできない。test/settings.test.js が一致を見張る）。
  const COLORS = Object.freeze({
    highlight: ['#ffe45a', '#8ce99a', '#8fbfff', '#ffa8c8'],
    underline: ['#d92c2c', '#2c5cd9', '#1c2430'],
    strikeout: ['#d92c2c', '#2c5cd9', '#1c2430'],
  });
  const COLOR_NAMES = Object.freeze({
    '#ffe45a': '黄', '#8ce99a': '緑', '#8fbfff': '青', '#ffa8c8': '桃', '#d92c2c': '赤', '#2c5cd9': '青', '#1c2430': '黒',
  });
  const DEFAULT_COLORS = Object.freeze({ highlight: '#ffe45a', underline: '#d92c2c', strikeout: '#d92c2c' });
  // 押して離すまでの動きがこれ以下なら「押した」と見なす（CSS px）。
  const CLICK_SLOP = 3;

  const state = {
    doc: null,
    win: null,
    tool: null,
    selected: null,
    colors: { ...DEFAULT_COLORS },
    // 押した位置。離したときに動いていなければ当たり判定へ回す（確定事項6）。
    pressed: null,
    // 矩形を測る口。jsdom のテストが差し替える。
    rectsOf: (range) => range.getClientRects(),
  };

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function pageEdit() {
    return root.SigK.pageEdit;
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
    props()?.refresh();
  }

  function setTool(tool) {
    state.tool = TOOLS.includes(tool) ? tool : null;
    syncTools();
    return state.tool;
  }

  // 道具はトグル。押した時点で文字が選ばれていれば、その場で付ける（確定事項10 ②）。
  function toggleTool(tool) {
    if (!TOOLS.includes(tool))
      return false;
    if (inAnnotMode() && isOpen() && createFromSelection(tool))
      return setTool(tool) !== null;
    return setTool(state.tool === tool ? null : tool) !== null;
  }

  function colorOf(kind) {
    return state.colors[kind] ?? DEFAULT_COLORS[kind];
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
    if (!COLORS[kind]?.includes(color))
      return false;
    state.colors[kind] = color;
    root.SigK.shell?.persist?.({ annotColors: { [kind]: color } });
    return true;
  }

  // ---- 作る（確定事項10〜14） ----

  function renderedPages() {
    const view = viewer();
    if (view === undefined || state.doc === null)
      return [];
    const plan = view.getPlan();
    return view.getState().rendered.map((index) => ({
      index,
      src: plan[index]?.src,
      node: state.doc.querySelector(`.pdf-page[data-page="${index + 1}"]`),
      handle: view.getTextLayer(index),
    })).filter((page) => page.node !== null && page.handle !== null && page.handle !== undefined);
  }

  function clearSelection() {
    state.win?.getSelection?.()?.removeAllRanges?.();
  }

  // いまの文字の選択から注釈を作る。ページごとに 1 つ（確定事項11）。差し込んだ
  // ページ（src が無い）には付けない（既知の限界）。作れたら true。
  function createFromSelection(kind) {
    const view = viewer();
    if (view === undefined || !isOpen())
      return false;
    const found = root.SigK.markupSelection.collect({
      doc: state.doc,
      selection: state.win?.getSelection?.() ?? null,
      pages: renderedPages(),
      rectsOf: state.rectsOf,
    }).filter((page) => Number.isInteger(page.src));
    if (found.length === 0)
      return false;

    let annots = view.getAnnotations();
    const ids = [];
    for (const page of found) {
      const id = annotationState().newId();
      ids.push(id);
      annots = annotationState().addAnnot(annots, {
        id, src: page.src, kind, color: colorOf(kind), opacity: 1, quads: page.quads, rect: page.rect, text: page.text,
      });
    }
    clearSelection();
    state.selected = ids[0];
    pageEdit().commitAnnots(annots, { annot: { before: null, after: ids[0] } });
    props()?.refresh();
    return true;
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

  // 点（.pdf-page 基準の CSS px）に当たる注釈。上に描いたもの（後ろ）が優先。
  function hitTest(index, point) {
    const view = viewer();
    const handle = view?.getTextLayer(index);
    const src = view?.getPlan()[index]?.src;
    if (handle === null || handle === undefined || !Number.isInteger(src))
      return null;
    const pdfPoint = handle.viewport.convertToPdfPoint(point[0], point[1]);
    const entries = annotationState().annotsOnPage(view.getAnnotations(), view.getImported(), src);
    for (let position = entries.length - 1; position >= 0; position -= 1) {
      if (root.SigK.markupQuads.hitTest(entries[position].quads, pdfPoint))
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
    pageEdit().commitAnnots(annots, { annot: { before: key, after: null } });
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
    if (!COLORS[entry.kind].includes(color))
      return false;
    const before = state.selected;
    const annots = annotationState().recolorAnnot(viewer().getAnnotations(), entry, color);
    // 読み込んだものは写しに変わる（確定事項17）。選択はその写しへ移す。
    const after = entry.ref !== undefined ? annots.added.at(-1).id : before;
    state.selected = after;
    rememberColor(entry.kind, color);
    pageEdit().commitAnnots(annots, { annot: { before, after } });
    props()?.refresh();
    return true;
  }

  // Esc。選んでいる注釈があれば解除、無ければ道具を離す（確定事項7）。
  function escape() {
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

  // ---- 画面の結線 ----

  function onMouseDown(event) {
    state.pressed = inAnnotMode() ? { x: event.clientX, y: event.clientY } : null;
  }

  // 離したとき: 道具があり文字が選ばれていれば作る（確定事項10 ①）。選ばれて
  // いなければ、動いていない押し離しを当たり判定へ回す（確定事項6）。
  function onMouseUp(event) {
    const pressed = state.pressed;
    state.pressed = null;
    if (!inAnnotMode() || !isOpen())
      return;
    if (state.tool !== null && createFromSelection(state.tool))
      return;
    const selection = state.win?.getSelection?.();
    if (selection !== null && selection !== undefined && !selection.isCollapsed)
      return;
    if (pressed === null || Math.abs(event.clientX - pressed.x) > CLICK_SLOP || Math.abs(event.clientY - pressed.y) > CLICK_SLOP)
      return;
    const node = event.target?.closest?.('.pdf-page');
    if (node === null || node === undefined) {
      select(null);
      return;
    }
    const base = node.getBoundingClientRect();
    select(hitTest(Number(node.dataset.page) - 1, [event.clientX - base.left, event.clientY - base.top]));
  }

  // モードを離れたら選択を解除する。道具は持ち越す（確定事項8）。
  function onModeChanged(mode) {
    if (mode !== 'annot' && state.selected !== null)
      select(null);
    props()?.refresh();
    if (mode === 'annot')
      root.SigK.save?.warnIfUnsaveable();
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
    const view = doc.getElementById('view');
    view?.addEventListener('mousedown', onMouseDown);
    view?.addEventListener('mouseup', onMouseUp);
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
    getColors: () => ({ ...state.colors }),
    colorOf,
    applyColors,
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
    // jsdom のテストが矩形の測り方を差し替える口。
    setRectsOf: (fn) => { state.rectsOf = fn; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
