(function (root) {
  'use strict';

  // ツールバーとキー操作をビューアへ結ぶ層。表示の更新（sync*）もここに集める。
  // viewer.js は「文書とページ」、ここは「操作と表示」を持つ。

  // 文書が開いていないと押せないもの。開くボタンだけは常に押せる。
  const DOCUMENT_CONTROLS = ['pager', 'zoom', 'btn-fit-width', 'btn-fit-page'];

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

  function syncZoom(doc, state) {
    const value = doc.getElementById('zoom-value');
    if (value !== null)
      value.textContent = root.SigK.viewerLayout.formatZoom(state.zoom);

    for (const [id, mode] of [['btn-fit-width', 'width'], ['btn-fit-page', 'page']]) {
      const node = doc.getElementById(id);
      if (node !== null)
        node.classList.toggle('active', state.open && state.fit === mode);
    }
  }

  function syncAll(doc, state) {
    for (const id of DOCUMENT_CONTROLS)
      setEnabled(doc, id, state.open);
    syncPage(doc, state);
    syncZoom(doc, state);
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
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') === 'true')
        return;
      handler();
    });
  }

  function isTextField(node) {
    const name = node?.tagName;
    return name === 'INPUT' || name === 'TEXTAREA';
  }

  const ZOOM_KEYS = {
    '+': () => viewer().zoomIn(),
    '=': () => viewer().zoomIn(),
    '-': () => viewer().zoomOut(),
    0: () => viewer().actualSize(),
  };

  const PAGE_KEYS = {
    Home: () => viewer().firstPage(),
    End: () => viewer().lastPage(),
    PageDown: () => viewer().nextPage(),
    PageUp: () => viewer().prevPage(),
  };

  function handleKey(event) {
    if (viewer().getState().open !== true)
      return;

    if (event.ctrlKey && ZOOM_KEYS[event.key] !== undefined) {
      event.preventDefault();
      ZOOM_KEYS[event.key]();
      return;
    }
    // 入力欄で End を押したら文末へ動くのが当たり前である。奪わない。
    if (isTextField(event.target) || event.ctrlKey || event.altKey)
      return;
    if (PAGE_KEYS[event.key] !== undefined) {
      event.preventDefault();
      PAGE_KEYS[event.key]();
    }
  }

  function init(doc, win) {
    if (win.__sigkControlsReady === true)
      return false;
    win.__sigkControlsReady = true;

    bindClick(doc, 'btn-open', () => viewer().openViaDialog());
    bindClick(doc, 'page-prev', () => viewer().prevPage());
    bindClick(doc, 'page-next', () => viewer().nextPage());
    bindClick(doc, 'zoom-in', () => viewer().zoomIn());
    bindClick(doc, 'zoom-out', () => viewer().zoomOut());
    bindClick(doc, 'btn-fit-width', () => viewer().applyFit('width'));
    bindClick(doc, 'btn-fit-page', () => viewer().applyFit('page'));

    const input = doc.getElementById('page-current');
    if (input !== null) {
      input.addEventListener('change', () => commitPageInput(doc));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter')
          commitPageInput(doc);
      });
    }

    // メニューの「開く」（Ctrl+O）はメイン側から届く。開く経路を1本に保つため、
    // ここでもツールバーと同じ処理を呼ぶ。
    root.pdfAPI?.onOpenRequest?.(() => viewer().openViaDialog());

    doc.addEventListener('keydown', handleKey);
    syncAll(doc, viewer().getState());
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.viewerControls = { DOCUMENT_CONTROLS, init, syncAll, syncPage, syncZoom, commitPageInput };
})(typeof window !== 'undefined' ? window : globalThis);
