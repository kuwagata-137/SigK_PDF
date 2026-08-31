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
  function create(ctx) {
    const state = ctx.state;

    function layout() {
      return root.SigK.viewerLayout;
    }

    // jsdom には 2D コンテキストが無い（canvas パッケージを入れていないため）。
    // getContext を呼ぶと「Not implemented」がコンソールに出るので、呼ぶ前に確かめる。
    function canDrawCanvas() {
      return typeof root.CanvasRenderingContext2D !== 'undefined';
    }

    // ページ1枚を canvas に描く。描けない環境では null を返す。
    //
    // 「描けないなら打ち切る」ではなく「絵だけ無い」で返すのは、テキスト
    // レイヤーが canvas と独立しているためである。文字の層は DOM だけで
    // 作れるので、絵が出せない環境（jsdom）でも組み立てて確かめられる。
    async function drawCanvas({ entry, page }) {
      const scale = layout().renderScale({ zoom: state.zoom, devicePixelRatio: root.devicePixelRatio });
      const viewport = page.getViewport({ scale });
      if (!canDrawCanvas())
        return null;

      const canvas = ctx.el().doc.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      entry.task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      await entry.task.promise;
      return canvas;
    }

    function releasePage(index) {
      const entry = state.rendered.get(index);
      if (entry === undefined)
        return;
      state.rendered.delete(index);
      entry.task?.cancel();
      // テキストレイヤーは canvas と同じ寿命にする（spec-1-3 確定事項21）。
      entry.text?.cancel();
      ctx.el().pageNodes[index]?.replaceChildren();
    }

    function releaseAll() {
      for (const index of [...state.rendered.keys()])
        releasePage(index);
    }

    async function renderPage(index) {
      if (state.rendered.has(index))
        return;

      const token = state.token;
      const entry = { task: null, text: null };
      state.rendered.set(index, entry);

      // 捨てられたかどうかは、地図に載っているのが自分の entry かどうかで見る。
      // token は文書とズームの変化しか捉えない。スクロールで範囲外になった場合、
      // これが無いと遅れて届いた描画が、もう見ていないページに canvas を貼る。
      const isStale = () => token !== state.token || state.rendered.get(index) !== entry;

      try {
        const page = await state.doc.getPage(index + 1);
        if (isStale())
          return;

        const canvas = await drawCanvas({ entry, page });
        if (isStale())
          return;
        if (canvas !== null)
          ctx.el().pageNodes[index]?.replaceChildren(canvas);

        await attachTextLayer({ index, entry, page, isStale });
      } catch (error) {
        if (state.rendered.get(index) === entry)
          state.rendered.delete(index);
        // スクロールで捨てた描画は失敗ではない。
        if (error?.name === 'RenderingCancelledException')
          return;
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
      const viewport = page.getViewport({ scale: state.zoom * layout().CSS_UNITS });
      const handle = await textLayer.render({ doc: ctx.el().doc, page, viewport });
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
    }

    function update() {
      if (state.doc === null)
        return;

      const el = ctx.el();
      const pages = state.layout.pages;
      const scrollTop = el.view.scrollTop;
      const viewportHeight = el.view.clientHeight;
      const range = layout().visibleRange({ pages, scrollTop, viewportHeight });
      const current = layout().currentPageIndex({ pages, scrollTop, viewportHeight });

      if (current !== state.current) {
        state.current = current;
        ctx.syncPage();
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

    return { canDrawCanvas, releasePage, releaseAll, renderPage, update, scheduleUpdate };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageRender = { create };
})(typeof window !== 'undefined' ? window : globalThis);
