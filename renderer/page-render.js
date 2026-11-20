(function (root) {
  'use strict';

  // ページの描画ライフサイクル。「いま何を描き、何を捨てるか」だけを持つ層である。
  //
  // viewer.js から切り出した（spec-1-3 確定事項28〜30）。あちらは文書の開閉・
  // セッションの退避・倍率・ページ移動を持ち、こちらは canvas の生死を持つ。
  // 塊③-a でテキストレイヤーを足す場所がまさにここであり、足してから割るより
  // 割ってから足すほうが差分が読める。
  //
  // 状態は viewer.js のものをそのまま借りる（create の ctx.state）。描画は
  // state.rendered と state.token を読み書きするため、複製を持たせると
  // 「捨てたはずのページが復活する」たぐいの食い違いを生む。

  // 描画に要るものを viewer.js から受け取って組み立てる。
  //
  // - state: viewer.js の状態そのもの（差し替えられないので参照で持つ）
  // - el: 要素の束を返す関数。init() で差し替わるため関数で受ける
  // - report: 失敗の記録。source を 'viewer' の1本に保つため借りる
  // - getState: controls へ渡す読み取り専用の写し
  // 控えの画素数の上限（docs/07 決定99 ②。Claude の案）。1,600 万画素（RGBA で約 64 MB）。
  const KEEP_PIXELS = 16_000_000;

  function create(ctx) {
    const state = ctx.state;
    // 新しい絵を描き終えるまで前の絵を表示しているページ。index → 絵の記録（page-picture.js）。描けたら入れ替え、描く範囲から外れたら破棄する。
    // 倍率を変えた時（2026-10-23 の直し）、モザイクを配置した時（決定98）、並びを変えた時（決定99 ②）に使う。前は枠を空にしていたので、
    // pdf.js が描き終えるまで紙の白い背景が見えていた。
    const held = new Map();
    // 控え（決定99 ②）。枠に置いていない前の絵（並びから外れたページの絵・描き終えた絵に置き換えられた見た目の違う絵・先に描いた挿入の
    // ページの絵）を、次の 1 回の並びの変更まで残す。
    const keeper = root.SigK.pagePicture.createKeeper({ budget: KEEP_PIXELS });

    function layout() {
      return root.SigK.viewerLayout;
    }

    function picture() {
      return root.SigK.pagePicture;
    }

    // jsdom には 2D コンテキストが無い（canvas パッケージを入れていないため）。
    // getContext を呼ぶと「Not implemented」がコンソールに出るので、呼ぶ前に確かめる。
    function canDrawCanvas() {
      return typeof root.CanvasRenderingContext2D !== 'undefined';
    }

    // 表示上の index から、描くべき文書とページ番号を引く（spec-1-5 確定事項44・
    // spec-1-6 確定事項93）。直に doc.getPage() を呼ぶのは、このファイルと
    // thumbnails.js の2か所だけである。写像を通さないと、編集しても中央の
    // ページビューだけが元の並びのまま取り残される。
    function sourceOf(index) {
      return root.SigK.pagePlan.sourceOf(state.plan, index, state);
    }

    // そのページに当てる絶対角度。plan の相対角度を元ページの /Rotate へ足す。
    function rotationFor(index, page) {
      return (page?.rotate ?? 0) + (state.plan[index]?.rotate ?? 0);
    }

    // 描く範囲は plan の crop（spec-4b-6a 確定事項5・6）。canvas・注釈の層・文字の層で同じ箱を使う。
    function viewportAt(index, page, scale) {
      return root.SigK.pageViewbox.viewportFor(page, { scale, rotation: rotationFor(index, page), box: state.plan[index]?.crop ?? null });
    }

    // 今の倍率で描く viewport。make(scale) は、その倍率の viewport を返す関数。
    // 大きな紙を高い倍率で描くと、canvas が Chromium の上限を超えて白いままになるので、画素の数を上限に収める（spec-6-1 確定事項D-9）。
    function drawViewport(make) {
      const scale = layout().renderScale({ zoom: state.zoom, devicePixelRatio: root.devicePixelRatio });
      const viewport = make(scale);
      const capped = root.SigK.pageImage?.cappedScale(scale, viewport.width, viewport.height) ?? scale;
      return capped === scale ? viewport : make(capped);
    }

    // viewport の大きさの canvas。1px 以上（spec-4b-7a 確定事項G3。幅 0 の canvas には描けない）。
    function newCanvas(viewport) {
      const canvas = ctx.el().doc.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      return canvas;
    }

    // ページ1枚を canvas に描く。描けない環境では null を返す。
    //
    // 「描けないなら打ち切る」ではなく「絵だけ無い」で返すのは、テキスト
    // レイヤーが canvas と独立しているためである。文字の層は DOM だけで
    // 作れるので、絵が出せない環境（jsdom）でも組み立てて確かめられる。
    async function drawCanvas({ entry, page, index }) {
      const viewport = drawViewport((scale) => viewportAt(index, page, scale));
      // 描いた時の viewport（決定99 ②。drawnPicture が返す）。
      entry.viewport = viewport;
      if (!canDrawCanvas())
        return null;

      const canvas = newCanvas(viewport);
      entry.task = page.render({ canvasContext: canvas.getContext('2d'), viewport, annotationMode: annotationMode() });
      await entry.task.promise;
      // モザイクの下見（spec-4b-6b 確定事項7）。書き込みを描かない絵をもう 1 枚描いて比べ、書き込みは塗らない。
      await root.SigK.mosaicPaint?.paintOver(ctx.el().doc, canvas, page, viewport, state.plan[index]?.mosaic, { track: (task) => { entry.task = task; } });
      return canvas;
    }

    // 読み込んだテキストマークアップは pdf.js に描かせず、自前の層で描く
    // （spec-4-1 確定事項18）。annotationStorage の noView を見る描き方にする。
    // pdf.js が無い（jsdom）ときは undefined で、既定に任せる。
    function annotationMode() {
      return root.SigK.pdfjs?.lib?.AnnotationMode?.ENABLE_STORAGE;
    }

    // 注釈の層（spec-4-1 確定事項5）。canvas のあと、テキストレイヤーの前に置く。
    // viewport は CSS ピクセル基準（テキストレイヤーと同じ）。
    function attachAnnotationLayer({ index, entry, page }) {
      const layer = root.SigK.annotationLayer;
      const node = ctx.el().pageNodes[index];
      if (layer === undefined || node === undefined || node === null)
        return;
      const viewport = viewportAt(index, page, state.zoom * layout().CSS_UNITS);
      entry.annots = { svg: layer.mount(ctx.el().doc, node, viewport), viewport };
      drawAnnotations(index, entry);
      // テキストの入力欄は枠と同じ寿命で、下書きは生き残る（spec-4-2 確定事項9）。
      root.SigK.freeTextEditor?.onPageRendered(index, node, viewport);
      // トリミングの枠は紙の座標で持つので、描き直したページに描き直す（spec-4b-6a 確定事項15）。
      root.SigK.annotateTrim?.onPageRendered(index, node, viewport);
      // 一覧から飛んできていれば、描けたこの時点で注釈へ寄せる（spec-4-4 確定事項30）。
      root.SigK.annotationList?.onPageRendered(index);
    }

    // そのページの注釈を描き直す。差し込んだページには付けない（既知の限界）。
    function drawAnnotations(index, entry) {
      const layer = root.SigK.annotationLayer;
      if (entry.annots === null || entry.annots === undefined || layer === undefined)
        return;
      const src = state.plan[index]?.src;
      const entries = Number.isInteger(src)
        ? root.SigK.annotationState.annotsOnPage(state.annots, state.imported, src)
        : [];
      // スライダーやつまみを動かしている間は、選んだ書き込みを下見の値で描く（spec-4b-1b 確定事項8、spec-4b-2 確定事項38）。
      const preview = root.SigK.annotatePreview;
      const shown = root.SigK.eraserDraft?.shownOf(index, preview === undefined ? entries : entries.map(preview.previewFor)) ?? entries;
      // 選んでいる書き込みの鍵の並び（複数なら 1 件ごとの枠。spec-4b-3a 確定事項E）。
      const selected = root.SigK.annotate?.getSelection() ?? [];
      const editing = root.SigK.freeTextEditor?.editingKey() ?? null;
      // 描いている途中の図形（spec-4-3 確定事項3）。
      const textDraft = root.SigK.freeTextEditor?.getDraft() ?? null;
      // 描いている途中の多角形は、置いた辺を下書きに、頂点などの印を marks に（spec-4b-5a 確定事項13）。
      const draft = root.SigK.annotateShape?.draftFor(index) ?? root.SigK.annotatePolygon?.draftFor(index) ?? root.SigK.annotateLineAnchor?.draftFor(index) ?? null;
      const marks = root.SigK.annotatePolygon?.marksFor(index) ?? null;
      layer.draw(entry.annots.svg, shown, entry.annots.viewport, { editing, draft, textDraft: textDraft?.index === index ? textDraft : null, marks });
      // 選択の枠とつまみは紙の外の層へ（spec-4b-2 確定事項9）。
      const { doc, pages, pageNodes } = ctx.el();
      root.SigK.annotationFrame?.sync({ doc, pagesEl: pages, pageNode: pageNodes[index], index, entries: shown, viewport: entry.annots.viewport, selected, editing });
    }

    // 描いてあるページの注釈の層を描き直す（編集・undo・選択の変化）。
    // rerender に元ページ番号を渡すと、そのページは canvas ごと描き直す
    // （読み込んだ注釈を集め終えたとき。pdf.js が描いたぶんを消すため）。新しい絵を描き終えるまで前の絵を表示する（決定99 ②）。
    function redrawAnnotations({ rerender = [] } = {}) {
      for (const [index, entry] of [...state.rendered.entries()]) {
        if (rerender.includes(state.plan[index]?.src)) {
          releasePage(index, { keepPicture: true });
          renderPage(index);
          continue;
        }
        drawAnnotations(index, entry);
      }
    }

    // ---- 前の絵（決定99 ②。page-picture.js） ----

    function copyEntry(page) {
      return root.SigK.pagePlan.clonePlan([page])[0];
    }

    // 絵の記録を作る。canvas と書き込みの層は箱（div.pdf-held）に入れる。extra は standIn（代わりの絵）・fill（開き直した時）。
    function recordOf(canvas, layer, { page, source, plan }, extra = {}) {
      return { box: picture().wrap(ctx.el().doc, canvas, layer), canvas, page, source, plan, pixels: picture().pixelsOf(canvas), ...extra };
    }

    // 描き終えた絵を枠から取り出して、絵の記録にする。描き終えていなければ null。
    function takePicture(index, entry) {
      const node = ctx.el().pageNodes[index];
      if (entry?.done !== true || node === undefined || node === null || entry.canvas?.parentNode !== node)
        return null;
      return recordOf(entry.canvas, node.querySelector(':scope > svg.annot-layer'), entry);
    }

    // 絵の記録を index の枠に置き、新しい絵を描き終えるまで表示する。向きと範囲が今の枠と同じ絵（倍率を変えた時・モザイクだけが変わった時・
    // 並べ替えた時）と開き直した時の絵は、枠いっぱいに伸ばす。回転・トリミングで向きと範囲が変わったページは、絵を描いた時の回転と範囲
    // （record.plan）から、今の枠の回転と範囲（state.plan[index]）への変換を、今の倍率の viewport で計算して適用する。
    function placeHeld(index, record) {
      const node = ctx.el().pageNodes[index];
      if (node === undefined || node === null)
        return false;
      if (record.fill === true || picture().sameLook(record.plan, state.plan[index])) {
        picture().fit(record.box);
      } else {
        const scale = state.zoom * layout().CSS_UNITS;
        const rotation = (record.page?.rotate ?? 0) + (record.plan?.rotate ?? 0);
        const from = root.SigK.pageViewbox.viewportFor(record.page, { scale, rotation, box: record.plan?.crop ?? null });
        // 枠の寸法は viewer-layout.js の layoutPages と同じ計算（整数に丸める）。倍率を変えた時は、枠の寸法を書き換える前に呼ばれる。
        const size = state.sizes[index] ?? { width: 0, height: 0 };
        const frame = { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
        picture().fit(record.box, from, viewportAt(index, record.page, scale), frame);
      }
      node.replaceChildren(record.box);
      held.set(index, record);
      return true;
    }

    // 控えに入れてよい絵か。代わりの絵（サムネイルを拡大した絵）と、開き直す前の文書の絵は入れない。
    function keepable(record) {
      return record !== null && record !== undefined && record.standIn !== true && record.fill !== true;
    }

    // 描き終えた新しい絵に置き換えた前の絵を、見た目（回転・トリミング・モザイク）が違えば控えに入れる。トリミングの取り消しで、
    // 新しく見える余白を切る前の絵で覆うため。見た目が同じ絵（倍率を変えた時など）は、新しい絵と同じなので破棄する。
    function keepReplaced(record, plan) {
      if (keepable(record) && !picture().sameLook(record.plan, plan))
        keeper.add(record);
    }

    // 表示していた前の絵を破棄する。表示していなければ何もしない（描けたばかりの絵を消さないため）。
    function dropPicture(index) {
      if (!held.delete(index))
        return;
      ctx.el().pageNodes[index]?.replaceChildren();
    }

    function dropAllPictures() {
      for (const index of [...held.keys()])
        dropPicture(index);
    }

    // ---- 並びの変更（決定99 ②） ----

    // 並びを変える前に、枠に表示している絵（描き終えた絵と前の絵）を取り出す。前の並びの位置 → 絵の記録。
    function takePictures() {
      const taken = new Map(held);
      for (const [index, entry] of state.rendered) {
        const record = taken.has(index) ? null : takePicture(index, entry);
        if (record !== null)
          taken.set(index, record);
      }
      return taken;
    }

    // 並びを変えて枠を作り直した後で、取り出した絵を同じページの新しい枠に置く（previous は前の並び）。前の並びに無かったページは、
    // 控え（削除の取り消しで戻ったページ・先に描いた挿入のページ）を探し、無ければ見えているページにだけサムネイルの代わりの絵を置く。
    // 置かなかった絵（並びから外れたページ）と、控えを優先して置き換えた絵は、次の 1 回の並びの変更まで控えに残す。
    function placePictures(previous, taken) {
      const moves = root.SigK.pagePlan.pageMoves(previous, state.plan);
      const range = visibleRange();
      const spare = [];
      moves.forEach((move, index) => {
        const carried = move === null ? null : taken.get(move.at) ?? null;
        if (move !== null)
          taken.delete(move.at);
        const source = sourceOf(index);
        const chosen = picture().choose({ carried, keeper, source, look: state.plan[index] });
        if (chosen.replaced !== null)
          spare.push(chosen.replaced);
        const record = chosen.record ?? (index >= range.first && index <= range.last ? standIn(source) : null);
        if (record !== null)
          placeHeld(index, record);
      });
      keeper.renew([...spare, ...taken.values()].filter(keepable));
    }

    // 今の並びで見えているページの範囲。
    function visibleRange() {
      const el = ctx.el();
      return layout().visibleRange({ pages: state.layout.pages, scrollTop: el.view.scrollTop, viewportHeight: el.view.clientHeight });
    }

    // サムネイルの絵（小さい絵）の複製を、前の絵の代わりに拡大して表示する。サムネイルはまだ前の並びのまま（viewer.applyPlan の順番）。
    function standIn(source) {
      const found = source === null ? null : root.SigK.thumbnails?.standIn?.(source) ?? null;
      return found === null ? null : recordOf(found.canvas, null, found, { standIn: true });
    }

    // 上書き保存の後に開き直した時（viewer.reopen）。保存した内容は画面と同じなので、同じ位置で寸法が同じページは、前の絵を新しい枠
    // いっぱいに表示する。前の文書の絵なので、控えには入れない。
    function fillPictures(taken, previousSizes) {
      const same = (a, b) => a !== undefined && b !== undefined && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
      for (const [index, record] of taken) {
        if (same(state.sizes[index], previousSizes[index]))
          placeHeld(index, { ...record, fill: true });
      }
    }

    // 控えを全部破棄する（文書を閉じる・タブを移る・開き直す時と、ツールモード）。
    function forget() {
      keeper.clear();
    }

    // ---- 挿入・貼り付けで新しく入るページ（決定99 ②） ----

    // 新しく入るページのうち、入れた後にページの表示域に見えるページを、並びに入れる前に今の倍率で描いて控えに入れる（入れた直後に
    // 白い枠を表示しないため）。sizes は入れた後の並びの寸法、added は [{ index, doc, number }]（入れた後の位置と、描く文書とページ番号）。
    // limit は viewer.prepareInserts の時間の上限で、cancelled になった後に描き終えた絵は控えに入れない。
    async function prepare(sizes, added, limit) {
      const el = ctx.el();
      if (state.doc === null || !canDrawCanvas() || el.doc.documentElement.getAttribute('data-mode') === 'tools')
        return;
      const pages = layout().layoutPages({ sizes, zoom: state.zoom, facing: state.facing }).pages;
      const range = layout().visibleRange({ pages, scrollTop: el.view.scrollTop, viewportHeight: el.view.clientHeight });
      const shown = added.filter(({ index }) => index >= range.first && index <= range.last);
      const owner = state.doc;
      await Promise.all(shown.map((item) => prepareOne(item, limit, owner)));
    }

    async function prepareOne({ doc, number }, limit, owner) {
      try {
        const page = await doc.getPage(number);
        if (limit.cancelled)
          return;
        const viewport = drawViewport((scale) => root.SigK.pageViewbox.viewportFor(page, { scale, rotation: page.rotate ?? 0 }));
        const canvas = newCanvas(viewport);
        const task = page.render({ canvasContext: canvas.getContext('2d'), viewport, annotationMode: annotationMode() });
        // 描いている間だけ、時間の上限で取り消す対象にする。
        limit.tasks.add(task);
        try {
          await task.promise;
        } finally {
          limit.tasks.delete(task);
        }
        if (!limit.cancelled && state.doc === owner)
          keeper.add(recordOf(canvas, null, { page, source: { doc, number }, plan: { rotate: 0 } }));
      } catch {
        // 時間の上限で取り消した描画と、描けなかったページは、入れた後に今までどおり描く（描けなければ、その時に記録する）。
      }
    }

    // ---- ① のモザイクの範囲だけを塗る処理に渡す口（決定99） ----

    // 今の並びと倍率で描き終えた絵。{ canvas, viewport, page, plan }。plan は描いた時の並びの要素の写し（どのモザイクまで塗った絵か）。
    // 描いている途中・前の絵を表示している間・描いていないページは null。
    function drawnPicture(index) {
      const entry = state.rendered.get(index);
      if (entry?.done !== true || held.has(index))
        return null;
      return { canvas: entry.canvas, viewport: entry.viewport, page: entry.page, plan: entry.plan };
    }

    // drawnPicture の絵に、今の並びの要素のモザイクを塗った後に呼ぶ。絵の記録の並びの要素を、今の並びの要素にする（控えと並びの変更で、
    // 絵の見た目を正しく比べるため）。
    function markDrawn(index) {
      const entry = state.rendered.get(index);
      if (entry?.done === true)
        entry.plan = copyEntry(state.plan[index]);
    }

    // cleanup は、画面から外れて手放すとき（update）だけ true にする。pdf.js のページが展開した画像などを捨てる（spec-4b-7a 点検の直し。
    // 捨てないと、スクロールで触れたページの分だけメモリが伸び続けた。描画が残っていれば pdf.js が終わるまで待つ）。倍率を変えて
    // 全部を描き直すとき（releaseAll）は、すぐまた使うので捨てない。
    // keepPicture は、同じ枠で描き直す時（倍率を変えた時・モザイクだけが変わった時・読み込んだ書き込みを集め終えた時）に true にする。
    // 新しい絵ができるまで前の絵（描き終えた絵か、表示していた前の絵）を表示する（placeHeld）。
    function releasePage(index, { cleanup = false, keepPicture = false } = {}) {
      const entry = state.rendered.get(index);
      if (entry === undefined)
        return;
      // 前の絵は、枠を空にする前に取り出す。
      const kept = keepPicture ? held.get(index) ?? takePicture(index, entry) : null;
      state.rendered.delete(index);
      entry.task?.cancel();
      if (cleanup)
        entry.page?.cleanup?.();
      // テキストレイヤーは canvas と同じ寿命にする（spec-1-3 確定事項21）。
      // 注釈の層も同じで、枠ごと捨てる。
      entry.text?.cancel();
      entry.annots = null;
      root.SigK.annotationFrame?.releasePage(index);
      root.SigK.freeTextEditor?.onPageReleased(index);
      if (kept !== null && placeHeld(index, kept))
        return;
      held.delete(index);
      ctx.el().pageNodes[index]?.replaceChildren();
    }

    // keepPicture でなければ（閉じる・読み直す・並びが変わる・タブを移る）、表示していた前の絵も破棄する。keepPicture なら、描画の記録が
    // 無いページ（描き終える前に倍率を変えたページ）の前の絵も、今の倍率で置き直す。
    function releaseAll({ keepPicture = false } = {}) {
      for (const index of [...state.rendered.keys()])
        releasePage(index, { keepPicture });
      if (!keepPicture) {
        dropAllPictures();
        return;
      }
      for (const [index, record] of [...held.entries()])
        placeHeld(index, record);
    }

    async function renderPage(index) {
      if (state.rendered.has(index))
        return;

      const token = state.token;
      // canvas・viewport・done は描き終えた絵、source と plan はその絵の文書とページ番号・描いた時の並びの要素（決定99 ②）。
      const entry = { task: null, text: null, annots: null, page: null, source: null, plan: copyEntry(state.plan[index]), canvas: null, viewport: null, done: false };
      state.rendered.set(index, entry);

      // 捨てられたかどうかは、地図に載っているのが自分の entry かどうかで見る。
      // token は文書とズームの変化しか捉えない。スクロールで範囲外になった場合、
      // これが無いと遅れて届いた描画が、もう見ていないページに canvas を貼る。
      const isStale = () => token !== state.token || state.rendered.get(index) !== entry;

      try {
        const source = sourceOf(index);
        if (source === null) {
          state.rendered.delete(index);
          return;
        }
        entry.source = source;
        const page = await source.doc.getPage(source.number);
        entry.page = page;
        if (isStale())
          return;

        const canvas = await drawCanvas({ entry, page, index });
        if (isStale())
          return;
        // 表示していた前の絵と入れ替える。絵が描けない環境（jsdom）でも枠を空にしてから書き込みの層を付ける（前の層と二重にしない）。
        const replaced = held.get(index);
        held.delete(index);
        ctx.el().pageNodes[index]?.replaceChildren(...(canvas === null ? [] : [canvas]));
        entry.canvas = canvas;
        entry.done = canvas !== null;
        keepReplaced(replaced, entry.plan);
        attachAnnotationLayer({ index, entry, page });

        await attachTextLayer({ index, entry, page, isStale });
      } catch (error) {
        const own = state.rendered.get(index) === entry;
        if (own)
          state.rendered.delete(index);
        // スクロールで捨てた描画は失敗ではない。
        if (error?.name === 'RenderingCancelledException')
          return;
        // 描けなかったページに、前の倍率の絵を残したままにしない。
        if (own)
          dropPicture(index);
        ctx.report(error, { page: index + 1 });
      }
    }

    // 文字を選べるようにする層を canvas の後ろへ足す（spec-1-3 確定事項20）。
    // DOM 順で後ろ＝重なりで上になり、.textLayer は position:absolute; inset:0
    // なので .pdf-page の枠にぴったり重なる。
    //
    // canvas を貼ってから追いかける。テキストを待ってから両方を貼ると、
    // 絵が出るのがその分遅れる。
    async function attachTextLayer({ index, entry, page, isStale }) {
      const textLayer = root.SigK.textLayer;
      if (textLayer === undefined || !textLayer.available())
        return;

      const node = ctx.el().pageNodes[index];
      if (node === undefined || node === null)
        return;

      // canvas 用の viewport は devicePixelRatio を掛けてある。文字には
      // 掛けない CSS ピクセル基準のものを渡す（text-layer.js の注記を参照）。
      // 回転は canvas と揃える。揃えないと、回した紙の上で文字だけが
      // 元の向きに残る。
      const viewport = viewportAt(index, page, state.zoom * layout().CSS_UNITS);
      // モザイクの範囲に重なる行は選べなくする（spec-4b-6b 確定事項9）。
      const handle = await textLayer.render({ doc: ctx.el().doc, page, viewport, mosaic: state.plan[index]?.mosaic });
      if (handle === null)
        return;
      // 待っている間に捨てられていたら貼らない。遅れて届いたテキストが、
      // もう見ていないページに乗るのを防ぐ。
      if (isStale()) {
        handle.cancel();
        return;
      }

      entry.text = handle;
      node.append(handle.node);
      await handle.done;
      // 検索中なら、いま描いたページにハイライトを当てる（spec-1-4 確定事項
      // 17・20）。まだ描いていないページは span を持てないので、描いた
      // この時点が唯一の機会である。倍率の変更もタブの切り替えも、
      // テキストレイヤーを作り直す以上ここを通る。
      if (!isStale())
        root.SigK.find?.onPageRendered(index);
    }

    function update() {
      if (state.doc === null)
        return;

      const el = ctx.el();
      // ツールモードではページの表示がツールの画面の下に隠れている。描いた分を手放して描かない（帯を押して文書を映し直すたびに、
      // 見えないページを描かないため。spec-2-5 危ない所「メモリ」）。モードを抜けると shell.setMode の refit が描き直す。
      if (el.doc.documentElement.getAttribute('data-mode') === 'tools') {
        for (const index of [...state.rendered.keys()])
          releasePage(index, { cleanup: true });
        dropAllPictures();
        forget();
        return;
      }
      const pages = state.layout.pages;
      const scrollTop = el.view.scrollTop;
      const viewportHeight = el.view.clientHeight;
      const range = layout().visibleRange({ pages, scrollTop, viewportHeight });
      const current = layout().currentPageIndex({ pages, scrollTop, viewportHeight });

      // 見開きでは同じ組なら現在ページを保つ（spec-2-3 確定事項13）。
      // currentPageIndex は同じ行なら左を採るので、番号入力・サムネイル・検索で
      // 右ページを指定した直後に、左の番号へ戻ってしまうのを防ぐ。
      // 今のページが視野に全部収まっている間も保つ（pdf.js と同じ。spec-4b-7a 点検の直し）。低い倍率では末尾の近くのページを
      // 上端へ送れず、いちばん広く見えている若い番号へ戻されて、そのページを現在ページにできなかった。
      const spreadStart = (index) => layout().spreadStart(index, state.facing);
      const keep = layout().isFullyVisible(pages[state.current], scrollTop, viewportHeight);
      if (spreadStart(current) !== spreadStart(state.current) && !keep) {
        state.current = current;
        ctx.syncPage();
      }

      // 見開きでは1行に2枚出るので、先読みも2枚にする（確定事項12）。見えているページが多いときは減らす（spec-4b-7a 確定事項H）。
      const ahead = layout().renderAhead({ first: range.first, last: range.last, ahead: state.facing ? layout().FACING_AHEAD : layout().RENDER_AHEAD });
      const targets = layout().renderTargets({
        count: pages.length,
        first: range.first,
        last: range.last,
        current: state.current,
        ahead,
        // 低い倍率では見えている枚数に合わせて上限を上げる（spec-4b-7a 確定事項H）。
        max: layout().renderLimit({ first: range.first, last: range.last, ahead }),
      });

      for (const index of [...state.rendered.keys()]) {
        if (!targets.includes(index))
          releasePage(index, { cleanup: true });
      }
      // 描く範囲から外れたページには、前の絵を残さない（メモリを抱えないため）。
      for (const index of [...held.keys()]) {
        if (!targets.includes(index))
          dropPicture(index);
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

    return {
      canDrawCanvas, releasePage, releaseAll, renderPage, update, scheduleUpdate, redrawAnnotations,
      // 並びの変更・開き直し・挿入で、前の絵を表示し続ける（決定99 ②）。
      takePictures, placePictures, fillPictures, forget, prepare,
      // ① のモザイクの範囲だけを塗る処理に渡す口（決定99）。
      drawnPicture, markDrawn,
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageRender = { create };
})(typeof window !== 'undefined' ? window : globalThis);
