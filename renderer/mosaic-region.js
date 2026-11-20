(function (root) {
  'use strict';

  // 範囲の絵から色を読む塗り方（決定99 ①。表示とサムネイル用）。区切りと平均色の塗り方そのものは mosaic-paint.js の paint。
  //
  // 大きな canvas から getImageData で色を読むと、2 回目の読み出しで canvas 全体が GPU から CPU のメモリーへ移され、倍率 200% で
  // 1 回 0.5〜0.8 秒かかった（2026-11-17 の調査）。そこで、画素の四角が重なり合う範囲のまとまりごとに、その四角だけを pdf.js で小さな
  // canvas に描いて 1 回だけ色を読み、置いた順に塗って、範囲の画素だけを表示中の canvas へ書き込む。表示のみの書き込みがあるページは、
  // 四角を 2 回（canvas と同じ描き方・書き込みを描かない DISABLE）描き、paintOver と同じく、2 つの絵で色が違う画素を残す。
  // 100 万画素未満の canvas（サムネイル・低い倍率）で表示のみの書き込みが無いページは、四角を描かずに表示中の canvas から読む（調査で、
  // この方が速かった）。区切りは canvas 全体の viewport で計算する（paint と同じ式。四角を描いた viewport で計算すると、丸め誤差で
  // 区切りが 1 画素ずれるおそれがある）。印刷（page-image.js）は paintOver、保存（mosaic-save.js・image-render.js）は paint のまま使う。
  const DIRECT_PIXELS = 1000000;

  function mosaicPaint() {
    return root.SigK.mosaicPaint;
  }

  function disabledMode() {
    return root.SigK.pdfjs?.lib?.AnnotationMode?.DISABLE;
  }

  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

  // canvas に塗れるか（2D コンテキストから色を読めるか）。jsdom では false。
  function canPaint(canvas) {
    return typeof canvas?.getContext === 'function' && typeof canvas.getContext('2d')?.getImageData === 'function';
  }

  // 範囲 item が canvas（size）の中で占める画素の四角。区切りが正しくない・canvas の外なら null。
  function rectOf(viewport, item, size) {
    if (root.SigK.pageMosaic.gridOf(item?.box, item?.block) === null)
      return null;
    const rect = mosaicPaint().clipRect(mosaicPaint().pixelRectOf(viewport, ...item.box), size.width, size.height);
    return rect[2] > rect[0] && rect[3] > rect[1] ? rect : null;
  }

  // モザイクの並びを、画素の四角が重なり合う範囲のまとまりに分ける。まとまりは { items, rects, area }（items は置いた順、rects は
  // 範囲ごとの四角、area は rects を囲む四角）。違うまとまりの範囲は画素を共有しないので、まとまりごとに塗れる。
  function groupsOf(viewport, mosaic, size) {
    let groups = [];
    (mosaic ?? []).forEach((item, order) => {
      const rect = rectOf(viewport, item, size);
      if (rect === null)
        return;
      const hit = groups.filter((members) => members.some((member) => overlaps(member.rect, rect)));
      const merged = [...hit.flat(), { item, order, rect }].sort((a, b) => a.order - b.order);
      groups = [...groups.filter((members) => !hit.includes(members)), merged];
    });
    return groups
      .sort((a, b) => a[0].order - b[0].order)
      .map((members) => ({ items: members.map((m) => m.item), rects: members.map((m) => m.rect), area: members.map((m) => m.rect).reduce(union) }));
  }

  // 四角 area の画素 image を、canvas 全体（size）の 2D コンテキストと同じ形で読み書きできるようにする（paint をそのまま使うため）。
  function areaContext(image, [left, top], size) {
    const at = (x, y) => ((y - top) * image.width + x - left) * 4;
    return {
      canvas: size,
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row += 1)
          data.set(image.data.subarray(at(x, y + row), at(x + w, y + row)), row * w * 4);
        return { data, width: w, height: h };
      },
      putImageData(part, x, y) {
        for (let row = 0; row < part.height; row += 1)
          image.data.set(part.data.subarray(row * part.width * 4, (row + 1) * part.width * 4), at(x, y + row));
      },
    };
  }

  // pdf.js が canvas に描く表示のみの書き込み（PDF の注釈）があるページか。調べられない・失敗したときは、あるとみなす（四角を 2 回
  // 描けば、paintOver と同じ塗り方になる）。
  async function hasAnnotations(page) {
    try {
      const annotations = await page.getAnnotations();
      return !Array.isArray(annotations) || annotations.length > 0;
    } catch {
      return true;
    }
  }

  // 四角 area だけを、viewport を area の左上へずらして小さな canvas に描き、画素を読む。
  async function renderArea(env, [left, top, right, bottom], annotationMode) {
    const canvas = env.doc.createElement('canvas');
    canvas.width = right - left;
    canvas.height = bottom - top;
    try {
      const viewport = env.viewport.clone({ offsetX: (env.viewport.offsetX ?? 0) - left, offsetY: (env.viewport.offsetY ?? 0) - top });
      const task = env.page.render({ canvasContext: canvas.getContext('2d'), viewport, annotationMode });
      env.track(task);
      await task.promise;
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    } finally {
      // 取り消された・描けなかったときも、canvas を GC 任せにせず手放す（drawBase と同じ）。
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  // まとまり group の四角を描き、置いた順に塗る。表示中の canvas へは、from 番目以降の範囲だけを書き込む（範囲ごとの四角は
  // group.rects）。書き込む直前に env.alive() が false なら、書き込まずに false を返す。
  async function paintGroup(env, group, from) {
    const { area } = group;
    const target = await renderArea(env, area, env.annotationMode);
    const base = env.annotated ? areaContext(await renderArea(env, area, disabledMode()), area, env.size) : null;
    mosaicPaint().paint(areaContext(target, area, env.size), env.viewport, group.items, { base });
    if (!env.alive())
      return false;
    for (const [left, top, right, bottom] of group.rects.slice(from))
      env.ctx.putImageData(target, area[0], area[1], left - area[0], top - area[1], right - left, bottom - top);
    return true;
  }

  // 塗る準備。モザイクが無い・塗れない（jsdom）なら null。region は、四角を描いて色を読むか（viewport をずらせて、表示のみの書き込みが
  // あるか、大きな canvas のとき）。
  async function envOf(doc, canvas, page, viewport, mosaic, { track = () => {}, annotationMode, alive = () => true } = {}) {
    if (!mosaicPaint().needsPaint(mosaic) || !canPaint(canvas))
      return null;
    const size = { width: canvas.width, height: canvas.height };
    const annotated = await hasAnnotations(page);
    const region = typeof viewport?.clone === 'function' && (annotated || size.width * size.height >= DIRECT_PIXELS);
    return { doc, canvas, ctx: canvas.getContext('2d'), page, viewport, size, track, annotationMode, alive, region, annotated };
  }

  // 表示とサムネイルの下見（paintOver の代わり）: ページを描いたばかりの canvas に、モザイクの並びを塗る。塗ったら true。
  // options は paintOver と同じ track と、canvas を描いた annotationMode（ページ枠は ENABLE_STORAGE。サムネイルは渡さない＝pdf.js の既定）。
  async function paintRegions(doc, canvas, page, viewport, mosaic, options = {}) {
    const env = await envOf(doc, canvas, page, viewport, mosaic, options);
    if (env === null)
      return false;
    if (!env.region)
      return env.annotated ? mosaicPaint().paintOver(doc, canvas, page, viewport, mosaic, options) : mosaicPaint().paint(env.ctx, viewport, mosaic);
    for (const group of groupsOf(viewport, mosaic, env.size))
      await paintGroup(env, group, 0);
    return true;
  }

  // 四角を描かずに、末尾の範囲だけを表示中の canvas から色を読んで塗る。表示のみの書き込みがあるページ（viewport をずらせないとき
  // だけ）は、書き込みを描かない絵に末尾より前の範囲を塗って（paintOver の base と同じ状態にして）から比べる。
  async function paintLastDirect(env, mosaic) {
    const last = mosaic.slice(-1);
    if (!env.annotated) {
      if (!env.alive())
        return false;
      mosaicPaint().paint(env.ctx, env.viewport, last);
      return true;
    }
    const base = await mosaicPaint().drawBase(env.doc, env.page, env.viewport, env.canvas, { track: env.track });
    try {
      if (!env.alive())
        return false;
      const baseContext = base.getContext('2d');
      mosaicPaint().paint(baseContext, env.viewport, mosaic.slice(0, -1));
      mosaicPaint().paint(env.ctx, env.viewport, last, { base: baseContext });
      return true;
    } finally {
      base.width = 0;
      base.height = 0;
    }
  }

  // モザイクを 1 つ追加した時: canvas（今の倍率で描き、mosaic の末尾を除いた並びを塗り終えた絵）に、末尾の範囲だけを塗る。ページは
  // 描き直さない。末尾の範囲と重なる範囲は、四角の絵に置いた順に塗り直して色を合わせ、表示中の canvas へは末尾の範囲だけを書き込む。
  // canvas を mosaic の並びの絵にできたら true（末尾の範囲が canvas の外のときも true）。モザイクが無い・塗れない・書き込む直前に
  // options.alive() が false なら false で、書き込まない。
  async function paintAppended(doc, canvas, page, viewport, mosaic, options = {}) {
    const env = await envOf(doc, canvas, page, viewport, mosaic, options);
    if (env === null)
      return false;
    if (!env.region)
      return paintLastDirect(env, mosaic);
    const last = mosaic[mosaic.length - 1];
    const group = groupsOf(viewport, mosaic, env.size).find((candidate) => candidate.items[candidate.items.length - 1] === last);
    return group === undefined ? env.alive() : paintGroup(env, group, group.items.length - 1);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.mosaicRegion = { DIRECT_PIXELS, canPaint, groupsOf, paintRegions, paintAppended };
})(typeof window !== 'undefined' ? window : globalThis);
