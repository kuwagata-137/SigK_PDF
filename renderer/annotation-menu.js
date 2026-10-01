(function (root) {
  'use strict';

  // 書き込みの上の右クリックで出す「削除」のメニュー（spec-4b-3b 確定事項D7〜D10。モック screenshots/phase4b-3-menu.png）。
  //
  // index.html の #annot-menu（role=menu）を、押した点に position:fixed で出す。窓の端からはみ出すときは placeAt で内側へ押し戻す。
  // 開くかどうか（右クリックの当たり）は annotate-right-button.js が決める。閉じるきっかけは、項目を押した・外の mousedown・Esc
  // （annotate.escape の先頭）・ほかのキー・#view のスクロールとホイール・窓の大きさ・窓のフォーカス・モード・選択の変化。
  // メニューの外を左で押して閉じたとき、その押しが #view の中なら飲む（入力欄を閉じた押しと同じ。pointer が takeSwallow で取る）。
  // フォーカスは移さない（キーの Enter が右パネルの「直す」へ流れないため）。

  // 窓の端から空ける幅（px）。
  const MARGIN = 4;
  // 押してもメニューを閉じないキー（修飾キーだけ）。
  const MODIFIERS = Object.freeze(['Shift', 'Control', 'Alt', 'Meta']);

  const state = {
    win: null,
    el: null,
    view: null,
    // メニューの外を左で押して閉じた印（その押しは pointer が飲む）。
    swallow: false,
  };

  // 押した点 at に size の箱を置く左上。窓（win）の端から MARGIN の内側に収める。窓より大きければ左上に寄せる。
  function placeAt(at, size, win) {
    const left = Math.max(MARGIN, Math.min(at.x, win.width - MARGIN - size.width));
    const top = Math.max(MARGIN, Math.min(at.y, win.height - MARGIN - size.height));
    return { left, top };
  }

  function isOpen() {
    return state.el !== null && state.el.hidden === false;
  }

  function open(x, y) {
    if (state.el === null)
      return false;
    state.el.hidden = false;
    const box = state.el.getBoundingClientRect();
    const { left, top } = placeAt({ x, y }, { width: box.width, height: box.height }, { width: state.win.innerWidth, height: state.win.innerHeight });
    state.el.style.left = `${left}px`;
    state.el.style.top = `${top}px`;
    return true;
  }

  function close() {
    if (!isOpen())
      return false;
    state.el.hidden = true;
    return true;
  }

  function takeSwallow() {
    const swallow = state.swallow;
    state.swallow = false;
    return swallow;
  }

  // 捕捉で見る。メニューの外の押しなら閉じ、左で #view の中なら、その押しを飲む印を立てる（確定事項D9）。
  function onDocumentMouseDown(event) {
    if (!isOpen() || state.el.contains(event.target))
      return;
    close();
    if ((event.button ?? 0) === 0 && state.view?.contains(event.target) === true)
      state.swallow = true;
  }

  // Esc は annotate.escape() が先頭で閉じる（選択は残す）。ほかのキーはここで閉じる（Delete は閉じてから消す）。
  function onDocumentKeyDown(event) {
    if (!isOpen() || event.key === 'Escape' || MODIFIERS.includes(event.key))
      return;
    close();
  }

  function onDelete() {
    close();
    root.SigK.annotate?.remove();
  }

  function init(doc, win) {
    if (win.__sigkAnnotationMenuReady === true)
      return false;
    const el = doc.getElementById('annot-menu');
    if (el === null)
      return false;
    win.__sigkAnnotationMenuReady = true;
    state.win = win;
    state.el = el;
    state.view = doc.getElementById('view');
    // 押してもフォーカスを移さない（確定事項D10）。右クリックの既定のメニューも出さない。
    el.addEventListener('mousedown', (event) => event.preventDefault());
    el.addEventListener('contextmenu', (event) => event.preventDefault());
    el.querySelector('[data-action="delete"]')?.addEventListener('click', onDelete);
    doc.addEventListener('mousedown', onDocumentMouseDown, true);
    // 押し離しが終わったら、飲む印は消す（#view の外で押したとき用。入力欄の印と同じ）。
    doc.addEventListener('mouseup', () => { state.swallow = false; }, true);
    doc.addEventListener('keydown', onDocumentKeyDown, true);
    state.view?.addEventListener('scroll', close);
    state.view?.addEventListener('wheel', close, { passive: true });
    win.addEventListener('resize', close);
    win.addEventListener('blur', close);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationMenu = { MARGIN, placeAt, init, open, close, isOpen, takeSwallow };
})(typeof window !== 'undefined' ? window : globalThis);
