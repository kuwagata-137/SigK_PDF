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
    // 表示上の並び（spec-1-5 確定事項1）。元ページを引く写像と、回転を
    // 当てるのに使う。viewer が applyPlan() のたびに差し替える。
    plan: [],
    // 差し込んだページの控え（spec-1-6 確定事項93）。plan の { insert } が
    // この配列の番号を指す。viewer が持っているものをそのまま借りる。
    inserts: [],
    layout: { pages: [], sheetWidth: 0, totalHeight: 0 },
    // 枠を作ったときのパネル幅と列数。変わっていれば作り直す合図になる。
    columnWidth: 0,
    columns: 1,
    current: 0,
    rendered: new Map(),
    // 文書やパネル幅が変わったら、飛んでいる描画をすべて捨てるための世代番号。
    token: 0,
    frame: 0,
  };

  // 控えの画素数の上限（docs/07 決定99 ②。Claude の案）。サムネイルは小さいので 400 万画素（ページの表示域の控えとは別）。
  const KEEP_PIXELS = 4_000_000;
  // 新しい絵を描き終えるまで前の絵を表示しているサムネイル。index → 絵の記録（page-picture.js）。モザイクだけが変わった時と、
  // 並びを変えた時（決定99 ②）に使う。描けたら入れ替え、描く範囲から外れたら破棄する。
  const held = new Map();
  // 控え（決定99 ②）。並びから外れたページのサムネイルなどを、次の 1 回の並びの変更まで残す。
  const keeper = root.SigK.pagePicture.createKeeper({ budget: KEEP_PIXELS });

  let el = null;

  function layout() {
    return root.SigK.viewerLayout;
  }

  function picture() {
    return root.SigK.pagePicture;
  }

  function report(error, context = {}) {
    root.SigK.log.report({
      level: 'error',
      message: error?.message ?? String(error),
      stack: error?.stack,
      context: { source: 'thumbnails', ...context },
    });
  }

  // 閲覧モードとページモードで、サイドパネルが開いているときだけ出す
  // （spec-1-3 確定事項1・14／spec-1-5 確定事項28）。畳んでいる間に描いても
  // 誰にも見えない。
  //
  // 塊③-b までは閲覧モード専用だった。ページモードを足したのは塊④ で、
  // 「ページを押すとサムネイルが消える」状態を解消するためである。
  function isVisible() {
    if (el === null)
      return false;
    const html = el.doc.documentElement;
    const mode = html.getAttribute('data-mode');
    // 編集モード（annot）は、左の切り替えでサムネイルを選んでいるときだけ（spec-4b-1a 確定事項16。
    // spec-4-4 確定事項9 では一覧だけだった）。
    const shown = mode === 'view' || mode === 'pages' || (mode === 'annot' && html.getAttribute('data-edit-side') !== 'list');
    return shown && html.getAttribute('data-panel') === 'open';
  }

  // 列数はページモードだけ自動で増やす（確定事項23・28）。閲覧モードの
  // サイドパネルは1列のまま変えない。
  function columnsNow() {
    if (el === null)
      return 1;
    if (el.doc.documentElement.getAttribute('data-mode') !== 'pages')
      return 1;
    return layout().thumbnailColumns(columnWidthNow());
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
      plan: state.plan,
      current: state.current,
      columnWidth: state.columnWidth,
      columns: state.columns,
      sheetWidth: state.layout.sheetWidth,
      totalHeight: state.layout.totalHeight,
      rendered: [...state.rendered.keys()].sort((a, b) => a - b),
    };
  }

  // ---- 枠 ----

  function build() {
    const columnWidth = columnWidthNow();
    const columns = columnsNow();
    state.columnWidth = columnWidth;
    state.columns = columns;
    state.layout = layout().layoutThumbnails({ sizes: state.sizes, columnWidth, columns });

    const nodes = [];
    const sheets = [];
    for (const page of state.layout.pages) {
      const node = el.doc.createElement('div');
      node.className = 'thumb';
      node.dataset.page = String(page.index + 1);
      node.style.top = `${page.top}px`;
      // 多列では左端が列ごとに変わる。1列のときは 0 で、shell.css の
      // .thumb{left:0} と同じ位置になる。
      node.style.left = `${page.left}px`;
      node.style.width = `${page.width}px`;
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
    // 枠を作り直すと選択の印も消える。付け直すのはページモードの担当である
    // （spec-1-5 確定事項22）。
    root.SigK.pageGrid?.syncMarks();
  }

  // 枠ごと捨てる。畳んでいるとき・閲覧モード以外・文書が無いときの姿へ戻す。控えた前の絵も破棄する（決定99 ②）。
  function discard() {
    state.token += 1;
    releaseAll();
    keeper.clear();
    state.columnWidth = 0;
    state.columns = 1;
    state.layout = { pages: [], sheetWidth: 0, totalHeight: 0 };
    el.thumbNodes = [];
    el.sheets = [];
    el.list.replaceChildren();
    el.list.hidden = true;
    el.list.style.height = '';
    // ツールモードと、編集モードで一覧を選んでいるときは、サイドパネルを別の一覧が使う（spec-2-1 確定事項1、
    // spec-4b-1a 確定事項16）。「文書を開くと…」の案内はそこでは出さない。
    const html = el.list.ownerDocument.documentElement;
    const mode = html.getAttribute('data-mode');
    el.empty.hidden = mode === 'tools' || (mode === 'annot' && html.getAttribute('data-edit-side') === 'list');
  }

  // ---- 描画 ----

  function canDrawCanvas() {
    return typeof root.CanvasRenderingContext2D !== 'undefined';
  }

  // keepPicture は、モザイクだけが変わったページを描き直すとき（setPlan の repaint）だけ true にする。新しい絵ができるまで前の絵を表示する。
  function releaseThumb(index, { keepPicture = false } = {}) {
    const entry = state.rendered.get(index);
    if (entry === undefined)
      return;
    // 前の絵は、枠を空にする前に取り出す。
    const kept = keepPicture ? held.get(index) ?? takeThumb(index, entry) : null;
    state.rendered.delete(index);
    entry.task?.cancel();
    if (kept !== null && placeThumb(index, kept))
      return;
    held.delete(index);
    el.sheets[index]?.replaceChildren();
  }

  // 表示していた前の絵も破棄する。
  function releaseAll() {
    for (const index of [...state.rendered.keys()])
      releaseThumb(index);
    for (const index of held.keys())
      el.sheets[index]?.replaceChildren();
    held.clear();
  }

  // ---- 前の絵（決定99 ②。page-picture.js） ----

  function copyEntry(page) {
    return root.SigK.pagePlan.clonePlan([page])[0];
  }

  // 描き終えたサムネイルを枠から取り出して、絵の記録にする。final は、描いた時の並びの要素の絵として完成していること（同じページが
  // 同じ見た目のまま位置だけ変わったなら、描き直さずにそのまま使う）。描き終えていなければ null。
  function takeThumb(index, entry) {
    if (entry?.done !== true || entry.canvas?.parentNode !== el.sheets[index])
      return null;
    const { canvas, page, source, plan, viewport } = entry;
    return { canvas, page, source, plan, viewport, pixels: picture().pixelsOf(canvas), final: true };
  }

  // 並びを変える前に、枠に表示している絵（描き終えた絵と前の絵）を取り出す。前の並びの位置 → 絵の記録。
  function takeThumbs() {
    const taken = new Map(held);
    for (const [index, entry] of state.rendered) {
      const record = taken.has(index) ? null : takeThumb(index, entry);
      if (record !== null)
        taken.set(index, record);
    }
    return taken;
  }

  // 絵の記録を index の枠に置く。same（同じページが同じ見た目のまま位置だけ変わった）で完成した絵なら、描き終えた絵として入れ、描き直さない。
  // ほかは絵を置く要素に入れて、絵を描いた時の回転と範囲から今の枠への変換を適用し、新しい絵を描き終えるまで表示する。
  function placeThumb(index, record, { same = false } = {}) {
    const sheet = el.sheets[index];
    if (sheet === undefined)
      return false;
    if (same && record.final === true) {
      sheet.replaceChildren(record.canvas);
      const { page, source, canvas, viewport } = record;
      state.rendered.set(index, { task: null, page, source, plan: copyEntry(state.plan[index]), canvas, viewport, done: true });
      return true;
    }
    const shown = { ...record, final: false };
    shown.box ??= picture().wrap(el.doc, record.canvas);
    fitThumb(index, shown, sheet);
    sheet.replaceChildren(shown.box);
    held.set(index, shown);
    return true;
  }

  // 前の絵を置く要素をサムネイル枠に合わせる（page-render.js の placeHeld と同じ考え方）。向きと範囲が同じ絵は枠いっぱいに伸ばす。ほかは、枠の幅
  // （CSS px）から倍率を求めて変換を適用する。枠の大きさが分からなければ（jsdom）、配置の計算の大きさを使う。
  function fitThumb(index, record, sheet) {
    const now = state.plan[index];
    if (record.fill === true || picture().sameLook(record.plan, now)) {
      picture().fit(record.box);
      return;
    }
    const page = record.page;
    const rotation = (page?.rotate ?? 0) + (now?.rotate ?? 0);
    const unit = root.SigK.pageViewbox.viewportFor(page, { scale: 1, rotation, box: now?.crop ?? null });
    const planned = state.layout.pages[index];
    const frame = { width: sheet.clientWidth || planned?.sheetWidth || 0, height: sheet.clientHeight || planned?.sheetHeight || 0 };
    if (!(unit.width > 0) || !(frame.width > 0) || !(frame.height > 0)) {
      picture().fit(record.box);
      return;
    }
    const scale = frame.width / unit.width;
    const from = root.SigK.pageViewbox.viewportFor(page, { scale, rotation: (page?.rotate ?? 0) + (record.plan?.rotate ?? 0), box: record.plan?.crop ?? null });
    const to = root.SigK.pageViewbox.viewportFor(page, { scale, rotation, box: now?.crop ?? null });
    picture().fit(record.box, from, to, frame);
  }

  // 控えに入れてよい絵か。開き直す前の文書の絵は入れない。
  function keepable(record) {
    return record !== null && record !== undefined && record.fill !== true;
  }

  // 描き終えた新しい絵に置き換えた前の絵を、見た目（回転・トリミング・モザイク）が違えば控えに入れる（page-render.js と同じ）。
  function keepReplaced(record, plan) {
    if (keepable(record) && !picture().sameLook(record.plan, plan))
      keeper.add({ ...record, final: false });
  }

  // 並びを変えて枠を作り直した後で、取り出した絵を同じページの新しい枠に置く（page-render.js の placePictures と同じ優先順位。before は
  // 前の並び）。同じページが同じ見た目のまま位置だけ変わったサムネイルは、描き直さない。
  function placeThumbs(before, taken) {
    const moves = root.SigK.pagePlan.pageMoves(before, state.plan);
    const spare = [];
    moves.forEach((move, index) => {
      const carried = move === null ? null : taken.get(move.at) ?? null;
      if (move !== null)
        taken.delete(move.at);
      if (carried !== null && move.same) {
        placeThumb(index, carried, { same: true });
        return;
      }
      const source = root.SigK.pagePlan.sourceOf(state.plan, index, state);
      const chosen = picture().choose({ carried, keeper, source, look: state.plan[index] });
      if (chosen.replaced !== null)
        spare.push(chosen.replaced);
      if (chosen.record !== null)
        placeThumb(index, chosen.record);
    });
    keeper.renew([...spare, ...taken.values()].filter(keepable).map((record) => ({ ...record, final: false })));
  }

  // 上書き保存の後に開き直した時（viewer.reopen）。同じ位置で寸法が同じページは、前の絵を新しい枠いっぱいに表示する（page-render.js と同じ）。
  function fillThumbs(taken, previousSizes) {
    const same = (a, b) => a !== undefined && b !== undefined && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
    for (const [index, record] of taken) {
      if (same(state.sizes[index], previousSizes[index]))
        placeThumb(index, { ...record, fill: true });
    }
  }

  // ページの表示域で、前の絵が無いページの代わりの絵（決定99 ②。page-render.js の placePictures が、並びを変える前に呼ぶ）。source の
  // ページのサムネイルを描き終えていれば、その絵の複製と、描いた時のページ・並びの要素を返す。無ければ null。
  function standIn(source) {
    if (el === null)
      return null;
    for (const entry of state.rendered.values()) {
      if (entry.done !== true || !picture().sameSource(entry.source, source))
        continue;
      const canvas = picture().copyCanvas(el.doc, entry.canvas);
      return canvas === null ? null : { canvas, page: entry.page, source: entry.source, plan: entry.plan };
    }
    return null;
  }

  // 挿入・貼り付けで新しく入るページのうち、入れた後にサムネイルに見えるページを、並びに入れる前に描いて控えに入れる（決定99 ②。
  // page-render.js の prepare と同じ。引数も同じ）。
  async function prepare(sizes, added, limit) {
    if (el === null || state.doc === null || !isVisible() || el.sheets.length === 0 || !canDrawCanvas())
      return;
    const planned = layout().layoutThumbnails({ sizes, columnWidth: state.columnWidth, columns: state.columns });
    const range = layout().visibleRange({ pages: planned.pages, scrollTop: el.scroll.scrollTop, viewportHeight: el.scroll.clientHeight });
    const shown = added.filter(({ index }) => index >= range.first && index <= range.last);
    const owner = state.doc;
    await Promise.all(shown.map((item) => prepareThumb(item, { sheetWidth: planned.sheetWidth, size: sizes[item.index] }, limit, owner)));
  }

  async function prepareThumb({ doc, number }, { sheetWidth, size }, limit, owner) {
    try {
      const page = await doc.getPage(number);
      if (limit.cancelled)
        return;
      const scale = layout().thumbnailScale({ sheetWidth, pageWidth: size?.width ?? 0, devicePixelRatio: root.devicePixelRatio });
      const viewport = root.SigK.pageViewbox.viewportFor(page, { scale, rotation: page.rotate ?? 0 });
      const canvas = el.doc.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      // 描いている間だけ、時間の上限で取り消す対象にする。
      limit.tasks.add(task);
      try {
        await task.promise;
      } finally {
        limit.tasks.delete(task);
      }
      if (!limit.cancelled && state.doc === owner)
        keeper.add({ canvas, page, source: { doc, number }, plan: { rotate: 0 }, viewport, pixels: picture().pixelsOf(canvas), final: false });
    } catch {
      // 時間の上限で取り消した描画と、描けなかったページは、入れた後に今までどおり描く（描けなければ、その時に記録する）。
    }
  }

  // ---- ① のモザイクの範囲だけを塗る処理に渡す口（決定99） ----

  // 今の並びで描き終えたサムネイル。{ canvas, viewport, page, plan }（page-render.js の drawnPicture と同じ）。無ければ null。
  function drawnThumb(index) {
    const entry = state.rendered.get(index);
    if (entry?.done !== true || held.has(index))
      return null;
    return { canvas: entry.canvas, viewport: entry.viewport, page: entry.page, plan: entry.plan };
  }

  // drawnThumb の絵に、今の並びの要素のモザイクを塗った後に呼ぶ（page-render.js の markDrawn と同じ）。
  function markDrawn(index, plan = state.plan[index]) {
    const entry = state.rendered.get(index);
    if (entry?.done === true)
      entry.plan = copyEntry(plan);
  }

  // モザイクを 1 つ追加しただけのサムネイルは、描き直さずに、追加した範囲だけを塗る（決定99 ①。mosaic-append.js。setPlan の repaint）。
  // 初めて使う時に作る（mosaic-append.js を読み込む順番に頼らないため）。
  let appender = null;

  function thumbAppender() {
    appender ??= root.SigK.mosaicAppend?.create({
      drawn: drawnThumb,
      current: (index) => state.plan[index],
      watch: (index, drawn) => {
        const token = state.token;
        return () => token === state.token && drawnThumb(index)?.canvas === drawn.canvas;
      },
      paint: (index, drawn, mosaic, alive) => root.SigK.mosaicRegion.paintAppended(el.doc, drawn.canvas, drawn.page, drawn.viewport, mosaic, {
        alive,
        track: (task) => {
          const entry = state.rendered.get(index);
          if (entry?.canvas === drawn.canvas)
            entry.task = task;
        },
      }),
      finish: (index, plan) => markDrawn(index, plan),
      redraw: (index) => {
        releaseThumb(index, { keepPicture: true });
        schedule();
      },
      report: (error, index) => report(error, { page: index + 1 }),
    }) ?? null;
    return appender;
  }

  async function renderThumb(index) {
    if (state.rendered.has(index))
      return;

    const token = state.token;
    // canvas・viewport・done は描き終えた絵、source と plan はその絵の文書とページ番号・描いた時の並びの要素（決定99 ②）。
    const entry = { task: null, page: null, source: null, plan: copyEntry(state.plan[index]), canvas: null, viewport: null, done: false };
    state.rendered.set(index, entry);
    const isStale = () => token !== state.token || state.rendered.get(index) !== entry;

    try {
      // 表示上の index から、描くべき文書とページ番号を引く（spec-1-5 確定事項44・
      // spec-1-6 確定事項93）。差し込んだページは別の文書から来る。
      const source = root.SigK.pagePlan.sourceOf(state.plan, index, state);
      if (source === null) {
        state.rendered.delete(index);
        return;
      }
      entry.source = source;
      const page = await source.doc.getPage(source.number);
      entry.page = page;
      if (isStale())
        return;

      // 幅が sheetWidth ピクセルになる倍率で描く。実寸の何倍かは問わない
      // （確定事項7）。devicePixelRatio の上限もページビューより低い。
      //
      // pageWidth は plan を当てたあとの寸法（回転済み）なので、回転した紙でも
      // 幅がはみ出さない。
      const scale = layout().thumbnailScale({
        sheetWidth: state.layout.sheetWidth,
        pageWidth: state.sizes[index]?.width ?? 0,
        devicePixelRatio: root.devicePixelRatio,
      });
      const rotation = (page.rotate ?? 0) + (state.plan[index]?.rotate ?? 0);
      // 切った範囲で描く（spec-4b-6a 確定事項6）。
      const viewport = root.SigK.pageViewbox.viewportFor(page, { scale, rotation, box: state.plan[index]?.crop ?? null });
      // 描いた時の viewport（決定99 ②。drawnThumb が返す）。
      entry.viewport = viewport;
      if (!canDrawCanvas())
        return;

      const canvas = el.doc.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      entry.task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      await entry.task.promise;
      // モザイクの下見（spec-4b-6b 確定事項7。塗り方は決定99 ① の mosaic-region.js）。pdf.js の既定の描き方で描いたので、annotationMode は渡さない。
      await root.SigK.mosaicRegion?.paintRegions(el.doc, canvas, page, viewport, state.plan[index]?.mosaic, { track: (task) => { entry.task = task; } });
      if (isStale())
        return;
      // 表示していた前の絵と入れ替える。
      const replaced = held.get(index);
      held.delete(index);
      el.sheets[index]?.replaceChildren(canvas);
      entry.canvas = canvas;
      entry.done = true;
      keepReplaced(replaced, entry.plan);
    } catch (error) {
      const own = state.rendered.get(index) === entry;
      if (own)
        state.rendered.delete(index);
      // スクロールで捨てた描画は失敗ではない。
      if (error?.name === 'RenderingCancelledException')
        return;
      // 描けなかったサムネイルに、前の絵を残したままにしない（releaseThumb の keepPicture・並びの変更）。
      if (own) {
        held.delete(index);
        el.sheets[index]?.replaceChildren();
      }
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
      // 先読みも列数のぶんだけ増やす。多列では1行に何枚も並ぶため、
      // 枚数で数える先読みは行数に換算すると少なくなる。
      ahead: layout().thumbAhead(state.columns),
      // 多列では紙が小さくなるので、枚数を増やしても総メモリは1列時を
      // 下回る（確定事項26）。
      max: layout().maxThumbs(state.columns),
    });

    for (const index of [...state.rendered.keys()]) {
      if (!targets.includes(index))
        releaseThumb(index);
    }
    // 描く範囲から外れたページには、前の絵を残さない（メモリを抱えないため）。
    for (const index of [...held.keys()]) {
      if (!targets.includes(index)) {
        held.delete(index);
        el.sheets[index]?.replaceChildren();
      }
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
      // 幅か列数が変われば紙の寸法が変わるので、枠から作り直す（確定事項27）。
      if (columnWidthNow() !== state.columnWidth || columnsNow() !== state.columns) {
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
  // previousSizes は、上書き保存の後に開き直す時（viewer.reopen）だけ渡す前の文書の寸法。同じ位置で寸法が同じページは、新しい絵を
  // 描き終えるまで前の絵を表示する（決定99 ②）。
  function setDocument({ doc, sizes, plan = null, inserts = [], current = 0, scrollTop = 0, previousSizes = null }) {
    const taken = previousSizes !== null && el !== null && state.doc !== null ? takeThumbs() : null;
    state.token += 1;
    releaseAll();
    keeper.clear();
    state.doc = doc;
    state.inserts = inserts;
    state.sizes = sizes ?? [];
    state.plan = plan ?? (state.sizes.map((_size, index) => ({ src: index, rotate: 0 })));
    state.current = current;
    if (el === null)
      return false;
    if (!isVisible()) {
      discard();
      return false;
    }
    build();
    if (taken !== null)
      fillThumbs(taken, previousSizes);
    el.scroll.scrollTop = scrollTop;
    schedule();
    return true;
  }

  // 並びだけを差し替える（spec-1-5 確定事項29）。setDocument を呼び直すと
  // スクロール位置も描画済みも全部捨てることになるので、編集のたびにそれを
  // やると「1枚回すたびにサイドパネルが先頭へ戻る」ことになる。
  // repaint は、モザイク欄だけが変わったページ位置の並び（viewer.applyPlan が pageMosaic.changedPages で求める）。
  function setPlan(plan, sizes = null, inserts = null, { repaint = null } = {}) {
    const before = state.plan;
    state.plan = plan ?? [];
    if (inserts !== null)
      state.inserts = inserts;
    if (sizes !== null)
      state.sizes = sizes;
    state.current = Math.min(Math.max(0, state.current), Math.max(0, state.plan.length - 1));
    if (el === null)
      return false;
    if (!isVisible()) {
      discard();
      return false;
    }

    // モザイク欄だけが変わったときは、枠を作り直さず、そのページのサムネイルだけを、前の絵を残したまま描き直す（2026-11-17 の不具合
    // 「モザイクを配置するたびに画面がホワイトアウトする」の修正。枠を作り直すと、描き終えるまでサムネイルの白い背景が見えていた）。
    // 枠をまだ作っていなければ（左パネルを開き直した直後など）、下の作り直しへ進む。
    if (Array.isArray(repaint) && el.sheets.length === state.plan.length) {
      for (const index of repaint) {
        if (thumbAppender()?.append(index, before[index], state.plan[index]) !== true)
          releaseThumb(index, { keepPicture: true });
      }
      schedule();
      return true;
    }

    // 並びが変われば紙の高さも順番も変わる。枠は作り直すが、見ている場所
    // （scrollTop）はそのままにする。作り直す前に表示している絵を取り出し、同じページの新しい枠に置く（決定99 ②。前は、描き終えるまで
    // 全部のサムネイルの白い背景が見えていた）。同じページが同じ見た目のまま位置だけ変わったサムネイルは、描き直さない。
    const taken = takeThumbs();
    state.token += 1;
    releaseAll();
    build();
    placeThumbs(before, taken);
    schedule();
    return true;
  }

  function clear() {
    state.doc = null;
    state.inserts = [];
    state.sizes = [];
    state.plan = [];
    state.current = 0;
    if (el === null)
      return false;
    discard();
    return true;
  }

  function getScrollTop() {
    return el === null ? 0 : el.scroll.scrollTop;
  }

  // いま並べてある配置。ページモードのドラッグが、落とす位置を計算するのに
  // 借りる（spec-1-5 確定事項33）。
  function getLayout() {
    return state.layout;
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
    // 文書が無ければ「文書を開くと…」の案内。編集モードで注釈一覧からサムネイルへ戻したときも出し直す
    // （spec-4b-1a 確定事項16）。
    if (state.doc === null) {
      el.empty.hidden = false;
      return false;
    }
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
    if (!Number.isInteger(index))
      return;
    // ページモードではクリックが選択の操作になる（spec-1-5 確定事項15〜17）。
    // 閲覧モードのサイドパネルは地図のままで、選択の概念を持ち込まない。
    if (root.SigK.pageGrid?.handleClick(index, event) === true)
      return;
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
    setPlan,
    clear,
    getLayout,
    setCurrent,
    refresh,
    getScrollTop,
    getState,
    // 前の絵を表示し続ける（決定99 ②）と、① のモザイクの範囲だけを塗る処理に渡す口（決定99）。
    standIn,
    prepare,
    drawnThumb,
    markDrawn,
  };
})(typeof window !== 'undefined' ? window : globalThis);
