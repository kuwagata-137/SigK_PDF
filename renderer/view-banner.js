(function (root) {
  'use strict';

  // ページビューの上端に出す帯（spec-1-2 確定事項20・spec-1-6 確定事項6〜8）。
  //
  // 文書を開いたまま失敗を伝える場所である。全面のオーバーレイで伝えると
  // 読んでいる文書が隠れるうえ、#view の中に重ねると中身と一緒に流れて
  // 画面外へ出る。docs/04 第6章が進捗表示に「ページビューの上に帯状」を
  // 定めているので、様式をそちらへ揃えた。
  //
  // 文書が開いていないときの文言は viewer.js が #view-empty に出す。
  // 出し分けは viewer.setMessage() が1か所で行う。
  //
  // 塊⑤ で2つ足した。**操作ボタン**（保存中の「中止」を押させる場所）と、
  // **色**（進捗まで赤いと失敗に見える）である。文字だけを出す従来の呼び方
  // show(text) と show(text, 20) はそのまま動く。

  const AUTO_HIDE_MS = 6000;
  const TONES = ['danger', 'info'];

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
    el.banner.replaceChildren();
    el.banner.removeAttribute('data-tone');
    return true;
  }

  // 第2引数は、数値なら従来どおり自動で消えるまでの時間として扱う。
  function normalizeOptions(options) {
    if (typeof options === 'number')
      return { autoHideMs: options };
    return options ?? {};
  }

  function buildAction(action) {
    const button = el.doc.createElement('button');
    button.type = 'button';
    button.className = 'banner-action';
    button.textContent = action.label;
    // 帯そのものを押すと閉じる作りなので、ボタンの押下がそこへ伝わらないようにする。
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      action.onClick();
    });
    return button;
  }

  // 読み終える前に消えては困るので数秒置く。押せばすぐ消える。
  // autoHideMs に 0 を渡すと、消すまで出したままになる（進捗はこちら）。
  function show(text, options = {}) {
    if (el === null)
      return false;
    hide();

    const { autoHideMs = AUTO_HIDE_MS, action = null, tone = 'danger' } = normalizeOptions(options);

    const label = el.doc.createElement('span');
    label.className = 'banner-text';
    label.textContent = text;
    el.banner.replaceChildren(label);

    if (action !== null && typeof action.onClick === 'function')
      el.banner.append(buildAction(action));

    if (TONES.includes(tone) && tone !== 'danger')
      el.banner.setAttribute('data-tone', tone);

    el.banner.hidden = false;
    if (autoHideMs > 0)
      state.timer = root.setTimeout(hide, autoHideMs);
    return true;
  }

  function isVisible() {
    return el !== null && el.banner.hidden === false;
  }

  // 文言だけを返す。操作ボタンのラベルは混ぜない。
  function text() {
    if (el === null)
      return '';
    const label = el.banner.querySelector('.banner-text');
    return label === null ? el.banner.textContent : label.textContent;
  }

  // 出ている操作ボタン。テストと、保存中に中止を押させる経路が使う。
  function action() {
    return el === null ? null : el.banner.querySelector('.banner-action');
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
  SigK.viewBanner = { AUTO_HIDE_MS, TONES, init, show, hide, isVisible, text, action };
})(typeof window !== 'undefined' ? window : globalThis);
