(function (root) {
  'use strict';

  // ページビューの上端に出す帯（spec-1-2 確定事項20）。
  //
  // 文書を開いたまま失敗を伝える場所である。全面のオーバーレイで伝えると
  // 読んでいる文書が隠れるうえ、#view の中に重ねると中身と一緒に流れて
  // 画面外へ出る。docs/04 第6章が進捗表示に「ページビューの上に帯状」を
  // 定めているので、様式をそちらへ揃えた。
  //
  // 文書が開いていないときの文言は viewer.js が #view-empty に出す。
  // 出し分けは viewer.setMessage() が1か所で行う。

  const AUTO_HIDE_MS = 6000;

  const state = { timer: 0 };

  let el = null;

  function hide() {
    if (el === null)
      return false;
    if (state.timer !== 0) {
      root.clearTimeout(state.timer);
      state.timer = 0;
    }
    el.banner.hidden = true;
    el.banner.textContent = '';
    return true;
  }

  // 読み終える前に消えては困るので数秒置く。押せばすぐ消える。
  function show(text, autoHideMs = AUTO_HIDE_MS) {
    if (el === null)
      return false;
    hide();
    el.banner.textContent = text;
    el.banner.hidden = false;
    if (autoHideMs > 0)
      state.timer = root.setTimeout(hide, autoHideMs);
    return true;
  }

  function isVisible() {
    return el !== null && el.banner.hidden === false;
  }

  function text() {
    return el === null ? '' : el.banner.textContent;
  }

  function init(doc, win) {
    if (win.__sigkBannerReady === true)
      return false;

    const banner = doc.getElementById('view-banner');
    if (banner === null)
      return false;
    win.__sigkBannerReady = true;

    el = { doc, banner };
    banner.addEventListener('click', () => hide());
    hide();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.viewBanner = { AUTO_HIDE_MS, init, show, hide, isVisible, text };
})(typeof window !== 'undefined' ? window : globalThis);
