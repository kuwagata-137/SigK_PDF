(function (root) {
  'use strict';

  // モザイクの塗り（spec-4b-6b 確定事項5〜8・19。事前調査 L）。
  //
  // 範囲を紙の座標のブロック（page-mosaic.js の gridOf）に割り、viewport でそのページの canvas の画素の四角にして、ブロックごとに
  // 平均色で塗る。区切りを紙の座標で決めるので、表示の倍率・回転・保存の 300dpi の画像で同じ所に来る。
  //
  // 下見（表示・サムネイル・印刷）は、pdf.js が canvas に描いた表示のみの書き込みを塗らないために、書き込みを描かない絵
  // （annotationMode: DISABLE）をもう 1 枚描いて base にする。平均色は base から取り、canvas と base で色が違う画素（＝書き込み）は
  // 塗らずに残す。保存の画像は初めから書き込みを描かないので base は要らない。2D コンテキストの無い環境（jsdom）では何もしない。
  // 下見では塗った色を base にも書き戻す。重ねて置いた次の範囲が、保存の画像と同じく「前の範囲を塗ったあとの絵」から平均を取るため
  // （書き戻さないと、前の範囲で塗った画素が書き込みと見なされて残り、粗さを替えて重ねても下見が変わらなかった。コードの点検で直した）。

  function pageMosaic() {
    return root.SigK.pageMosaic;
  }

  function needsPaint(mosaic) {
    return Array.isArray(mosaic) && mosaic.length > 0;
  }

  // 紙の座標の四角 → canvas の画素の [左, 上, 右, 下]（四捨五入）。回したページでも 2 つの角の小さい方・大きい方を取る。
  function pixelRectOf(viewport, x1, y1, x2, y2) {
    const [ax, ay] = viewport.convertToViewportPoint(x1, y1);
    const [bx, by] = viewport.convertToViewportPoint(x2, y2);
    return [Math.round(Math.min(ax, bx)), Math.round(Math.min(ay, by)), Math.round(Math.max(ax, bx)), Math.round(Math.max(ay, by))];
  }

  function clip([left, top, right, bottom], width, height) {
    return [Math.max(0, left), Math.max(0, top), Math.min(width, right), Math.min(height, bottom)];
  }

  // 1 つのブロック（outer の中の [左, 上, 右, 下]）を塗る。平均は sample から取り、keep なら target と sample で違う画素は残し、
  // sample には全部の画素を塗る（下見の base への書き戻し）。
  function fillBlock(target, sample, stride, [left, top, right, bottom], keep) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const at = (y * stride + x) * 4;
        r += sample[at];
        g += sample[at + 1];
        b += sample[at + 2];
        n += 1;
      }
    }
    if (n === 0)
      return;
    const color = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const at = (y * stride + x) * 4;
        const kept = keep && (target[at] !== sample[at] || target[at + 1] !== sample[at + 1] || target[at + 2] !== sample[at + 2]);
        if (keep) {
          sample[at] = color[0];
          sample[at + 1] = color[1];
          sample[at + 2] = color[2];
          sample[at + 3] = 255;
        }
        if (kept)
          continue;
        target[at] = color[0];
        target[at + 1] = color[1];
        target[at + 2] = color[2];
        target[at + 3] = 255;
      }
    }
  }

  // 1 つの範囲 { box, block } を塗る。
  function paintItem(ctx, viewport, item, base) {
    const grid = pageMosaic().gridOf(item?.box, item?.block);
    if (grid === null)
      return;
    const { width, height } = ctx.canvas;
    const [ox, oy, ox2, oy2] = clip(pixelRectOf(viewport, ...item.box), width, height);
    const w = ox2 - ox;
    const h = oy2 - oy;
    if (w <= 0 || h <= 0)
      return;
    const image = ctx.getImageData(ox, oy, w, h);
    const baseImage = base === null ? null : base.getImageData(ox, oy, w, h);
    const sample = baseImage === null ? image.data : baseImage.data;
    for (let j = 0; j + 1 < grid.ys.length; j += 1) {
      for (let i = 0; i + 1 < grid.xs.length; i += 1) {
        const [left, top, right, bottom] = clip(pixelRectOf(viewport, grid.xs[i], grid.ys[j + 1], grid.xs[i + 1], grid.ys[j]), ox2, oy2);
        fillBlock(image.data, sample, w, [left - ox, top - oy, right - ox, bottom - oy].map((v) => Math.max(0, v)), base !== null);
      }
    }
    ctx.putImageData(image, ox, oy);
    if (baseImage !== null)
      base.putImageData(baseImage, ox, oy);
  }

  // ctx（そのページを viewport で描いた canvas の 2D コンテキスト）に、モザイクの並びを置いた順に塗る（確定事項5・6）。
  // base は書き込みを描かない絵の 2D コンテキスト（同じ大きさ。無ければ ctx 自身から平均を取る）。
  function paint(ctx, viewport, mosaic, { base = null } = {}) {
    if (!needsPaint(mosaic) || typeof ctx?.getImageData !== 'function')
      return false;
    for (const item of mosaic)
      paintItem(ctx, viewport, item, base);
    return true;
  }

  function disabledMode() {
    return root.SigK.pdfjs?.lib?.AnnotationMode?.DISABLE;
  }

  // 書き込みを描かない絵を、canvas と同じ大きさで描く。track(task) で描画の task を渡す（ページビューが捨てるときに止めるため）。
  async function drawBase(doc, page, viewport, canvas, { track = () => {} } = {}) {
    const base = doc.createElement('canvas');
    base.width = canvas.width;
    base.height = canvas.height;
    const task = page.render({ canvasContext: base.getContext('2d'), viewport, annotationMode: disabledMode() });
    track(task);
    try {
      await task.promise;
    } catch (error) {
      // 取り消された・描けなかったときも、大きな canvas を GC 任せにせず手放す。
      base.width = 0;
      base.height = 0;
      throw error;
    }
    return base;
  }

  // 下見（確定事項7）: モザイクがあれば、書き込みを描かない絵を描いて base にし、canvas に塗る。塗ったら true。
  async function paintOver(doc, canvas, page, viewport, mosaic, options = {}) {
    if (!needsPaint(mosaic) || typeof canvas?.getContext !== 'function')
      return false;
    const ctx = canvas.getContext('2d');
    if (typeof ctx?.getImageData !== 'function')
      return false;
    const base = await drawBase(doc, page, viewport, canvas, options);
    try {
      return paint(ctx, viewport, mosaic, { base: base.getContext('2d') });
    } finally {
      base.width = 0;
      base.height = 0;
    }
  }

  // ---- 範囲の絵から色を読む塗り方（決定99 ①。表示とサムネイル用）----
  //
  // 大きな canvas から getImageData で色を読むと、2 回目の読み出しで canvas 全体が GPU から CPU のメモリーへ移され、倍率 200% で
  // 1 回 0.5〜0.8 秒かかった（2026-11-17 の調査）。そこで、画素の四角が重なり合う範囲のまとまりごとに、その四角だけを pdf.js で小さな
  // canvas に描いて 1 回だけ色を読み、置いた順に塗って、範囲の画素だけを表示中の canvas へ書き込む。表示のみの書き込みがあるページは、
  // 四角を 2 回（canvas と同じ描き方・書き込みを描かない DISABLE）描き、paintOver と同じく、2 つの絵で色が違う画素を残す。
  // 100 万画素未満の canvas（サムネイル・低い倍率）は、四角を描かずに表示中の canvas から読む（調査で、この方が速かった）。
  // 区切りは canvas 全体の viewport で計算する（paint と同じ式。四角を描いた viewport で計算すると、丸め誤差で区切りが 1 画素
  // ずれるおそれがある）。印刷（page-image.js）は paintOver、保存（mosaic-save.js・image-render.js）は paint のまま使う。
  const DIRECT_PIXELS = 1000000;

  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

  // 範囲 item が canvas（size）の中で占める画素の四角。区切りが正しくない・canvas の外なら null。
  function rectOf(viewport, item, size) {
    if (pageMosaic().gridOf(item?.box, item?.block) === null)
      return null;
    const rect = clip(pixelRectOf(viewport, ...item.box), size.width, size.height);
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

  // まとまり group の四角を描き、置いた順に塗る。表示中の canvas へは、from 番目以降の範囲だけを書き込む（範囲ごとの四角は group.rects）。
  async function paintGroup(env, group, from) {
    const { area } = group;
    const target = await renderArea(env, area, env.annotationMode);
    const base = env.annotated ? areaContext(await renderArea(env, area, disabledMode()), area, env.size) : null;
    paint(areaContext(target, area, env.size), env.viewport, group.items, { base });
    for (const [left, top, right, bottom] of group.rects.slice(from))
      env.ctx.putImageData(target, area[0], area[1], left - area[0], top - area[1], right - left, bottom - top);
  }

  // 塗る準備。モザイクが無い・2D コンテキストが無い（jsdom）なら null。region は、四角を描いて色を読むか（大きな canvas で、
  // viewport をずらせるとき）。
  async function envOf(doc, canvas, page, viewport, mosaic, { track = () => {}, annotationMode } = {}) {
    if (!needsPaint(mosaic) || typeof canvas?.getContext !== 'function')
      return null;
    const ctx = canvas.getContext('2d');
    if (typeof ctx?.getImageData !== 'function')
      return null;
    const size = { width: canvas.width, height: canvas.height };
    const region = size.width * size.height >= DIRECT_PIXELS && typeof viewport?.clone === 'function';
    return { doc, canvas, ctx, page, viewport, size, track, annotationMode, region, annotated: await hasAnnotations(page) };
  }

  // 表示とサムネイルの下見（paintOver の代わり）: ページを描いたばかりの canvas に、モザイクの並びを塗る。塗ったら true。
  // options は paintOver と同じ track と、canvas を描いた annotationMode（ページ枠は ENABLE_STORAGE。サムネイルは渡さない＝pdf.js の既定）。
  async function paintRegions(doc, canvas, page, viewport, mosaic, options = {}) {
    const env = await envOf(doc, canvas, page, viewport, mosaic, options);
    if (env === null)
      return false;
    if (!env.region)
      return env.annotated ? paintOver(doc, canvas, page, viewport, mosaic, options) : paint(env.ctx, viewport, mosaic);
    for (const group of groupsOf(viewport, mosaic, env.size))
      await paintGroup(env, group, 0);
    return true;
  }

  // 小さな canvas に、末尾の範囲だけを、表示中の canvas から色を読んで塗る。表示のみの書き込みがあるページは、書き込みを描かない絵に
  // 末尾より前の範囲を塗って（paintOver の base と同じ状態にして）から比べる。
  async function paintLastDirect(env, mosaic) {
    const last = mosaic.slice(-1);
    if (!env.annotated) {
      paint(env.ctx, env.viewport, last);
      return true;
    }
    const base = await drawBase(env.doc, env.page, env.viewport, env.canvas, { track: env.track });
    try {
      const baseContext = base.getContext('2d');
      paint(baseContext, env.viewport, mosaic.slice(0, -1));
      paint(env.ctx, env.viewport, last, { base: baseContext });
      return true;
    } finally {
      base.width = 0;
      base.height = 0;
    }
  }

  // モザイクを 1 つ追加した時: canvas（今の倍率で描き、mosaic の末尾を除いた並びを塗り終えた絵）に、末尾の範囲だけを塗る。ページは
  // 描き直さない。末尾の範囲と重なる範囲は、四角の絵に置いた順に塗り直して色を合わせ、表示中の canvas へは末尾の範囲だけを書き込む。
  // canvas を mosaic の並びの絵にできたら true（末尾の範囲が canvas の外のときも true）。モザイクが無い・2D コンテキストが無いなら
  // false で、呼ぶ側はページを描き直す。
  async function paintAppended(doc, canvas, page, viewport, mosaic, options = {}) {
    const env = await envOf(doc, canvas, page, viewport, mosaic, options);
    if (env === null)
      return false;
    if (!env.region)
      return paintLastDirect(env, mosaic);
    const last = mosaic[mosaic.length - 1];
    const group = groupsOf(viewport, mosaic, env.size).find((candidate) => candidate.items[candidate.items.length - 1] === last);
    if (group !== undefined)
      await paintGroup(env, group, group.items.length - 1);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.mosaicPaint = { DIRECT_PIXELS, needsPaint, pixelRectOf, paint, paintOver, groupsOf, paintRegions, paintAppended };
})(typeof window !== 'undefined' ? window : globalThis);
