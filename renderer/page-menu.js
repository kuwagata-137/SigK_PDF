(function (root) {
  'use strict';

  // ページの右クリックメニュー（spec-7-5 確定事項M1・P3。見本 screenshots/question-pg1-paste-position.png）。
  //
  // index.html の #page-menu（role=menu）を、右クリックした点に position:fixed で表示する。見た目と置き方（窓の端からはみ出すときは内側へ
  // 押し戻す。annotation-menu.js の placeAt）は、書き込みの右クリックメニューと同じ。項目は上から［コピー］［切り取り］［貼り付け］・区切り線・
  // ［削除］で、押せない項目は aria-disabled で灰色にする。表示するかどうかと、押したときの操作は page-menu-route.js が決める（open の onPick）。
  //
  // 閉じるきっかけ（P3）: 項目を押した・メニューの外の mousedown・Esc（escape-order.js の段 3）・ほかのキー・スクロール・ホイール・
  // ウインドウの大きさの変更・ウインドウのフォーカスが外れた。フォーカスは移さない（続くキーをページ一覧へ届けるため）。

  const ACTIONS = Object.freeze(['copy', 'cut', 'paste', 'delete']);
  // 押してもメニューを閉じないキー（修飾キーだけ）。
  const MODIFIERS = Object.freeze(['Shift', 'Control', 'Alt', 'Meta']);

  const state = { win: null, el: null, onPick: null };

  function isOpen() {
    return state.el !== null && state.el.hidden === false;
  }

  function itemOf(action) {
    return state.el.querySelector(`[data-action="${action}"]`);
  }

  function setEnabled(action, enabled) {
    const item = itemOf(action);
    if (enabled)
      item.removeAttribute('aria-disabled');
    else
      item.setAttribute('aria-disabled', 'true');
  }

  // (x, y) に表示する。enabled は { copy, cut, paste, delete } の真偽（無い項目は灰色）。onPick(action) は押せる項目を押したときに呼ぶ。
  function open(x, y, { enabled = {}, onPick = null } = {}) {
    if (state.el === null)
      return false;
    ACTIONS.forEach((action) => setEnabled(action, enabled[action] === true));
    state.onPick = onPick;
    state.el.hidden = false;
    const box = state.el.getBoundingClientRect();
    const win = { width: state.win.innerWidth, height: state.win.innerHeight };
    const { left, top } = root.SigK.annotationMenu.placeAt({ x, y }, { width: box.width, height: box.height }, win);
    state.el.style.left = `${left}px`;
    state.el.style.top = `${top}px`;
    return true;
  }

  function close() {
    if (!isOpen())
      return false;
    state.el.hidden = true;
    state.onPick = null;
    return true;
  }

  // 項目が押せるか（メニューを表示しているときだけ）。
  function isEnabled(action) {
    return isOpen() && itemOf(action)?.getAttribute('aria-disabled') !== 'true';
  }

  function onItemClick(event) {
    const item = event.target?.closest?.('[data-action]') ?? null;
    if (item === null || item.getAttribute('aria-disabled') === 'true')
      return;
    const pick = state.onPick;
    close();
    pick?.(item.dataset.action);
  }

  // 捕捉で見る。メニューの外の押しなら閉じる（右クリックで別のページを押したときは、このあと届く contextmenu で表示し直す）。
  function onDocumentMouseDown(event) {
    if (isOpen() && !state.el.contains(event.target))
      close();
  }

  // Esc は Esc の振り分け（escape-order.js）が閉じる。ほかのキーはここで閉じる（Delete・Ctrl+C などは、閉じてからページ一覧で受ける）。
  function onDocumentKeyDown(event) {
    if (!isOpen() || event.key === 'Escape' || MODIFIERS.includes(event.key))
      return;
    close();
  }

  function onScroll(event) {
    if (isOpen() && !state.el.contains(event.target))
      close();
  }

  function init(doc, win) {
    if (win.__sigkPageMenuReady === true)
      return false;
    const el = doc.getElementById('page-menu');
    if (el === null)
      return false;
    win.__sigkPageMenuReady = true;
    state.win = win;
    state.el = el;
    // 押してもフォーカスを移さない。右クリックの既定のメニューも出さない。
    el.addEventListener('mousedown', (event) => event.preventDefault());
    el.addEventListener('contextmenu', (event) => event.preventDefault());
    el.addEventListener('click', onItemClick);
    doc.addEventListener('mousedown', onDocumentMouseDown, true);
    doc.addEventListener('keydown', onDocumentKeyDown, true);
    // スクロールの合図は泡立たないので、捕捉で受ける（左パネル・帯の画面・帯のページの段・ページ表示のどれでも閉じる）。
    doc.addEventListener('scroll', onScroll, true);
    doc.addEventListener('wheel', onScroll, { capture: true, passive: true });
    win.addEventListener('resize', close);
    win.addEventListener('blur', close);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageMenu = { ACTIONS, init, open, close, isOpen, isEnabled };
})(typeof window !== 'undefined' ? window : globalThis);
