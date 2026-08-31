(function (root) {
  'use strict';

  // 文書を開き、ページを縦に並べ、見えている範囲だけを描く層。
  // 配置と倍率の計算は viewer-layout.js（純関数）に置き、ここは DOM と
  // pdf.js の呼び出しだけを担う。ツールバーとキー操作の結線は
  // viewer-controls.js にある。

  const EMPTY_MESSAGE = '文書が開かれていません';

  const state = {
    doc: null,
    file: null,
    sizes: [],
    layout: { pages: [], contentWidth: 0, totalHeight: 0 },
    zoom: 1,
    fit: 'width',
    current: 0,
    rendered: new Map(),
    // 文書やズームが変わったら、飛んでいる描画をすべて捨てるための世代番号。
    token: 0,
    frame: 0,
  };

  let el = null;

  function layout() {
    return root.SigK.viewerLayout;
  }

  function controls() {
    return root.SigK.viewerControls;
  }

  function getState() {
    return {
      open: state.doc !== null,
      file: state.file,
      pageCount: state.sizes.length,
      current: state.current,
      zoom: state.zoom,
      fit: state.fit,
      contentWidth: state.layout.contentWidth,
      totalHeight: state.layout.totalHeight,
      rendered: [...state.rendered.keys()].sort((a, b) => a - b),
    };
  }

  function report(error, context = {}) {
    root.SigK.log.report({
      level: 'error',
      message: error?.message ?? String(error),
      stack: error?.stack,
      context: { source: 'viewer', ...context },
    });
  }

  // 失敗はページビューにその場で出す。ダイアログで画面を塞がない（spec-1-1 確定事項16）。
  function setMessage(text) {
    el.empty.textContent = text;
    el.empty.hidden = false;
  }

  function setDocumentOpen(open) {
    el.doc.documentElement.setAttribute('data-doc', open ? 'open' : 'empty');
    el.empty.hidden = open;
    el.pages.hidden = !open;
  }

  // ---- レイアウト ----

  function buildPages() {
    const nodes = state.sizes.map((_size, index) => {
      const node = el.doc.createElement('div');
      node.className = 'pdf-page';
      node.dataset.page = String(index + 1);
      return node;
    });
    el.pageNodes = nodes;
    el.pages.replaceChildren(...nodes);
  }

  function applyLayout() {
    const next = layout().layoutPages({ sizes: state.sizes, zoom: state.zoom });
    state.layout = next;
    el.pages.style.width = `${next.contentWidth}px`;
    el.pages.style.height = `${next.totalHeight}px`;

    for (const page of next.pages) {
      const node = el.pageNodes[page.index];
      node.style.top = `${page.top}px`;
      node.style.left = `${page.left}px`;
      node.style.width = `${page.width}px`;
      node.style.height = `${page.height}px`;
    }
  }

  // ---- 描画 ----

  // jsdom には 2D コンテキストが無い（canvas パッケージを入れていないため）。
  // getContext を呼ぶと「Not implemented」がコンソールに出るので、呼ぶ前に確かめる。
  function canDrawCanvas() {
    return typeof root.CanvasRenderingContext2D !== 'undefined';
  }

  function releasePage(index) {
    const entry = state.rendered.get(index);
    if (entry === undefined)
      return;
    state.rendered.delete(index);
    entry.task?.cancel();
    el.pageNodes[index]?.replaceChildren();
  }

  function releaseAll() {
    for (const index of [...state.rendered.keys()])
      releasePage(index);
  }

  async function renderPage(index) {
    if (state.rendered.has(index))
      return;

    const token = state.token;
    const entry = { task: null };
    state.rendered.set(index, entry);

    // 捨てられたかどうかは、地図に載っているのが自分の entry かどうかで見る。
    // token は文書とズームの変化しか捉えない。スクロールで範囲外になった場合、
    // これが無いと遅れて届いた描画が、もう見ていないページに canvas を貼る。
    const isStale = () => token !== state.token || state.rendered.get(index) !== entry;

    try {
      const page = await state.doc.getPage(index + 1);
      if (isStale())
        return;

      const scale = layout().renderScale({ zoom: state.zoom, devicePixelRatio: root.devicePixelRatio });
      const viewport = page.getViewport({ scale });
      const canvas = el.doc.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      if (!canDrawCanvas())
        return;

      entry.task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      await entry.task.promise;
      if (isStale())
        return;
      el.pageNodes[index]?.replaceChildren(canvas);
    } catch (error) {
      if (state.rendered.get(index) === entry)
        state.rendered.delete(index);
      // スクロールで捨てた描画は失敗ではない。
      if (error?.name === 'RenderingCancelledException')
        return;
      report(error, { page: index + 1 });
    }
  }

  function update() {
    if (state.doc === null)
      return;

    const pages = state.layout.pages;
    const scrollTop = el.view.scrollTop;
    const viewportHeight = el.view.clientHeight;
    const range = layout().visibleRange({ pages, scrollTop, viewportHeight });
    const current = layout().currentPageIndex({ pages, scrollTop, viewportHeight });

    if (current !== state.current) {
      state.current = current;
      controls()?.syncPage(el.doc, getState());
    }

    const targets = layout().renderTargets({
      count: pages.length,
      first: range.first,
      last: range.last,
      current,
    });

    for (const index of [...state.rendered.keys()]) {
      if (!targets.includes(index))
        releasePage(index);
    }
    for (const index of targets)
      renderPage(index);
  }

  // スクロールと寸法変更は1フレームに1回へ間引く。
  function scheduleUpdate() {
    if (state.frame !== 0)
      return;
    const raf = root.requestAnimationFrame ?? ((fn) => root.setTimeout(fn, 16));
    state.frame = raf(() => {
      state.frame = 0;
      update();
    });
  }

  // ---- 倍率 ----

  function setZoom(zoom, { fit = null } = {}) {
    const next = layout().clampZoom(zoom);
    const changed = next !== state.zoom;
    state.zoom = next;
    state.fit = fit;

    if (state.doc !== null && changed) {
      // 倍率が変われば canvas の解像度も変わる。飛んでいる描画ごと捨てる。
      state.token += 1;
      releaseAll();
      applyLayout();
      goToPage(state.current);
    }
    controls()?.syncZoom(el.doc, getState());
    scheduleUpdate();
    return state.zoom;
  }

  function fitZoomFor(mode) {
    const size = state.sizes[state.current] ?? state.sizes[0];
    if (size === undefined)
      return state.zoom;
    const viewportWidth = el.view.clientWidth;
    const viewportHeight = el.view.clientHeight;
    if (mode === 'page')
      return layout().fitPageZoom({ pageWidth: size.width, pageHeight: size.height, viewportWidth, viewportHeight });
    return layout().fitWidthZoom({ pageWidth: size.width, viewportWidth });
  }

  function applyFit(mode) {
    return setZoom(fitZoomFor(mode), { fit: mode });
  }

  // ウィンドウやサイドパネルの幅が変わったとき、追従中だけ計算し直す。
  function refit() {
    if (state.doc === null)
      return;
    if (state.fit === null) {
      scheduleUpdate();
      return;
    }
    applyFit(state.fit);
  }

  // ---- ページ移動 ----

  function goToPage(index) {
    if (state.doc === null)
      return state.current;
    const target = Math.min(state.sizes.length - 1, Math.max(0, index));
    el.view.scrollTop = layout().scrollTopForPage({ pages: state.layout.pages, index: target });
    state.current = target;
    controls()?.syncPage(el.doc, getState());
    scheduleUpdate();
    return target;
  }

  // ---- 文書 ----

  function close() {
    state.token += 1;
    releaseAll();
    state.doc?.destroy?.();
    state.doc = null;
    state.file = null;
    state.sizes = [];
    state.layout = { pages: [], contentWidth: 0, totalHeight: 0 };
    state.current = 0;
    el.pageNodes = [];
    el.pages.replaceChildren();
    setDocumentOpen(false);
    setMessage(EMPTY_MESSAGE);
    root.SigK.shell.setStatus(el.doc, { file: '文書なし', pages: '–', size: '–' });
    controls()?.syncAll(el.doc, getState());
  }

  // 全ページの寸法を先に集める。スクロールバーの長さが最初から正しくなり、
  // 読み進めるたびに位置が跳ねるのを防げる（spec-1-1 確定事項9）。
  async function collectSizes(doc) {
    const sizes = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push({ width: viewport.width, height: viewport.height });
    }
    return sizes;
  }

  function describeOpenFailure(error) {
    if (error?.name === 'PasswordException')
      return 'この PDF にはパスワードが設定されています。この版では開けません。';
    if (error?.name === 'InvalidPDFException')
      return 'PDF として読めませんでした。ファイルが壊れている可能性があります。';
    return 'この PDF を開けませんでした。';
  }

  async function open(source) {
    if (source?.error !== undefined) {
      setMessage(source.error);
      return false;
    }
    if (root.SigK.pdfjs?.available !== true) {
      setMessage('PDF の表示機能を読み込めませんでした。');
      return false;
    }

    close();
    state.token += 1;
    const token = state.token;
    setMessage('読み込んでいます…');

    try {
      const doc = await root.SigK.pdfjs.getDocument({ data: source.bytes }).promise;
      const sizes = await collectSizes(doc);
      if (token !== state.token) {
        doc.destroy?.();
        return false;
      }

      state.doc = doc;
      state.file = { path: source.path, name: source.name, size: source.size };
      state.sizes = sizes;
      state.current = 0;

      buildPages();
      setDocumentOpen(true);
      // 用紙サイズを知らなくても読める幅で出す（spec-1-1 確定事項8）。
      applyFit('width');
      el.view.scrollTop = 0;
      root.SigK.shell.setStatus(el.doc, {
        file: source.name,
        pages: `${doc.numPages} ページ`,
        size: root.SigK.shell.formatFileSize(source.size),
      });
      controls()?.syncAll(el.doc, getState());
      return true;
    } catch (error) {
      setMessage(describeOpenFailure(error));
      report(error, { path: source?.path });
      return false;
    }
  }

  async function openViaDialog() {
    const api = root.pdfAPI;
    if (!api || api.available !== true) {
      setMessage('ファイルを開く機能が使えません。');
      return false;
    }
    const result = await api.open();
    if (result?.canceled === true)
      return false;
    return open(result);
  }

  function init(doc, win) {
    if (win.__sigkViewerReady === true)
      return false;

    el = {
      doc,
      view: doc.getElementById('view'),
      pages: doc.getElementById('view-pages'),
      empty: doc.getElementById('view-empty'),
      pageNodes: [],
    };
    if (el.view === null || el.pages === null || el.empty === null) {
      el = null;
      return false;
    }
    win.__sigkViewerReady = true;

    el.view.addEventListener('scroll', scheduleUpdate);
    win.addEventListener('resize', refit);
    setDocumentOpen(false);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.viewer = {
    EMPTY_MESSAGE,
    init,
    open,
    openViaDialog,
    close,
    getState,
    setZoom,
    applyFit,
    refit,
    goToPage,
    zoomIn: () => setZoom(layout().nextZoom(state.zoom)),
    zoomOut: () => setZoom(layout().prevZoom(state.zoom)),
    actualSize: () => setZoom(1),
    nextPage: () => goToPage(state.current + 1),
    prevPage: () => goToPage(state.current - 1),
    firstPage: () => goToPage(0),
    lastPage: () => goToPage(state.sizes.length - 1),
  };
})(typeof window !== 'undefined' ? window : globalThis);
