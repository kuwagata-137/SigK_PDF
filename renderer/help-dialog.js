(function (root) {
  'use strict';

  // 使い方の窓（spec-4b-7b 確定事項A〜C。決定70 ①②）。ツールバーの「？」・F1・メニュー「ヘルプ」→「使い方」で開く。
  // 左に目次、右に 1 つの節。開いたときは今のモード（編集モードなら今持っている道具）の節を出す。中身は help-content.js、
  // DOM を組むのは help-render.js。窓の中（目次と 13 節の本文）は起動のときに 1 回だけ組み、開くたびには出し分けだけを替える（B8）。

  // 編集モードの道具 → 節（確定事項C）。道具なしと、ここに無い道具は「選ぶ・動かす・消す」。
  const TOOL_SECTIONS = Object.freeze({
    select: 'select', hand: 'select', highlight: 'markup', underline: 'markup', strikeout: 'markup', text: 'text', callout: 'text',
    shape: 'shapes', pen: 'pen', marker: 'pen', eraser: 'pen', note: 'note', mosaic: 'mosaic-trim', trim: 'mosaic-trim',
  });

  const MODE_SECTIONS = Object.freeze({ view: 'view', pages: 'pages' });

  // 目次のボタンで、前・次・最初・最後の節へ移るキー（確定事項B4）。
  const NAV_KEYS = Object.freeze({ ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity });

  const state = { current: null, buttons: 0 };

  function content() {
    return root.SigK.helpContent;
  }

  function dialogOf(doc) {
    return doc.getElementById('help-dialog');
  }

  // 開いたときに出す節（確定事項C）。ツールモードは文書が無くても使えるので、ツールの節を出す。
  function sectionFor({ mode, open, tool }) {
    if (mode === 'tools')
      return 'tools';
    if (open !== true)
      return 'basics';
    if (mode === 'annot')
      return TOOL_SECTIONS[tool] ?? 'select';
    return MODE_SECTIONS[mode] ?? 'view';
  }

  function sceneOf(doc) {
    return {
      mode: doc.documentElement.getAttribute('data-mode'),
      open: root.SigK.viewer?.getState().open === true,
      tool: root.SigK.annotate?.getTool() ?? null,
    };
  }

  function navButton(doc, id) {
    return dialogOf(doc)?.querySelector(`.help-item[data-section="${id}"]`) ?? null;
  }

  // 右の本文をその節にし、目次の印を移す。本文のスクロールは先頭へ戻す（確定事項B3）。
  function show(doc, id) {
    const dialog = dialogOf(doc);
    if (dialog === null || navButton(doc, id) === null)
      return false;
    for (const node of dialog.querySelectorAll('.help-section'))
      node.hidden = node.dataset.section !== id;
    // 目次で Tab が止まるのは今の節のボタンだけにする（点検の直し。13 個全部に止まると本文まで遠い）。
    for (const button of dialog.querySelectorAll('.help-item')) {
      const on = button.dataset.section === id;
      button.tabIndex = on ? 0 : -1;
      if (on)
        button.setAttribute('aria-current', 'true');
      else
        button.removeAttribute('aria-current');
    }
    toTop(dialog);
    state.current = id;
    return true;
  }

  function toTop(dialog) {
    const body = dialog.querySelector('.help-body');
    if (body !== null)
      body.scrollTop = 0;
  }

  function isOpen(doc) {
    return dialogOf(doc)?.hasAttribute('open') === true;
  }

  // 開く（確定事項A・B5・B7）。ほかの窓が開いている間と、もう開いている間は何もしない（今の節も替えない）。
  function open(doc) {
    const dialog = dialogOf(doc);
    if (dialog === null || doc.querySelector('dialog[open]') !== null)
      return false;
    const id = sectionFor(sceneOf(doc));
    show(doc, id);
    // jsdom には showModal が無い。open 属性で代用する。
    if (typeof dialog.showModal === 'function')
      dialog.showModal();
    else
      dialog.setAttribute('open', '');
    // 閉じている間は本文に描く箱が無く、0 を当てても効かない。開いたあとで、Chromium が覚えていた前の位置から先頭へ戻す（点検の直し）。
    toTop(dialog);
    navButton(doc, id)?.focus();
    return true;
  }

  function close(doc) {
    const dialog = dialogOf(doc);
    if (dialog === null || !isOpen(doc))
      return false;
    if (typeof dialog.close === 'function')
      dialog.close();
    else
      dialog.removeAttribute('open');
    return true;
  }

  // 目次の ↓↑・Home・End（確定事項B4）。移ると同時に右も替え、フォーカスも移す。端で止まる。
  function step(doc, event) {
    const move = NAV_KEYS[event.key];
    if (move === undefined || event.ctrlKey || event.altKey || event.shiftKey)
      return false;
    const ids = content().SECTIONS.map((section) => section.id);
    const from = event.target?.dataset?.section ?? state.current;
    const index = Math.min(ids.length - 1, Math.max(0, ids.indexOf(from) + move));
    event.preventDefault();
    show(doc, ids[index]);
    navButton(doc, ids[index])?.focus();
    return true;
  }

  // マウスのボタンを押している間（押して引いている途中）は開かない（確定事項A3）。メニューの合図も同じ（点検の直し）。
  function openUnlessHeld(doc) {
    return state.buttons === 0 && open(doc);
  }

  // F1（確定事項A2・A3）。viewer-keys.js の handleKey が、窓が開いていない間に渡す。F1 なら true（開いたかは問わない）。
  // 押し続けの繰り返しと、IME の変換中は開かない（点検の直し。× で閉じたあとも押し続けていると、すぐ開き直していた）。
  function handleKey(event, doc) {
    if (event.key !== 'F1' || event.ctrlKey || event.altKey || event.metaKey)
      return false;
    event.preventDefault();
    if (event.repeat !== true && event.isComposing !== true && event.keyCode !== 229)
      openUnlessHeld(doc);
    return true;
  }

  // マウスのボタンを押しているかを控える（確定事項A3）。左を押したまま右を押すと pointermove で buttons が変わる。
  function trackButtons(doc, win) {
    const note = (event) => { state.buttons = event.buttons ?? 0; };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
      doc.addEventListener(type, note, true);
    win.addEventListener('blur', () => { state.buttons = 0; });
  }

  function init(doc, win) {
    if (win.__sigkHelpReady === true)
      return false;
    win.__sigkHelpReady = true;
    const dialog = dialogOf(doc);
    if (dialog === null)
      return false;

    root.SigK.helpRender.fill(doc, dialog, content());
    trackButtons(doc, win);
    doc.getElementById('btn-help')?.addEventListener('click', () => open(doc));
    doc.getElementById('help-close')?.addEventListener('click', () => close(doc));
    doc.getElementById('help-done')?.addEventListener('click', () => close(doc));
    const nav = dialog.querySelector('.help-nav');
    nav?.addEventListener('click', (event) => {
      const button = event.target?.closest?.('.help-item') ?? null;
      if (button !== null)
        show(doc, button.dataset.section);
    });
    nav?.addEventListener('keydown', (event) => step(doc, event));
    // メニュー「ヘルプ」→「使い方」の合図（確定事項A4）。窓が開いている間・マウスのボタンを押している間は開かない。
    root.pdfAPI?.onHelpRequest?.(() => openUnlessHeld(doc));
    return true;
  }

  // 開いている節の id（閉じていれば null）。起動確認の state が控える。
  function current(doc) {
    return isOpen(doc) ? state.current : null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.helpDialog = { sectionFor, show, open, close, current, handleKey, init };
})(typeof window !== 'undefined' ? window : globalThis);
