(function (root) {
  'use strict';

  // サイドパネルのサムネイル（F-01-4、spec-1-3 確定事項1〜16）。
  //
  // 長い文書の「いまどこを読んでいるか」を示す地図である。読むためのもの
  // ではないので、解像度も同時に持つ枚数もページビューとは別に決める。
  //
  // 作りはページビューと同じ思想で、全ページ分の枠を先に置き、見えている
  // 範囲だけを描く（spec-1-1 確定事項9）。総高さが最初から正しくなり、
  // スクロールバーの長さが読み進めるたびに跳ねない。
  //
  // 配置の法則だけが違う。ページビューは「倍率が一律で、幅が紙ごとに変わる」。
  // ここは「幅を揃えて、高さが紙ごとに変わる」。計算は viewer-layout.js の
  // layoutThumbnails が持ち、返す形を layoutPages に揃えてあるので、
  // visibleRange と currentPageIndex はそのまま使える（確定事項3）。

  const state = {
    doc: null,
    sizes: [],
    layout: { pages: [], sheetWidth: 0, totalHeight: 0 },
    // 枠を作ったときのパネル幅。変わっていれば作り直す合図になる。
    columnWidth: 0,
    current: 0,
    rendered: new Map(),
    // 文書やパネル幅が変わったら、飛んでいる描画をすべて捨てるための世代番号。
    token: 0,
    frame: 0,
  };

  let el = null;

  function layout() {
    return root.SigK.viewerLayout;
  }

  function report(error, context = {}) {
    root.SigK.log.report({
      level: 'error',
      message: error?.message ?? String(error),
      stack: error?.stack,
      context: { source: 'thumbnails', ...context },
    });
  }

  // 閲覧モードで、サイドパネルが開いているときだけ出す（確定事項1・14）。
  // 畳んでいる間に描いても誰にも見えない。
  function isVisible() {
    if (el === null)
      return false;
    const html = el.doc.documentElement;
    return html.getAttribute('data-mode') === 'view' && html.getAttribute('data-panel') === 'open';
  }

  // 紙の幅はサイドパネルの実幅に追従させる（確定事項5）。固定値にすると、
  // パネルを広げてもサムネイルが大きくならない。
  function columnWidthNow() {
    return Math.max(0, el.scroll.clientWidth - layout().THUMB_MARGIN * 2);
  }

  function getState() {
    return {
      open: state.doc !== null,
      count: state.layout.pages.length,
      current: state.current,
      columnWidth: state.columnWidth,
      sheetWidth: state.layout.sheetWidth,
      totalHeight: state.layout.totalHeight,
      rendered: [...state.rendered.keys()].sort((a, b) => a - b),
    };
  }

  // ---- 枠 ----

  function build() {
    const columnWidth = columnWidthNow();
    state.columnWidth = columnWidth;
    state.layout = layout().layoutThumbnails({ sizes: state.sizes, columnWidth });

    const nodes = [];
    const sheets = [];
    for (const page of state.layout.pages) {
      const node = el.doc.createElement('div');
      node.className = 'thumb';
      node.dataset.page = String(page.index + 1);
      node.style.top = `${page.top}px`;
      node.style.width = `${columnWidth}px`;
      node.style.height = `${page.height}px`;

      const sheet = el.doc.createElement('div');
      sheet.className = 'sheet';
      sheet.style.height = `${page.sheetHeight}px`;

      // 紙だけでは何ページ目か分からない。地図として使うなら番号が要る
      // （確定事項9）。
      const cap = el.doc.createElement('div');
      cap.className = 'cap';
      cap.textContent = String(page.index + 1);

      node.append(sheet, cap);
      nodes.push(node);
      sheets.push(sheet);
    }

    el.thumbNodes = nodes;
    el.sheets = sheets;
    el.list.style.height = `${state.layout.totalHeight}px`;
    el.list.replaceChildren(...nodes);
    el.list.hidden = nodes.length === 0;
    el.empty.hidden = nodes.length > 0;
    markCurrent();
  }

  // 枠ごと捨てる。畳んでいるとき・閲覧モード以外・文書が無いときの姿へ戻す。
  function discard() {
    state.token += 1;
    releaseAll();
    state.columnWidth = 0;
    state.layout = { pages: [], sheetWidth: 0, totalHeight: 0 };
    el.thumbNodes = [];
    el.sheets = [];
    el.list.replaceChildren();
    el.list.hidden = true;
    el.list.style.height = '';
    el.empty.hidden = false;
  }

  // ---- 描画 ----

  function canDrawCanvas() {
    return typeof root.CanvasRenderingContext2D !== 'undefined';
  }

  function releaseThumb(index) {
    const entry = state.rendered.get(index);
    if (entry === undefined)
      return;
    state.rendered.delete(index);
    entry.task?.cancel();
    el.sheets[index]?.replaceChildren();
  }

  function releaseAll() {
    for (const index of [...state.rendered.keys()])
      releaseThumb(index);
  }

  async function renderThumb(index) {
    if (state.rendered.has(index))
      return;

    const token = state.token;
    const entry = { task: null };
    state.rendered.set(index, entry);
    const isStale = () => token !== state.token || state.rendered.get(index) !== entry;

    try {
      const page = await state.doc.getPage(index + 1);
      if (isStale())
        return;

      // 幅が sheetWidth ピクセルになる倍率で描く。実寸の何倍かは問わない
      // （確定事項7）。devicePixelRatio の上限もページビューより低い。
      const scale = layout().thumbnailScale({
        sheetWidth: state.layout.sheetWidth,
        pageWidth: state.sizes[index]?.width ?? 0,
        devicePixelRatio: root.devicePixelRatio,
      });
      const viewport = page.getViewport({ scale });
      if (!canDrawCanvas())
        return;

      const canvas = el.doc.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      entry.task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      await entry.task.promise;
      if (isStale())
        return;
      el.sheets[index]?.replaceChildren(canvas);
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
    if (state.doc === null || !isVisible())
      return;

    const pages = state.layout.pages;
    const scrollTop = el.scroll.scrollTop;
    const viewportHeight = el.scroll.clientHeight;
    const range = layout().visibleRange({ pages, scrollTop, viewportHeight });

    // 切り詰めの中心は「サムネイルの中で今見えているところ」であって、
    // ページビューの現在ページではない。自分でサムネイルをスクロールした
    // 先が描かれないと、地図として辿れなくなる。
    const center = layout().currentPageIndex({ pages, scrollTop, viewportHeight });
    const targets = layout().renderTargets({
      count: pages.length,
      first: range.first,
      last: range.last,
      current: center,
      max: layout().MAX_THUMBS,
    });

    for (const index of [...state.rendered.keys()]) {
      if (!targets.includes(index))
        releaseThumb(index);
    }
    for (const index of targets)
      renderThumb(index);
  }

  // スクロールと幅の変更は1フレームに1回へ間引く。ドラッグ中に毎回
  // 作り直すと、掴んでいる間じゅう描き直しが走る（確定事項15）。
  function schedule() {
    if (state.frame !== 0)
      return;
    const raf = root.requestAnimationFrame ?? ((fn) => root.setTimeout(fn, 16));
    state.frame = raf(() => {
      state.frame = 0;
      if (state.doc === null || !isVisible())
        return;
      // 幅が変われば紙の寸法が変わるので、枠から作り直す。
      if (columnWidthNow() !== state.columnWidth) {
        state.token += 1;
        releaseAll();
        build();
      }
      update();
    });
  }

  // ---- 現在ページ ----

  function markCurrent() {
    const nodes = el?.thumbNodes ?? [];
    nodes.forEach((node, index) => node.classList.toggle('current', index === state.current));
  }

  // 現在ページの枠が見えていなければ寄せる（確定事項11。タブと同じ作法）。
  // 自分でサムネイルをスクロールしている最中でも戻ってしまうが、塊③-a では
  // 受け入れる（確定事項12）。現在ページが見えない地図は役に立たない。
  function reveal() {
    const node = el?.thumbNodes?.[state.current];
    // jsdom は scrollIntoView を実装しない。画面テストで落とさないため確かめる。
    if (node === undefined || typeof node.scrollIntoView !== 'function')
      return false;
    node.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function setCurrent(index) {
    if (!Number.isInteger(index) || index === state.current)
      return state.current;
    state.current = index;
    if (el === null)
      return index;
    markCurrent();
    reveal();
    return index;
  }

  // ---- 文書 ----

  // 映すものを差し替える。canvas はタブをまたいで持ち越さない（確定事項13）。
  // 持ち越すのはスクロール位置だけである。
  function setDocument({ doc, sizes, current = 0, scrollTop = 0 }) {
    state.token += 1;
    releaseAll();
    state.doc = doc;
    state.sizes = sizes ?? [];
    state.current = current;
    if (el === null)
      return false;
    if (!isVisible()) {
      discard();
      return false;
    }
    build();
    el.scroll.scrollTop = scrollTop;
    schedule();
    return true;
  }

  function clear() {
    state.doc = null;
    state.sizes = [];
    state.current = 0;
    if (el === null)
      return false;
    discard();
    return true;
  }

  function getScrollTop() {
    return el === null ? 0 : el.scroll.scrollTop;
  }

  // モード・開閉・幅が変わったときに shell.js から呼ばれる（確定事項15）。
  // 見えない状態になったら枠ごと捨て、見える状態に戻ったら作り直す。
  function refresh() {
    if (el === null)
      return false;
    if (!isVisible()) {
      if (state.layout.pages.length > 0)
        discard();
      return false;
    }
    if (state.doc === null)
      return false;
    // 畳んでいる間に文書が変わっていることがある。枠が無ければここで作る。
    if (state.layout.pages.length === 0)
      build();
    schedule();
    return true;
  }

  function onClick(event) {
    const node = event.target?.closest?.('.thumb');
    if (node === null || node === undefined)
      return;
    const index = Number(node.dataset.page) - 1;
    if (Number.isInteger(index))
      root.SigK.viewer?.goToPage(index);
  }

  function init(doc, win) {
    if (win.__sigkThumbnailsReady === true)
      return false;

    el = {
      doc,
      scroll: doc.getElementById('side-scroll'),
      list: doc.getElementById('thumbs'),
      empty: doc.getElementById('thumbs-empty'),
      thumbNodes: [],
      sheets: [],
    };
    if (el.scroll === null || el.list === null || el.empty === null) {
      el = null;
      return false;
    }
    win.__sigkThumbnailsReady = true;

    el.scroll.addEventListener('scroll', schedule);
    el.list.addEventListener('click', onClick);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.thumbnails = {
    init,
    setDocument,
    clear,
    setCurrent,
    refresh,
    getScrollTop,
    getState,
  };
})(typeof window !== 'undefined' ? window : globalThis);
