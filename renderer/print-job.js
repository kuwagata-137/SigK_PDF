(function (root) {
  'use strict';

  // 印刷の準備（docs/spec-7-7-print-dialog.md）: 印刷するページ → 用紙 1 枚ごとの配置 → シート画像（PNG 形式。blob URL）。
  //
  // 印刷画面の指定（settings）は print-dialog.js が組む。ここは DOM の印刷画面に触らない（画面に見えている範囲を読むだけ）。
  // 1 枚ずつ描いて PNG にし、canvas を捨てる（spec-1-4 確定事項32）。blob URL は、送り終えた時・中止した時・失敗した時に
  // releaseImages で解放する（決定97 ⑤）。

  // 用紙の上でこの解像度になるように描く。以前は pdf.js viewer の PRINT_RESOLUTION と同じ 150dpi だった（spec-1-4 確定事項31）が、
  // 600dpi のプリンターでは縦横 4 倍に拡大されて滲むので、300dpi にした（決定97 ⑤。A4 1 枚 2480 × 3508 画素）。
  const PRINT_DPI = 300;
  const PRINT_SCALE = PRINT_DPI / 72;

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

  // シート画像を指す blob URL を解放する。jobs は buildImages が返す jobs（null・undefined なら何もしない）。
  function releaseImages(jobs) {
    for (const job of jobs ?? []) {
      for (const image of job.images ?? [])
        root.SigK.pageImage.revokeUrl(image.url);
    }
  }

  // シート画像を PNG 形式の blob URL にして、canvas を捨てる。jsdom では canvas が無いので url は null。
  async function encodeSheet(canvas) {
    if (canvas === null)
      return { url: null, bytes: 0 };
    try {
      return await root.SigK.pageImage.toObjectUrl(canvas);
    } finally {
      root.SigK.pageImage.release(canvas);
    }
  }

  // シートの画像を作る。onProgress(done, total)、isAlive() が false になったら途中でやめる（{ canceled: true }）。
  // 用紙が大きく、PRINT_DPI で描くと画素数上限を超える時は、その用紙だけ解像度を下げる（print-sheet-render.js の cappedDpi）。
  // 途中でやめた時と失敗した時は、作った分の URL を解放する。
  async function buildImages(doc, plan, settings, { onProgress = () => {}, isAlive = () => true } = {}) {
    const renderPart = partRenderer(doc, settings.annotations ?? 'markups');
    const labelOf = labelMaker(viewer().getState().file?.name, new Date());
    const render = root.SigK.printSheetRender;
    const images = [];
    const rendered = [];
    try {
      for (let index = 0; index < plan.sheets.length && isAlive(); index += 1) {
        onProgress(index, plan.sheets.length);
        const sheet = plan.sheets[index];
        const drawn = await render.composeSheet(doc, sheet, {
          dpi: render.cappedDpi(sheet, PRINT_DPI), forPrint: true, grayscale: settings.grayscale === true, inkSave: settings.inkSave === true, renderPart, labelOf,
        });
        if (!isAlive()) {
          root.SigK.pageImage.release(drawn.canvas);
          break;
        }
        rendered.push(...drawn.rendered);
        images.push({ sheet, ...(await encodeSheet(drawn.canvas)) });
      }
    } catch (error) {
      releaseImages([{ images }]);
      throw error;
    }
    if (!isAlive()) {
      releaseImages([{ images }]);
      return { canceled: true };
    }
    onProgress(plan.sheets.length, plan.sheets.length);
    const jobs = root.SigK.printSheetPlan.groupJobs(plan.sheets).map((job) => ({
      paper: job.paper,
      images: images.filter((image) => job.sheets.includes(image.sheet)),
    }));
    return { ok: true, jobs, rendered, sheets: plan.sheets.length };
  }

  // 配置を作り、シート画像を作る（印刷の手前まで）。place が true（既定）なら、最初の印刷分を #print-area に並べる
  // （SigK.print.prepare。試験と起動確認が並んだ画像を見る）。［印刷］（print.js の run）は false を渡し、並べるのは
  // print-send.js の send だけにする（同じ画像を 2 回並べない。決定97 ⑤）。isAlive() が false になったら { canceled: true }。
  // 戻り値 jobs が持つシート画像の URL は、呼び出し元が releaseImages で解放する。rendered は描いたページの部分（試験と起動確認が見る）。
  async function prepareImages(doc, area, job, { isAlive = () => true, onProgress, place = true } = {}) {
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
    if (built.canceled === true)
      return { canceled: true };
    const placed = place ? root.SigK.printSend.fillArea(doc, area, built.jobs[0]) : 0;
    if (place)
      await root.SigK.printSend.waitForImages(area);
    if (!isAlive()) {
      if (place)
        area.replaceChildren();
      releaseImages(built.jobs);
      return { canceled: true };
    }
    const images = built.jobs.flatMap((entry) => entry.images.map(({ bytes }) => ({ bytes })));
    return {
      ok: true, pages: job.pages, placed, sheets: built.sheets, jobs: built.jobs, duplexMode: plan.duplexMode, rendered: built.rendered, images,
      elapsedMs: Math.round((root.performance?.now?.() ?? 0) - startedAt),
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printJob = { PRINT_DPI, PRINT_SCALE, visibleFraction, pageDescriptors, partRenderer, labelMaker, planFor, buildImages, releaseImages, prepareImages };
})(typeof window !== 'undefined' ? window : globalThis);
