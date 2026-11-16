(function (root) {
  'use strict';

  // ツールモードの紙の倍率（docs/07 決定83。spec-2-5 確定事項L）。PDF の帯・分割の盤・「変換する画像」の帯の紙は、どれもこの 1 つの倍率で
  // 大きさが変わる。100% は帯の紙の高さ 208px・盤の紙の幅 208px・画像の枠 208×144px（基準の寸法 104px などの PAPER_SCALE 倍。決定93）。
  // 閲覧の倍率（タブごと。viewer.js）とは別に持ち、起動している間だけ覚える（閉じると 100%。設定には書かない）。
  //
  // 変える口は、ツールバーの［－］［＋］と倍率の入力欄（viewer-controls.js が振り替える）・Ctrl＋＋/－/0（viewer-keys.js から handleKey）・帯の画面の上の
  // Ctrl＋ホイール（タッチパッドの 2 本指も。溜め方は wheel-zoom.js）。変えたら、紙を並べ直す受け手（onChange）へ知らせ、そのあと
  // マウスの下の紙（ボタン・キーでは帯の画面の左上）が同じ所に来るように帯の画面を送る（strip-zoom.js）。

  // 2026-11-13（docs/07 決定93。spec-7-6 確定事項ZT1・ZS3）: 前の 200% の大きさを 100% にした。表示する倍率（get）は 50〜300% のまま、
  // 画面上の大きさ（scale）は倍率×PAPER_SCALE にする。大きさを計算する所（strip-layout.js・split-thumbs.js・image-strip-zoom.js・
  // image-thumbs.js・CSS の --paper-zoom）は scale を読む。描く枚数の上限も scale で数える（ZT3）。100% 以下の段は 10% 刻み（ZS3）。
  const PAPER_SCALE = 2;
  const STEPS = Object.freeze([0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]);
  const MIN = STEPS[0];
  const MAX = STEPS[STEPS.length - 1];

  const state = { zoom: 1, acc: null };
  const listeners = [];
  let el = null;

  const clamp = (zoom) => Math.min(MAX, Math.max(MIN, zoom));
  const nextOf = (zoom) => STEPS.find((step) => step > zoom + 1e-9) ?? MAX;
  const prevOf = (zoom) => [...STEPS].reverse().find((step) => step < zoom - 1e-9) ?? MIN;

  function isToolsMode(doc = el?.doc) {
    return doc?.documentElement.getAttribute('data-mode') === 'tools';
  }

  // 紙が 1 枚でもあれば変えられる（帯が 0 本で受け口だけの画面では灰色。決定83 の Claude の判断）。
  function canZoom() {
    return (root.SigK.tabs?.list().length ?? 0) > 0 || root.SigK.imageStrip?.isShown?.() === true;
  }

  // ツールバーの数字と［－］［＋］の灰色をそろえる（ツールモードの間だけ。閲覧などでは viewer の倍率を出す）。
  function syncToolbar() {
    if (el === null || !isToolsMode() || root.SigK.viewer === undefined)
      return;
    root.SigK.viewerControls?.syncAll(el.doc, root.SigK.viewer.getState());
  }

  // 画面上の大きさの倍率（表示する倍率×PAPER_SCALE）。
  const scale = () => state.zoom * PAPER_SCALE;

  // CSS で寸法を掛ける所（「変換する画像」の帯の枠。strips.css）のために、画面上の大きさの倍率を html の --paper-zoom に置く。
  function setCssZoom() {
    el?.doc.documentElement.style.setProperty('--paper-zoom', String(scale()));
  }

  // anchor（{ clientX, clientY }）の下の紙を動かさずに倍率を変える。渡さなければ帯の画面の左上を動かさない。
  function set(zoom, { anchor = null } = {}) {
    const next = clamp(Number(zoom));
    if (!Number.isFinite(next) || next === state.zoom)
      return false;
    const held = root.SigK.stripZoom?.capture(anchor) ?? null;
    const previous = state.zoom;
    state.zoom = next;
    setCssZoom();
    for (const listener of listeners)
      listener(next, previous);
    root.SigK.stripZoom?.restore(held);
    syncToolbar();
    return true;
  }

  const zoomIn = (options) => set(nextOf(state.zoom), options);
  const zoomOut = (options) => set(prevOf(state.zoom), options);
  const reset = () => set(1);

  const KEYS = { '+': zoomIn, '=': zoomIn, '-': zoomOut, 0: reset };

  // Ctrl＋＋/－/0。ツールモードで紙があるときだけ取る（取ったら true）。
  function handleKey(event, doc) {
    if (!isToolsMode(doc) || event.ctrlKey !== true || event.altKey === true || KEYS[event.key] === undefined || !canZoom())
      return false;
    event.preventDefault();
    KEYS[event.key]();
    return true;
  }

  // 帯の画面の上の Ctrl＋ホイール。素のホイールは今までどおり帯の画面を送る（止めない）。
  function onWheel(event) {
    if (!isToolsMode() || event.ctrlKey !== true || event.deltaY === 0 || !canZoom())
      return;
    event.preventDefault();
    const wheel = root.SigK.wheelZoom;
    const now = root.performance?.now?.() ?? Date.now();
    const result = wheel.accumulate(state.acc, wheel.deltaOf(event), now);
    state.acc = result.acc;
    if (result.step === 0)
      return;
    const target = result.step > 0 ? nextOf(state.zoom) : prevOf(state.zoom);
    set(target, { anchor: { clientX: event.clientX, clientY: event.clientY } });
  }

  function init(doc, win) {
    if (win.__sigkToolsZoomReady === true)
      return false;
    win.__sigkToolsZoomReady = true;
    el = { doc, win };
    setCssZoom();
    // 既定のスクロールを止めるので、passive にしない。
    doc.getElementById('strips')?.addEventListener('wheel', onWheel, { passive: false });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsZoom = {
    PAPER_SCALE, STEPS, MIN, MAX, init, set, zoomIn, zoomOut, reset, canZoom, handleKey, syncToolbar, isToolsMode,
    get: () => state.zoom,
    scale,
    onChange: (listener) => listeners.push(listener),
  };
})(typeof window !== 'undefined' ? window : globalThis);
