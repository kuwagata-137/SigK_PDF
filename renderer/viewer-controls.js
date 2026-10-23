(function (root) {
  'use strict';

  // ツールバーとキー操作をビューアへ結ぶ層。表示の更新（sync*）もここに集める。
  // viewer.js は「文書とページ」、ここは「操作と表示」を持つ。

  // 文書が開いていないと押せないもの。開くボタンだけは常に押せる。
  const DOCUMENT_CONTROLS = ['pager', 'zoom', 'btn-fit-width', 'btn-fit-page', 'btn-facing', 'btn-find', 'btn-print'];
  // ツールモードでは押せないもの。ツールの画面の下に隠れたページの表示に効くだけで、帯には何も起きないため（ユーザーの判断 2026-10-23。
  // docs/07 決定83）。押している印（見開き）は残す（［選択］［ハンド］と同じ。spec-2-5 確定事項K11）。
  const HIDDEN_VIEW_CONTROLS = ['pager', 'btn-fit-width', 'btn-fit-page', 'btn-facing'];

  function viewer() {
    return root.SigK.viewer;
  }

  function setEnabled(doc, id, enabled) {
    const node = doc.getElementById(id);
    if (node === null)
      return;
    if (enabled)
      node.removeAttribute('aria-disabled');
    else
      node.setAttribute('aria-disabled', 'true');
  }

  function syncPage(doc, state) {
    const input = doc.getElementById('page-current');
    const total = doc.getElementById('page-total');
    if (input !== null)
      input.value = state.open ? String(state.current + 1) : '';
    if (total !== null)
      total.textContent = state.open ? `/ ${state.pageCount}` : '/ –';
  }

  // ツールモードでは、倍率の［－］［＋］と数字は帯の紙の倍率（tools-zoom.js）に効く（docs/07 決定83）。
  const toolsZoom = (doc) => (root.SigK.toolsZoom?.isToolsMode(doc) === true ? root.SigK.toolsZoom : null);

  function syncZoom(doc, state) {
    const value = doc.getElementById('zoom-value');
    if (value !== null)
      value.textContent = root.SigK.viewerLayout.formatZoom(toolsZoom(doc)?.get() ?? state.zoom);

    for (const [id, mode] of [['btn-fit-width', 'width'], ['btn-fit-page', 'page']]) {
      const node = doc.getElementById(id);
      if (node !== null)
        node.classList.toggle('active', state.open && state.fit === mode);
    }
    // 見開きも押しっぱなしの状態を持つ（spec-2-3 確定事項1）。
    const facing = doc.getElementById('btn-facing');
    if (facing !== null)
      facing.classList.toggle('active', state.open && state.facing === true);
  }

  function syncAll(doc, state) {
    const tools = doc.documentElement.getAttribute('data-mode') === 'tools';
    for (const id of DOCUMENT_CONTROLS)
      setEnabled(doc, id, state.open && !(tools && HIDDEN_VIEW_CONTROLS.includes(id)));
    // 帯の紙の倍率は、紙が 1 枚でもあれば変えられる（「変換する画像」の帯だけのときも）。
    if (toolsZoom(doc) !== null)
      setEnabled(doc, 'zoom', toolsZoom(doc).canZoom());
    // 灰色の間はページ番号の欄にも打たせない。
    const input = doc.getElementById('page-current');
    if (input !== null)
      input.disabled = doc.getElementById('pager')?.getAttribute('aria-disabled') === 'true';
    syncPage(doc, state);
    syncZoom(doc, state);
    // ページ編集のボタン（回転・削除・元に戻す）もここで揃える。文書を開く・
    // 閉じる・タブを移る・編集する、のすべてがこの1本を通る。
    root.SigK.pageEdit?.syncActions();
  }

  function commitPageInput(doc) {
    const input = doc.getElementById('page-current');
    if (input === null)
      return;
    const state = viewer().getState();
    const index = root.SigK.viewerLayout.parsePageNumber(input.value, state.pageCount);
    // 範囲外や数字でないものは、黙って現在ページへ戻す。
    if (index === null) {
      syncPage(doc, state);
      return;
    }
    viewer().goToPage(index);
  }

  function bindClick(doc, id, handler) {
    const node = doc.getElementById(id);
    if (node === null)
      return;
    // 灰色の印は外の箱（#pager・#zoom）に付くこともあるので、祖先も見る（前は押したボタン自身しか見ず、灰色でも押せた。2026-10-23 の直し）。
    node.addEventListener('click', () => {
      if (node.closest('[aria-disabled="true"]') !== null)
        return;
      handler();
    });
  }

  function init(doc, win) {
    if (win.__sigkControlsReady === true)
      return false;
    win.__sigkControlsReady = true;

    bindClick(doc, 'btn-open', () => root.SigK.tabs.runOpenCommand());
    bindClick(doc, 'page-prev', () => viewer().prevPage());
    bindClick(doc, 'page-next', () => viewer().nextPage());
    bindClick(doc, 'zoom-in', () => (toolsZoom(doc) ?? viewer()).zoomIn());
    bindClick(doc, 'zoom-out', () => (toolsZoom(doc) ?? viewer()).zoomOut());
    bindClick(doc, 'btn-fit-width', () => viewer().applyFit('width'));
    bindClick(doc, 'btn-fit-page', () => viewer().applyFit('page'));
    // 状態の持ち主は shell.js（覚えるのもそちら。spec-2-3 確定事項3）。
    bindClick(doc, 'btn-facing', () => {
      root.SigK.shell.setPageLayout(doc, viewer().getState().facing === true ? 'single' : 'facing');
    });

    const input = doc.getElementById('page-current');
    if (input !== null) {
      input.addEventListener('change', () => commitPageInput(doc));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter')
          commitPageInput(doc);
      });
      // Esc は打ちかけを捨てて今のページの番号に戻し、欄から抜ける（ページは送らない。spec-4b-7a 確定事項E1）。
      root.SigK.fieldEscape?.bind(input, { shown: () => {
        const state = viewer().getState();
        return state.open ? String(state.current + 1) : '';
      } });
    }

    // メニューの「開く」（Ctrl+O）と「最近使ったファイル」はメイン側から届く。
    // 開く経路を1本に保つため、ここでもツールバーと同じ処理を呼ぶ。
    // パスが付いていればそれを開き、無ければダイアログを出す（tabs.runOpenCommand）。
    // 窓が開いている間は、後ろで別の文書を開かない（spec-4b-7a 点検の直し）。
    root.pdfAPI?.onOpenRequest?.((filePath) => {
      if (doc.querySelector('dialog[open]') !== null)
        return;
      root.SigK.tabs.runOpenCommand(filePath);
    });

    // キーの振り分けは viewer-keys.js（spec-4b-3a で分けた）。
    doc.addEventListener('keydown', (event) => root.SigK.viewerKeys.handleKey(event, doc));
    syncAll(doc, viewer().getState());
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.viewerControls = { DOCUMENT_CONTROLS, HIDDEN_VIEW_CONTROLS, init, syncAll, syncPage, syncZoom, commitPageInput };
})(typeof window !== 'undefined' ? window : globalThis);
