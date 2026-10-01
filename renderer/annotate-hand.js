(function (root) {
  'use strict';

  // 「ハンド」の道具で表示を引く（spec-4b-3b 確定事項A）。
  //
  // ハンドを持っているとき、#view の中を左で押すと、どこでも（紙の上・灰色の所・書き込みの上）表示を引き始める。引いた分だけ
  // #view のスクロールを逆に動かす（手で紙を引く向き）。動きは前回の点からの差で足していく（引いている途中で倍率が変わっても
  // 飛ばないため）。押す・離すの振り分けは annotate-pointer.js が持ち、ここは引くことだけを持つ。

  const state = {
    doc: null,
    view: null,
    // 引いている間の、前回のマウスの点（clientX/Y）。引いていなければ null。
    last: null,
  };

  // #view のスクロールバーの上の押しか。スクロールバーを掴む操作を奪わない。jsdom（レイアウトしない）では clientWidth が 0 のことがある。
  function onScrollbar(event) {
    const { view } = state;
    if (event.target !== view || view.clientWidth === 0)
      return false;
    const base = view.getBoundingClientRect();
    return event.clientX - base.left >= view.clientLeft + view.clientWidth
      || event.clientY - base.top >= view.clientTop + view.clientHeight;
  }

  // 左で押した。引き始めたら true。文字を選ばせないため、押しは既定の動きを止める。
  function begin(event) {
    if (state.view === null || onScrollbar(event))
      return false;
    event.preventDefault();
    state.last = { x: event.clientX, y: event.clientY };
    state.doc.documentElement.setAttribute('data-panning', '');
    return true;
  }

  function move(event) {
    if (state.last === null)
      return false;
    state.view.scrollLeft -= event.clientX - state.last.x;
    state.view.scrollTop -= event.clientY - state.last.y;
    state.last = { x: event.clientX, y: event.clientY };
    return true;
  }

  // 離した・取りやめた（Esc・左＋右・モードの切り替え）。表示は引いたところに残す。引いていなければ false。
  function end() {
    if (state.last === null)
      return false;
    state.last = null;
    state.doc.documentElement.removeAttribute('data-panning');
    return true;
  }

  function init(doc) {
    state.doc = doc;
    state.view = doc.getElementById('view');
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateHand = { init, begin, move, end, cancel: end, isPanning: () => state.last !== null };
})(typeof window !== 'undefined' ? window : globalThis);
