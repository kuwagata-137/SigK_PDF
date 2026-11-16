(function (root) {
  'use strict';

  // 印刷の準備（docs/spec-7-7-print-dialog.md）: 印刷するページ → 用紙 1 枚ごとの配置 → シートの画像（PNG の data URL）。
  //
  // 印刷画面の指定（settings）は print-dialog.js が組む。ここは DOM の印刷画面に触らない（画面に見えている範囲を読むだけ）。
  // 1 枚ずつ描いて PNG にし、canvas を捨てる（spec-1-4 確定事項32）。

  // pdf.js viewer の PRINT_RESOLUTION と同じ 150dpi（spec-1-4 確定事項31）。用紙の上でこの解像度になるように描く。
  const PRINT_DPI = 150;

  const viewer = () => root.SigK.viewer;
  const R = () => root.SigK.printPageRegion;

  // 現在の表示範囲(V): 画面に見えているページの部分の割合。分からなければ null（ページ全体を印刷する）。
  function visibleFraction(doc, number) {
    const view = doc.getElementById('view');
    const node = doc.querySelector(`#view-pages .pdf-page[data-page="${number}"]`);
    if (view === null || node === null)
      return null;
    const page = node.getBoundingClientRect();
    const box = view.getBoundingClientRect();
    if (!(page.width > 0 && page.height > 0 && view.clientWidth > 0))
      return null;
    const outer = { x: box.left + view.clientLeft, y: box.top + view.clientTop, width: view.clientWidth, height: view.clientHeight };
    const hit = R().intersect({ x: page.left, y: page.top, width: page.width, height: page.height }, outer);
    if (hit === null)
      return null;
    return { x: (hit.x - page.left) / page.width, y: (hit.y - page.top) / page.height, width: hit.width / page.width, height: hit.height / page.height };
  }

  // 配置の計算に渡すページ（大きさは pt。画面で見た大きさ）。
  function pageDescriptors(doc, numbers, { visibleOnly = false } = {}) {
    const sizes = viewer().getSizes();
    return numbers.map((number) => {
      const size = sizes[number - 1] ?? { width: 0, height: 0 };
      const view = visibleOnly ? visibleFraction(doc, number) : null;
      if (view === null)
        return { number, width: size.width, height: size.height };
      return { number, width: size.width * view.width, height: size.height * view.height, view };
    });
  }

  function entriesOf(number) {
    const plan = viewer().getPlan();
    const src = plan[number - 1]?.src;
    if (!Number.isInteger(src))
      return [];
    return root.SigK.annotationState.annotsOnPage(viewer().getAnnotations(), viewer().getImported(), src);
  }

  function storageOf(number) {
    const state = viewer().peek?.();
    if (state === null || state === undefined)
      return null;
    return root.SigK.pagePlan.sourceOf(state.plan, number - 1, state)?.doc?.annotationStorage ?? null;
  }

  // ページの部分を描く口（print-sheet-render.js の renderPart）。注釈の一覧は一度だけ pdf.js に聞く。
  function partRenderer(doc, mode) {
    const annotations = new Map();
    const annotationsOf = async (number, page) => {
      if (mode === 'markups')
        return [];
      if (!annotations.has(number))
        annotations.set(number, (await Promise.resolve(page.getAnnotations?.()).catch(() => [])) ?? []);
      return annotations.get(number);
    };
    return async (source, part, pxPerPt) => {
      const page = await viewer().getPage(source.number);
      if (page === null || page === undefined)
        return { canvas: null, width: 0, height: 0 };
      const entry = viewer().getPlan()[source.number - 1];
      const rotation = viewer().viewportRotation(source.number, page);
      const region = source.view ? R().within(source.view, part) : part;
      const full = region.x <= 1e-9 && region.y <= 1e-9 && region.width >= 1 - 1e-9 && region.height >= 1 - 1e-9;
      const box = full ? (entry?.crop ?? null) : R().regionBox(entry?.crop ?? page.view, rotation, region);
      const drawn = await root.SigK.printComments.renderPage(doc, page, {
        mode,
        src: entry?.src,
        annotations: await annotationsOf(source.number, page),
        storage: storageOf(source.number),
        scale: pxPerPt,
        rotation,
        box,
        mosaic: entry?.mosaic ?? null,
        maxPixels: root.SigK.pageImage.MAX_CANVAS_PIXELS,
      });
      // 試験と起動確認のために、描いた回転・範囲・倍率も返す（spec-1-5 確定事項39・spec-4b-6a 確定事項25）。
      return { ...drawn, rotation, box, scale: pxPerPt, sourcePage: page.pageNumber ?? null };
    };
  }

  // ポスターのラベル「ファイル名 日時 ページ 番号 (列,行)」。
  function labelMaker(fileName, now) {
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return (tile) => `${fileName ?? ''} ${stamp} ページ ${tile.label.page} (${tile.label.col},${tile.label.row})`;
  }

  // 配置を作る。settings は { pages（ページ番号の並び）, visibleOnly, summary, layout（配置の計算の指定）, paper, imageable, paperSizes }。
  function planFor(doc, settings) {
    let pages = pageDescriptors(doc, settings.pages, { visibleOnly: settings.visibleOnly === true });
    if (settings.summary === true)
      pages = root.SigK.printSummary.withSummaries(pages, { fileName: viewer().getState().file?.name, entriesOf });
    return root.SigK.printSheetPlan.build({
      pages, paper: settings.paper, imageable: settings.imageable, options: settings.layout, paperSizes: settings.paperSizes,
    });
  }

  // シートの画像を作る。onProgress(done, total)、isAlive() が false になったら途中でやめる（{ canceled: true }）。
  async function buildImages(doc, plan, settings, { onProgress = () => {}, isAlive = () => true } = {}) {
    const renderPart = partRenderer(doc, settings.annotations ?? 'markups');
    const labelOf = labelMaker(viewer().getState().file?.name, new Date());
    const images = [];
    const rendered = [];
    for (let index = 0; index < plan.sheets.length; index += 1) {
      onProgress(index, plan.sheets.length);
      const sheet = plan.sheets[index];
      const drawn = await root.SigK.printSheetRender.composeSheet(doc, sheet, {
        dpi: PRINT_DPI, forPrint: true, grayscale: settings.grayscale === true, inkSave: settings.inkSave === true, renderPart, labelOf,
      });
      if (!isAlive()) {
        root.SigK.pageImage.release(drawn.canvas);
        return { canceled: true };
      }
      rendered.push(...drawn.rendered);
      const image = drawn.canvas === null ? { url: null, bytes: 0 } : root.SigK.pageImage.toDataUrl(drawn.canvas);
      root.SigK.pageImage.release(drawn.canvas);
      images.push({ sheet, url: image.url, bytes: image.bytes });
    }
    onProgress(plan.sheets.length, plan.sheets.length);
    const jobs = root.SigK.printSheetPlan.groupJobs(plan.sheets).map((job) => ({
      paper: job.paper,
      images: images.filter((image) => job.sheets.includes(image.sheet)),
    }));
    return { ok: true, jobs, rendered, sheets: plan.sheets.length };
  }

  // 配置を作り、シートの画像を作って、最初の印刷の分を #print-area に並べる（印刷の手前まで）。isAlive() が false になったら
  // { canceled: true }。戻り値の rendered は描いたページの部分（試験と起動確認が見る）。
  async function prepareImages(doc, area, job, { isAlive = () => true, onProgress } = {}) {
    await root.SigK.freeTextShape?.ensureLoaded(doc);
    const plan = planFor(doc, job);
    if (plan.error !== undefined)
      return { error: plan.error };
    const startedAt = root.performance?.now?.() ?? 0;
    let built = null;
    try {
      built = await buildImages(doc, plan, job, { isAlive, onProgress });
    } catch (error) {
      root.SigK.log?.report({ level: 'error', message: error?.message ?? String(error), stack: error?.stack, context: { source: 'print' } });
      return { error: 'ページを画像に変換できませんでした。' };
    }
    if (built.canceled === true || !isAlive())
      return { canceled: true };
    const placed = root.SigK.printSend.fillArea(doc, area, built.jobs[0]);
    await root.SigK.printSend.waitForImages(area);
    if (!isAlive()) {
      area.replaceChildren();
      return { canceled: true };
    }
    const images = built.jobs.flatMap((entry) => entry.images.map(({ bytes }) => ({ bytes })));
    return {
      ok: true, pages: job.pages, placed, sheets: built.sheets, jobs: built.jobs, duplexMode: plan.duplexMode, rendered: built.rendered, images,
      elapsedMs: Math.round((root.performance?.now?.() ?? 0) - startedAt),
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printJob = { PRINT_DPI, visibleFraction, pageDescriptors, partRenderer, labelMaker, planFor, buildImages, prepareImages };
})(typeof window !== 'undefined' ? window : globalThis);
