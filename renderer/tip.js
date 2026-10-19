(function (root) {
  'use strict';

  // 説明の吹き出しを出す・消す（spec-2-5 J1・J6〜J13）。DOM は tip-view.js、位置の計算は tip-place.js、文は tip-content.js、
  // 待たずに出すか・スクロールで止めるかなどの判定は tip-rules.js（どれも tip.js より先に読み込む）。
  //
  //   出す … [data-tip] の要素の上にカーソルを止めて DELAY_MS 待つ。Tab・矢印のキーでフォーカスが移ったときも待つ（J12）。
  //   消す … 対象から出る・フォーカスが外れる・押す・キー・ホイール・スクロール・アプリの窓の大きさが変わる・アプリが非活性になる・
  //          窓（dialog）が開く・モードが変わる（shell.setMode から hide()。J10）。
  //
  // キーで消すときも preventDefault・stopPropagation は呼ばない（Esc のいつもの取りやめを止めない。決定80 ㊸・J6）。
  // 待ち時間は、出すたびに SigK.tip.DELAY_MS・GRACE_MS を読む（テストが小さくする）。

  const state = {
    win: null,
    el: null,
    current: null, // 待っている・出している対象（[data-tip] の要素）
    source: null, // current で待ち始めたきっかけ（tipRules.SOURCE_POINTER か SOURCE_FOCUS）
    shown: false,
    timer: 0,
    pressed: null, // 押した要素。そこから出るまでは出し直さない（J11）
    keyboard: false, // 最後の入力がフォーカスを動かすキーか（tipRules.movesFocus。ほかのキー・pointerdown・アプリが非活性になると外す。J12）
    last: { at: -Infinity, reason: null }, // 出ていた説明の吹き出しを消した時刻と理由（J8）
    described: null, // aria-describedby を戻すための控え（tipView.link が返す { node, prev }）
  };

  // 判定（SigK.tipRules）。init で受け取る。
  let rules = null;

  // 待つのをやめ、出ていれば消す。消したら真。reason は消した理由。続く対象で待たずに出すのは、tipRules.REASON_OUT（対象から出た）で
  // 消したときと、出ている対象の中の子の要素へ入ったとき（入れ子。どちらも tipRules.isQuick。入れ子は、ここで消す前に決める）。
  function hideFor(reason) {
    if (state.el === null)
      return false;
    state.win.clearTimeout(state.timer);
    state.timer = 0;
    state.current = null;
    state.source = null;
    if (!state.shown)
      return false;
    state.shown = false;
    state.last = { at: Date.now(), reason };
    if (state.described !== null)
      root.SigK.tipView.unlink(state.described);
    state.described = null;
    root.SigK.tipView.close(state.el);
    return true;
  }

  // 文の関数が投げたことを、ログに残す。
  function report(error, node) {
    root.SigK.log?.report({
      level: 'warn',
      message: error?.message ?? String(error),
      stack: error?.stack,
      context: { source: 'tip', key: node.dataset.tip },
    });
  }

  // 文を引く。引けない・文の関数が投げたときは null（投げ返さない）。
  function entryOf(node) {
    try {
      return root.SigK.tipContent.resolve(node);
    } catch (error) {
      report(error, node);
      return null;
    }
  }

  // 待ち終わった・待たずに出すとき。対象が文書に無い・hidden の中・待っている対象でない・文が引けない・名前が空なら出さない。
  function show(node) {
    state.timer = 0;
    if (node !== state.current || !node.isConnected || node.closest('[hidden]') !== null)
      return false;
    const entry = entryOf(node);
    if (entry === null || !entry.name)
      return false;
    const view = root.SigK.tipView;
    view.render(state.el, entry);
    view.open(state.el);
    // 出したことの印は、開いた直後に立てる（位置を付ける途中で投げても、hide で消せるように）。
    state.shown = true;
    state.described = view.link(node, state.el);
    const viewport = { width: state.win.innerWidth, height: state.win.innerHeight };
    view.placeAt(state.el, view.anchorOf(node).getBoundingClientRect(), viewport);
    return true;
  }

  // node を対象にして待ち始める。source は待ち始めたきっかけ。quick なら待たずに出す。
  function begin(node, source, quick) {
    state.current = node;
    state.source = source;
    if (quick)
      show(node);
    else
      state.timer = state.win.setTimeout(() => show(node), api.DELAY_MS);
  }

  function onPointerOver(event) {
    // 出していた対象が文書から外れた（描き直された）ときは、その説明の吹き出しを残さない。
    if (state.current !== null && !state.current.isConnected)
      hideFor('gone');
    const node = rules.targetOf(event.target);
    // 押した要素が描き直されていたら、同じ要素とみなせる新しいノードに差し替える（別の所へ入ったなら外す。J11）。
    state.pressed = rules.pressedAfter(state.pressed, node);
    if (node === null || node === state.current || !rules.canHover(event, node, state.pressed))
      return;
    const quick = rules.isQuick({ ...state, node, now: Date.now(), graceMs: api.GRACE_MS });
    // 入れ子の子へ入った・キーのフォーカスで出していたものを替えるときの消し方。「対象から出た」には数えない。
    hideFor('switch');
    begin(node, rules.SOURCE_POINTER, quick);
  }

  function onPointerOut(event) {
    if (rules.leaves(state.pressed, event))
      state.pressed = null;
    if (rules.leaves(state.current, event))
      hideFor(rules.REASON_OUT);
  }

  function onFocusIn(event) {
    const node = rules.targetOf(event.target);
    if (!state.keyboard || node === null || node === state.current)
      return;
    hideFor('focus');
    begin(node, rules.SOURCE_FOCUS, false);
  }

  function onFocusOut(event) {
    if (rules.leaves(state.current, event))
      hideFor('blur');
  }

  function onPointerDown(event) {
    state.keyboard = false;
    hideFor('press');
    state.pressed = rules.targetOf(event.target);
  }

  function onKeyDown(event) {
    state.keyboard = rules.movesFocus(event);
    hideFor('key');
  }

  function onScroll() {
    if (rules.stopsOnScroll(state))
      hideFor('scroll');
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
    rules = root.SigK.tipRules;
    Object.assign(state, { win, el: root.SigK.tipView.create(doc) });
    doc.addEventListener('pointerover', onPointerOver);
    doc.addEventListener('pointerout', onPointerOut);
    doc.addEventListener('focusin', onFocusIn);
    doc.addEventListener('focusout', onFocusOut);
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('wheel', () => hideFor('wheel'), { capture: true, passive: true });
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
    for (const type of ['resize', 'blur'])
      win.addEventListener(type, () => hideFor(type));
    // 非活性になったらキーの印も外す（活性に戻ると Chromium が、フォーカスのある要素へ focusin を出し直すため。J12）。
    win.addEventListener('blur', () => { state.keyboard = false; });
    watchDialogs(doc, win);
    return true;
  }

  // key は、出している対象の data-tip の鍵（出していなければ null）。
  function getState() {
    const key = state.shown ? state.current.dataset.tip ?? null : null;
    return { shown: state.shown, key };
  }

  const api = {
    DELAY_MS: 500,
    GRACE_MS: 300,
    init,
    hide: () => hideFor('hide'),
    isShown: () => state.shown,
    getState,
  };

  const SigK = (root.SigK = root.SigK || {});
  SigK.tip = api;
})(typeof window !== 'undefined' ? window : globalThis);
