(function (root) {
  'use strict';

  // 説明の吹き出しを出す・消す（spec-2-5 J1・J6〜J13）。DOM は tip-view.js、位置の計算は tip-place.js、文は tip-content.js。
  //
  //   出す     … [data-tip] の要素の上にカーソルを止めて DELAY_MS 待つ。最後の入力がキーのときは、フォーカスが移ったときも待つ（J12）。
  //              出ていた説明の吹き出しを「出た」理由で消してから GRACE_MS 以内に別の要素へ入ったら、待たずに出す（J8）。
  //   消す     … 要素から出る・フォーカスが外れる・押す・キー・ホイール・スクロール・窓の大きさが変わる・アプリが非活性になる・
  //              窓（dialog）が開く・モードが変わる（shell.setMode から hide()。J10）。
  //   出さない … マウスのボタンを押したまま・タッチ・押したあと同じ要素の上にいる間（J11）。
  //
  // キーで消すときも preventDefault・stopPropagation は呼ばない（Esc のいつもの取りやめを止めない。決定80 ㊸・J6）。
  // 待ち時間は、出すたびに SigK.tip.DELAY_MS・GRACE_MS を読む（テストが小さくする）。

  const REASON_OUT = 'out';

  const state = {
    win: null, el: null,
    current: null, // 待っている・出している [data-tip] の要素
    shown: false, timer: 0,
    pressed: null, // 押した要素。そこから出るまでは出し直さない（J11）
    keyboard: false, // 最後の入力がキーか（keydown で付け、pointerdown で外す。J12）
    last: { at: -Infinity, reason: null }, // 出ていた説明の吹き出しを消した時刻と理由（J8）
    described: null, // aria-describedby を戻すための控え { node, prev }
  };

  // ---- DOM に触れない判定 ----

  // イベントの的から、説明の吹き出しの対象（[data-tip] の要素）を引く。
  function targetOf(node) {
    return typeof node?.closest === 'function' ? node.closest('[data-tip]') : null;
  }

  // other が node の中（node 自身を含む）か。other が無い（窓の外へ出た）ときは外。
  function inside(node, other) {
    return node !== null && other != null && node.contains(other);
  }

  // node の中の的から、node の外へ移ったか（pointerout・focusout）。
  function leaves(node, event) {
    return node !== null && node.contains(event.target) && !inside(node, event.relatedTarget);
  }

  // ---- 出す・消す ----

  function describe(node) {
    state.described = { node, prev: node.getAttribute('aria-describedby') };
    node.setAttribute('aria-describedby', state.el.id);
  }

  function undescribe() {
    const described = state.described;
    if (described === null)
      return;
    state.described = null;
    if (described.prev === null)
      described.node.removeAttribute('aria-describedby');
    else
      described.node.setAttribute('aria-describedby', described.prev);
  }

  // 待つのをやめ、出ていれば消す。消したら真。reason は消した理由（REASON_OUT のときだけ、続く要素で待たずに出す）。
  function hideFor(reason) {
    if (state.el === null)
      return false;
    state.win.clearTimeout(state.timer);
    state.timer = 0;
    state.current = null;
    if (!state.shown)
      return false;
    state.shown = false;
    state.last = { at: Date.now(), reason };
    undescribe();
    root.SigK.tipView.close(state.el);
    return true;
  }

  // 文を引く。引けない・文の関数が投げたときは null（投げ返さない。投げたことはログに残す）。
  function entryOf(node) {
    try {
      return root.SigK.tipContent.resolve(node);
    } catch (error) {
      root.SigK.log?.report({ level: 'warn', message: error?.message ?? String(error), stack: error?.stack, context: { source: 'tip', key: node.dataset.tip } });
      return null;
    }
  }

  // 待ち終わった・待たずに出すとき。要素が文書に無い・hidden の中・今の要素でない・文が引けないなら出さない。
  function show(node) {
    state.timer = 0;
    if (node !== state.current || !node.isConnected || node.closest('[hidden]') !== null)
      return false;
    const entry = entryOf(node);
    if (entry === null)
      return false;
    const view = root.SigK.tipView;
    view.render(state.el, entry);
    view.open(state.el);
    view.placeAt(state.el, view.anchorOf(node).getBoundingClientRect(), { width: state.win.innerWidth, height: state.win.innerHeight });
    describe(node);
    state.shown = true;
    return true;
  }

  // node を今の要素にして待ち始める。quick なら待たずに出す。
  function begin(node, quick) {
    state.current = node;
    if (quick)
      show(node);
    else
      state.timer = state.win.setTimeout(() => show(node), api.DELAY_MS);
  }

  function withinGrace() {
    return state.last.reason === REASON_OUT && Date.now() - state.last.at <= api.GRACE_MS;
  }

  // ---- イベント ----

  function onPointerOver(event) {
    // 出していた要素が文書から外れた（描き直された）ときは、その説明の吹き出しを残さない。
    if (state.current !== null && !state.current.isConnected)
      hideFor('gone');
    const node = targetOf(event.target);
    if (node === null || node === state.current)
      return;
    if (event.buttons !== 0 || event.pointerType === 'touch' || node === state.pressed)
      return;
    // 出したまま別の要素（タブの中の × など）へ入ったときも、隣へ移ったのと同じに待たずに出す。
    const quick = state.shown || withinGrace();
    hideFor(REASON_OUT);
    begin(node, quick);
  }

  function onPointerOut(event) {
    if (leaves(state.pressed, event))
      state.pressed = null;
    if (leaves(state.current, event))
      hideFor(REASON_OUT);
  }

  function onFocusIn(event) {
    const node = targetOf(event.target);
    if (!state.keyboard || node === null || node === state.current)
      return;
    hideFor('focus');
    begin(node, false);
  }

  function onFocusOut(event) {
    if (leaves(state.current, event))
      hideFor('blur');
  }

  function onPointerDown(event) {
    state.keyboard = false;
    hideFor('press');
    state.pressed = targetOf(event.target);
  }

  function onKeyDown() {
    state.keyboard = true;
    hideFor('key');
  }

  // 窓（dialog）が開いたら消す（showModal・show はどれも open の属性を付ける）。
  function watchDialogs(doc, win) {
    const observer = new win.MutationObserver((records) => {
      if (records.some((record) => record.target.localName === 'dialog' && record.target.hasAttribute('open')))
        hideFor('dialog');
    });
    observer.observe(doc.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
  }

  function init(doc, win) {
    if (win.__sigkTipReady === true)
      return false;
    win.__sigkTipReady = true;
    Object.assign(state, { win, el: root.SigK.tipView.create(doc) });
    doc.addEventListener('pointerover', onPointerOver);
    doc.addEventListener('pointerout', onPointerOut);
    doc.addEventListener('focusin', onFocusIn);
    doc.addEventListener('focusout', onFocusOut);
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('keydown', onKeyDown, true);
    for (const type of ['wheel', 'scroll'])
      doc.addEventListener(type, () => hideFor(type), { capture: true, passive: true });
    for (const type of ['resize', 'blur'])
      win.addEventListener(type, () => hideFor(type));
    watchDialogs(doc, win);
    return true;
  }

  // getState の key は、出している要素の data-tip の鍵（出していなければ null）。
  const api = { DELAY_MS: 500, GRACE_MS: 300, init, hide: () => hideFor('hide'), isShown: () => state.shown,
    getState: () => ({ shown: state.shown, key: state.shown ? state.current.dataset.tip ?? null : null }) };

  const SigK = (root.SigK = root.SigK || {});
  SigK.tip = api;
})(typeof window !== 'undefined' ? window : globalThis);
