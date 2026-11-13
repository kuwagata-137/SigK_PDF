(function (root) {
  'use strict';

  // 印刷画面のプレビュー（docs/spec-7-7-print-dialog.md・ユーザーの画面写真 1・2）。
  //
  // 用紙 1 枚（シート）を縮小して描き、上に用紙の寸法（「297.00 x 210.00 ミリ」）、左上に倍率（サイズの時だけ。「倍率 : 113%」）、
  // 下に［<］スライダー［>］と「1 / 21 ページ」（複数の時は「 (最初のページ番号)」を足す）を表示する。
  // 用紙は、黒い枠（2 px）を含めて 210 × 276 px の中に収める。黒い枠の内側の位置は、内側の大きさ（端数のまま）から
  // 中心がプレビューの内側の左から 150.5 px・上から 185 px になるように四捨五入して決める（画面写真 1 の横の用紙と、2 の縦の用紙の位置が両方合う）。
  // 用紙の寸法の文字は、文字の左端が用紙の左端の 2 px 右・文字の下端が用紙の上の 12 px 上になるように置く（画面写真 1・2 の位置）。
  // 描くのは印刷と同じ合成（print-sheet-render.js）。

  const BOX = Object.freeze({ width: 210, height: 276, border: 2, centerX: 150.5, centerY: 185 });
  const SIZE_LABEL = Object.freeze({ dx: 1, dy: -24 });
  const UM_PER_INCH = 25400;

  const ctx = { el: null, plan: null, job: null, index: 0, token: 0, mode: 'size' };

  const $ = (id) => ctx.el.doc.getElementById(id);
  const mm = (um) => (um / 1000).toFixed(2);

  function setStatus(text) {
    const node = $('print-preview-status');
    node.textContent = text ?? '';
    node.hidden = text === null || text === undefined || text === '';
  }

  function clearSheet() {
    $('print-preview-paper').hidden = true;
    $('print-preview-paper').replaceChildren();
    $('print-preview-size').textContent = '';
    $('print-preview-scale').textContent = '';
    $('print-preview-count').textContent = '';
    for (const id of ['print-preview-prev', 'print-preview-next', 'print-preview-slider'])
      $(id).disabled = true;
  }

  // 用紙の内側（黒い枠の内側）の大きさを決めてから、枠の分を足す。返すのは内側の大きさ（描く画像の大きさ）。
  function placePaper(sheet) {
    const edge = BOX.border * 2;
    const ratio = Math.min((BOX.width - edge) / sheet.width, (BOX.height - edge) / sheet.height);
    const exactWidth = sheet.width * ratio;
    const exactHeight = sheet.height * ratio;
    const width = Math.max(1, Math.round(exactWidth));
    const height = Math.max(1, Math.round(exactHeight));
    const left = Math.round(BOX.centerX - exactWidth / 2) - BOX.border;
    const top = Math.round(BOX.centerY - exactHeight / 2) - BOX.border;
    Object.assign($('print-preview-paper').style, { left: `${left}px`, top: `${top}px`, width: `${width + edge}px`, height: `${height + edge}px` });
    Object.assign($('print-preview-size').style, { left: `${left + SIZE_LABEL.dx}px`, top: `${top + SIZE_LABEL.dy}px` });
    return { width, height };
  }

  function renderNav(count) {
    const slider = $('print-preview-slider');
    slider.max = String(Math.max(1, count));
    slider.value = String(ctx.index + 1);
    slider.disabled = count <= 1;
    // Acrobat と同じく、最初と最後の用紙でも［<］［>］は押せる見た目のままにする（押しても何もしない。go を参照）。
    $('print-preview-prev').disabled = false;
    $('print-preview-next').disabled = false;
  }

  function countText(sheet, count) {
    const first = sheet.items.find((item) => item.page !== null)?.page;
    const suffix = ctx.mode === 'multiple' && first !== undefined ? ` (${first})` : '';
    return `${ctx.index + 1} / ${count} ページ${suffix}`;
  }

  // 今のシートを描く。古い描画（設定を続けて変えた時）は token で捨てる。
  async function draw() {
    const { plan, job } = ctx;
    if (plan === null || job === null || plan.sheets.length === 0) {
      clearSheet();
      return;
    }
    const mine = (ctx.token += 1);
    const count = plan.sheets.length;
    ctx.index = Math.min(Math.max(0, ctx.index), count - 1);
    const sheet = plan.sheets[ctx.index];
    setStatus(null);
    const box = placePaper(sheet);
    $('print-preview-paper').hidden = false;
    $('print-preview-size').textContent = `${mm(sheet.width)} x ${mm(sheet.height)} ミリ`;
    $('print-preview-scale').textContent = ctx.mode === 'size' ? `倍率 : ${sheet.scalePercent}%` : '';
    $('print-preview-count').textContent = countText(sheet, count);
    renderNav(count);
    // jsdom（試験）には 2D コンテキストが無い。文字の表示までにする。
    if (!root.SigK.pageImage.hasCanvas(ctx.el.doc.defaultView))
      return;
    const scale = ctx.el.doc.defaultView?.devicePixelRatio ?? 1;
    const dpi = (box.width * scale) / (sheet.width / UM_PER_INCH);
    const drawn = await root.SigK.printSheetRender.composeSheet(ctx.el.doc, sheet, {
      dpi,
      forPrint: false,
      grayscale: job.grayscale,
      inkSave: job.inkSave,
      renderPart: root.SigK.printJob.partRenderer(ctx.el.doc, job.annotations),
      labelOf: root.SigK.printJob.labelMaker(root.SigK.viewer.getState().file?.name, new Date()),
    }).catch(() => ({ canvas: null }));
    if (mine !== ctx.token || drawn.canvas === null) {
      root.SigK.pageImage.release(drawn.canvas);
      return;
    }
    $('print-preview-paper').replaceChildren(drawn.canvas);
  }

  // 配置を受け取って描く。keepIndex なら、今見ている用紙の番号を保つ。
  function show({ plan, job, mode, keepIndex = true }) {
    ctx.plan = plan;
    ctx.job = job;
    ctx.mode = mode ?? 'size';
    if (!keepIndex)
      ctx.index = 0;
    return draw();
  }

  // プリンターの設定を取得している間・ページ指定が読めない時など。
  function showStatus(text) {
    ctx.token += 1;
    ctx.plan = null;
    clearSheet();
    setStatus(text);
  }

  function go(index) {
    if (ctx.plan === null || index < 0 || index >= ctx.plan.sheets.length || index === ctx.index)
      return;
    ctx.index = index;
    draw();
  }

  function init(doc) {
    if (ctx.el !== null)
      return false;
    ctx.el = { doc };
    $('print-preview-prev').addEventListener('click', () => go(ctx.index - 1));
    $('print-preview-next').addEventListener('click', () => go(ctx.index + 1));
    $('print-preview-slider').addEventListener('input', (event) => go(Number(event.currentTarget.value) - 1));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printPreview = { BOX, init, show, showStatus, getIndex: () => ctx.index, drawn: () => ctx.token };
})(typeof window !== 'undefined' ? window : globalThis);
