(function (root) {
  'use strict';

  // 透かしのプレビュー（spec-4-5 確定事項5。モックの確定「右に置く」）。
  //
  // 対象の PDF を pdf.js で開いたまま持ち、見ているページを縮小して canvas に描き（page-image.js）、
  // 同じ幾何（watermark-geometry.js）で透かしを SVG で重ねる。文字は保存と同じ字形の
  // 'SigK Noto Sans JP'、画像はその画像（Blob URL）。設定を変えてもページの絵は描き直さず、
  // 透かしの SVG だけを組み直す。透かしを入れないページは透かし無しで見せる。

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // 紙を収める枠（CSS px）。
  const BOX = Object.freeze({ width: 248, height: 300 });

  const state = { path: null, task: null, doc: null, pageCount: 0, index: 0, ticket: 0, page: null, imageKey: null, imageUrl: null };
  let el = null;

  const tool = () => root.SigK.toolsWatermark;
  const planner = () => root.SigK.watermarkPlan;
  const geometry = () => root.SigK.watermarkGeometry;

  function fmt(value) {
    return String(Math.round(value * 1000) / 1000);
  }

  async function close() {
    state.ticket += 1;
    const task = state.task;
    Object.assign(state, { path: null, task: null, doc: null, pageCount: 0, index: 0, page: null });
    await task?.destroy?.();
  }

  // 対象が変わったら開き直す（確定事項5）。同じファイルなら開き直さない。
  async function setSource(src) {
    if (el === null)
      return;
    const path = src !== null && !src.pending && src.blocked === null ? src.path : null;
    if (path === state.path && (path === null || state.doc !== null))
      return update();
    await close();
    state.path = path;
    if (path === null)
      return update();
    const ticket = state.ticket;
    const read = await root.pdfAPI.read(path);
    if (ticket !== state.ticket)
      return undefined;
    const task = read?.error === undefined ? root.SigK.pdfjs.getDocument({ data: read.bytes }) : null;
    if (task !== null)
      task.onPassword = (answer) => answer(new Error('パスワード付きの PDF は扱えません'));
    const doc = task === null ? null : await task.promise.catch(() => null);
    if (ticket !== state.ticket) {
      await task?.destroy?.();
      return undefined;
    }
    if (doc === null) {
      await task?.destroy?.();
      return update();
    }
    Object.assign(state, { task, doc, pageCount: doc.numPages });
    const plan = tool().currentPlan();
    return showPage(plan.ready ? plan.pages[0] : 0);
  }

  // ページの絵を描き直す（ページか対象を変えたときだけ）。
  async function showPage(index) {
    if (state.doc === null || index < 0 || index >= state.pageCount)
      return;
    const ticket = state.ticket;
    state.index = index;
    const page = await state.doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(BOX.width / base.width, BOX.height / base.height);
    const rendered = await root.SigK.pageImage.renderToCanvas(el.doc, page, { scale });
    if (ticket !== state.ticket || state.index !== index)
      return;
    const swapped = page.rotate % 180 !== 0;
    const view = Array.isArray(page.view) ? page.view : [0, 0, swapped ? base.height : base.width, swapped ? base.width : base.height];
    state.page = { view, rotate: page.rotate ?? 0, display: { width: base.width, height: base.height } };
    el.canvas.replaceChildren(...(rendered.canvas === null ? [] : [rendered.canvas]));
    el.page.style.width = `${rendered.width}px`;
    el.page.style.height = `${rendered.height}px`;
    update();
  }

  function isTargetPage(settings) {
    const resolved = planner().targetPages(settings, state.pageCount);
    return resolved.pages?.includes(state.index) === true;
  }

  // 画像の Blob URL。画像が変わったときだけ作り直す。
  function imageUrlOf(image) {
    const key = image?.bytes ?? null;
    if (key === state.imageKey)
      return state.imageUrl;
    if (state.imageUrl !== null)
      el.win.URL.revokeObjectURL?.(state.imageUrl);
    state.imageKey = key;
    state.imageUrl = key !== null && typeof el.win.URL.createObjectURL === 'function'
      ? el.win.URL.createObjectURL(new el.win.Blob([key], { type: image.kind === 'png' ? 'image/png' : 'image/jpeg' }))
      : null;
    return state.imageUrl;
  }

  // 透かしの素の箱と、中に描くもの。描けなければ null。
  function markOf(settings, image) {
    const shape = root.SigK.freeTextShape;
    if (settings.type === 'text') {
      const text = planner().normalizeText(settings.text);
      if (text === '')
        return null;
      const node = el.doc.createElementNS(SVG_NS, 'text');
      Object.entries({ x: 0, y: geometry().TEXT_BASELINE, 'text-anchor': 'middle', 'font-size': geometry().TEXT_SIZE, fill: settings.color, 'fill-opacity': settings.opacity })
        .forEach(([key, value]) => node.setAttribute(key, String(value)));
      node.style.fontFamily = `"${shape.FAMILY}"`;
      node.textContent = text;
      return { width: shape.measure(el.doc, text, geometry().TEXT_SIZE), height: geometry().TEXT_HEIGHT, node };
    }
    if (image === null || image.pending || image.error !== null || !(image.width > 0))
      return null;
    const height = geometry().imageBoxHeight(image.width, image.height);
    const node = el.doc.createElementNS(SVG_NS, 'image');
    const url = imageUrlOf(image);
    Object.entries({ x: -geometry().IMAGE_WIDTH / 2, y: -height / 2, width: geometry().IMAGE_WIDTH, height, opacity: settings.opacity, preserveAspectRatio: 'none' })
      .forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (url !== null)
      node.setAttribute('href', url);
    return { width: geometry().IMAGE_WIDTH, height, node };
  }

  // 透かしの SVG と見出し・ページ送りを組み直す（設定を変えるたびに呼ばれる）。
  function update() {
    if (el === null)
      return;
    const ready = state.doc !== null && state.page !== null;
    el.empty.hidden = ready;
    el.overlay.replaceChildren();
    setDisabled(el.prev, !ready || state.index <= 0);
    setDisabled(el.next, !ready || state.index >= state.pageCount - 1);
    if (!ready) {
      el.caption.textContent = '';
      return;
    }
    const settings = tool().settings();
    const target = isTargetPage(settings);
    el.caption.textContent = `${state.index + 1} ページ目（全 ${state.pageCount} ページ）${target ? '' : '（透かしを入れないページ）'}`;
    const { display, view, rotate } = state.page;
    el.overlay.setAttribute('viewBox', `0 0 ${fmt(display.width)} ${fmt(display.height)}`);
    const mark = target ? markOf(settings, tool().image()) : null;
    if (mark === null)
      return;
    const placed = geometry().displayPlacementOf({ box: view, rotate, width: mark.width, height: mark.height, angle: settings.angle, size: settings.size, position: settings.position });
    if (placed === null)
      return;
    const group = el.doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('transform', `translate(${fmt(placed.cx)} ${fmt(placed.cy)}) rotate(${fmt(-placed.angle)}) scale(${fmt(placed.scale)})`);
    group.append(mark.node);
    el.overlay.append(group);
  }

  const setDisabled = (node, disabled) => (disabled ? node.setAttribute('aria-disabled', 'true') : node.removeAttribute('aria-disabled'));

  function step(delta) {
    const next = state.index + delta;
    if (state.doc === null || next < 0 || next >= state.pageCount)
      return Promise.resolve(false);
    return showPage(next).then(() => true);
  }

  function init(doc, win) {
    if (win.__sigkWatermarkPreviewReady === true)
      return false;
    const page = doc.getElementById('wm-preview-page');
    if (page === null)
      return false;
    win.__sigkWatermarkPreviewReady = true;
    const byId = (id) => doc.getElementById(id);
    el = {
      doc, win, page, canvas: byId('wm-preview-canvas'), overlay: byId('wm-preview-overlay'), empty: byId('wm-preview-empty'),
      caption: byId('wm-preview-cap'), prev: byId('wm-preview-prev'), next: byId('wm-preview-next'),
    };
    el.prev.addEventListener('click', () => { if (el.prev.getAttribute('aria-disabled') !== 'true') step(-1); });
    el.next.addEventListener('click', () => { if (el.next.getAttribute('aria-disabled') !== 'true') step(1); });
    // 保存と同じ字形で測って描くため、同梱フォントを先に読む（読めたら組み直す）。
    root.SigK.freeTextShape.ensureLoaded(doc).then((loaded) => { if (loaded) update(); });
    update();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.watermarkPreview = {
    BOX, init, setSource, showPage, update, step,
    pageIndex: () => state.index,
    pageCount: () => state.pageCount,
  };
})(typeof window !== 'undefined' ? window : globalThis);
