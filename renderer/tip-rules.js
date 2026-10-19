(function (root) {
  'use strict';

  // 説明の吹き出しを出す・消すときの判定（spec-2-5 J1・J8・J11・J12）。tip.js が使う。状態は持たず、渡された値だけで決める。
  // 要素については closest・contains で読むだけで、書き換えない。

  // 消した理由のうち「対象から出た」（pointerout）。この理由で消したときだけ、続く対象で待たずに出す（J8）。
  const REASON_OUT = 'out';
  // 待ち始めたきっかけ。マウス（pointerover）か、キーで移ったフォーカス（focusin）か。
  const SOURCE_POINTER = 'pointer';
  const SOURCE_FOCUS = 'focus';

  // イベントの的から、説明の吹き出しの対象（[data-tip] の要素）を引く。無ければ null。
  function targetOf(node) {
    return typeof node?.closest === 'function' ? node.closest('[data-tip]') : null;
  }

  // other が node の中（node 自身を含む）か。どちらかが無い（窓の外へ出た）ときは外。
  function inside(node, other) {
    return node != null && other != null && node.contains(other);
  }

  // node の中の的から、node の外へ移ったか（pointerout・focusout の event）。
  function leaves(node, event) {
    return node != null && node.contains(event.target) && !inside(node, event.relatedTarget);
  }

  // 説明の吹き出しの属性（data-tip・data-tip-name・data-tip-desc・data-tip-file）。
  const TIP_FIELDS = ['tip', 'tipName', 'tipDesc', 'tipFile'];

  // 押した要素 pressed と、マウスで入った対象 node が同じ要素か（J11）。押すと描き直される要素（タブ・サムネイルの上のボタン・
  // 「変換する画像」の帯の画像）は、押したあと新しいノードに替わる。pressed が文書から外れていて、説明の吹き出しの属性が
  // どれも同じなら、同じ要素とみなす。pressed が文書にあるなら、同じノードのときだけ。
  function samePressed(pressed, node) {
    if (pressed == null || node == null)
      return false;
    if (pressed === node)
      return true;
    return !pressed.isConnected && TIP_FIELDS.every((field) => pressed.dataset[field] === node.dataset[field]);
  }

  // マウスで入った対象 node（無ければ null）から見た、押した要素（J11）。pressed が文書から外れている（描き直された）ときは、
  // 同じ要素とみなせるなら node に差し替え、別の所へ入ったなら null（押した要素から出たことにする）。文書にあるなら pressed のまま。
  function pressedAfter(pressed, node) {
    if (pressed == null || pressed.isConnected)
      return pressed ?? null;
    return samePressed(pressed, node) ? node : null;
  }

  // マウスで入った対象 node で待ち始めてよいか（J11）。ボタンを押したまま・タッチ・押した要素 pressed の上では待たない。
  function canHover(event, node, pressed) {
    return event.buttons === 0 && event.pointerType !== 'touch' && !samePressed(pressed, node);
  }

  // フォーカスを動かすキー（Tab・Shift+Tab・矢印）。Ctrl・Alt・Meta と一緒のとき（タブを替える Ctrl+Tab など）は数えない。
  const FOCUS_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  // keydown の event が、フォーカスを動かすキーか（J12）。このキーのときだけ「最後の入力はキー」の印を立てる。
  // ほかのキー（Ctrl+S・Ctrl+O・Esc・Enter・Alt など）で立てると、窓を閉じたあと・Alt+Tab で戻ったあとに Chromium がフォーカスのある
  // ボタンへ出し直す focusin で、最後に押したボタンに説明の吹き出しが出てしまう（Windows ではボタンは押すとフォーカスを持つ）。
  function movesFocus(event) {
    return FOCUS_KEYS.has(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey;
  }

  // マウスで入った対象 node で、待たずに出すか。次のどちらかのときだけ（J8）。
  //   ・出ている要素 current の中の子の要素（タブの中の × など）へ入った（入れ子）
  //   ・出ていた説明の吹き出しを「対象から出た」理由で消してから graceMs 以内に入った（last は消した時刻と理由、now は今の時刻）
  // キーのフォーカスで出ている状態から、マウスで別の対象へ入ったときは待つ。
  function isQuick({ shown, current, node, last, now, graceMs }) {
    if (shown && inside(current, node))
      return true;
    return last.reason === REASON_OUT && now - last.at <= graceMs;
  }

  // scroll で止めるか。出ている説明の吹き出しと、マウスで始めた待ちは止める。キーのフォーカスで始めた待ちは止めない
  // （フォーカスを当てると、要素を見える所へ動かすスクロールが次の描画で起き、それで止めるとキーでは出なくなるため。J1・J12）。
  function stopsOnScroll({ shown, source }) {
    return shown || source !== SOURCE_FOCUS;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tipRules = Object.freeze({
    REASON_OUT, SOURCE_POINTER, SOURCE_FOCUS, targetOf, inside, leaves, samePressed, pressedAfter, canHover, movesFocus, isQuick, stopsOnScroll,
  });
})(typeof window !== 'undefined' ? window : globalThis);
