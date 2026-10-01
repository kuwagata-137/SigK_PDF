(function (root) {
  'use strict';

  // ホイールの拡大・縮小（spec-4b-3b 確定事項C。決定53 ⑧⑪⑫・決定55）。
  //
  // ハンドの道具を持っているときは Ctrl を押さないホイールでも、閲覧モードと編集モードではどの道具でも Ctrl＋ホイールで、
  // ツールバーの「＋」「－」と同じ刻みを 1 段ずつ拡大・縮小する。マウスの下の紙の点は動かさない（viewer.setZoom の anchor）。
  // タッチパッドの 2 本指の広げる・狭めるは、Chromium が Ctrl＋ホイールとして渡すので同じ経路に乗る。回した量の溜め方は
  // wheel-zoom.js が持つ。拡大・縮小しないホイールは今までどおり #view を送る（止めない）。

  const state = {
    doc: null,
    // 溜めている量（wheel-zoom.js の acc）。
    acc: null,
  };

  function viewer() {
    return root.SigK.viewer;
  }

  function wheelZoom() {
    return root.SigK.wheelZoom;
  }

  function now() {
    return root.performance?.now?.() ?? Date.now();
  }

  function wantsZoom(event) {
    if (viewer()?.getState().open !== true)
      return false;
    const mode = state.doc.documentElement.getAttribute('data-mode');
    if (mode === 'annot' && root.SigK.annotate?.getTool() === 'hand')
      return true;
    return event.ctrlKey === true && (mode === 'view' || mode === 'annot');
  }

  function onWheel(event) {
    // 横だけのホイールは、ハンドのときも拡大・縮小しない（確定事項C5）。
    if (event.deltaY === 0 || !wantsZoom(event))
      return;
    event.preventDefault();
    const result = wheelZoom().accumulate(state.acc, wheelZoom().deltaOf(event), now());
    state.acc = result.acc;
    if (result.step === 0)
      return;
    const layout = root.SigK.viewerLayout;
    const { zoom } = viewer().getState();
    const next = result.step > 0 ? layout.nextZoom(zoom) : layout.prevZoom(zoom);
    if (next === zoom)
      return;
    viewer().setZoom(next, { anchor: { clientX: event.clientX, clientY: event.clientY } });
  }

  function init(doc, win) {
    if (win.__sigkViewerWheelReady === true)
      return false;
    const view = doc.getElementById('view');
    if (view === null)
      return false;
    win.__sigkViewerWheelReady = true;
    state.doc = doc;
    // 既定のスクロールを止めるので、passive にしない。
    view.addEventListener('wheel', onWheel, { passive: false });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.viewerWheel = { init };
})(typeof window !== 'undefined' ? window : globalThis);
