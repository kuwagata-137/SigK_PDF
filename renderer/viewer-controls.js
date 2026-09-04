(function (root) {
  'use strict';

  // ツールバーとキー操作をビューアへ結ぶ層。表示の更新（sync*）もここに集める。
  // viewer.js は「文書とページ」、ここは「操作と表示」を持つ。

  // 文書が開いていないと押せないもの。開くボタンだけは常に押せる。
  const DOCUMENT_CONTROLS = ['pager', 'zoom', 'btn-fit-width', 'btn-fit-page', 'btn-facing', 'btn-find', 'btn-print'];

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
    // 見開きも押しっぱなしの状態を持つ（spec-2-3 確定事項1）。
    const facing = doc.getElementById('btn-facing');
    if (facing !== null)
      facing.classList.toggle('active', state.open && state.facing === true);
  }

  function syncAll(doc, state) {
    for (const id of DOCUMENT_CONTROLS)
      setEnabled(doc, id, state.open);
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

  // タブの操作は文書が開いているかによらず受ける。開けなかったタブも
  // Ctrl+W で閉じられる必要がある（spec-1-2 確定事項15・19）。
  function handleTabKey(event) {
    const tabs = root.SigK.tabs;
    if (tabs === undefined || !event.ctrlKey)
      return false;

    if (event.key === 'Tab') {
      event.preventDefault();
      tabs.cycle(event.shiftKey ? -1 : 1);
      return true;
    }
    if (event.key === 'w' || event.key === 'W') {
      event.preventDefault();
      tabs.closeActive();
      return true;
    }
    return false;
  }

  // 検索と印刷（spec-1-4 確定事項25・38）。入力欄の中でも効かせるため、
  // 下の isTextField による打ち切りより前で捌く。F3 と Esc は検索バー自身の
  // 入力欄から押されるので、奪わないと届かない。
  function handleFindPrintKey(event) {
    const findBar = root.SigK.findBar;

    if (event.ctrlKey && !event.altKey && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault();
      findBar?.open();
      return true;
    }
    if (event.ctrlKey && !event.altKey && (event.key === 'p' || event.key === 'P')) {
      event.preventDefault();
      root.SigK.print?.open();
      return true;
    }
    // F3 / Shift+F3 は検索バーが閉じていても効く。開いてから移動する。
    if (event.key === 'F3') {
      event.preventDefault();
      findBar?.step(event.shiftKey ? -1 : 1);
      return true;
    }
    if (event.key === 'Escape' && findBar?.isOpen() === true) {
      event.preventDefault();
      findBar.close();
      return true;
    }
    return false;
  }

  // ページ編集のキー（spec-1-5 確定事項54・55）。handleKey の下のほうは
  // event.ctrlKey で早期 return するため、塊③-b の handleFindPrintKey と同じく
  // その手前で捌く。
  function handlePageEditKey(event, doc) {
    const edit = root.SigK.pageEdit;
    const grid = root.SigK.pageGrid;
    if (edit === undefined)
      return false;

    // 元に戻す・やり直しはどのモードでも効かせる（確定事項55）。編集したまま
    // 閲覧モードへ戻っていることがある。
    if (event.ctrlKey && !event.altKey && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      edit.undo();
      return true;
    }
    if (event.ctrlKey && !event.altKey && (event.key === 'y' || event.key === 'Y')) {
      event.preventDefault();
      edit.redo();
      return true;
    }

    const inPagesMode = doc.documentElement.getAttribute('data-mode') === 'pages';

    // Ctrl+A はページモードで、かつサイドパネルにフォーカスがあるときだけ
    // 奪う（確定事項18）。奪いすぎると閲覧モードで文字を選べなくなる。
    if (event.ctrlKey && !event.altKey && (event.key === 'a' || event.key === 'A')) {
      if (!inPagesMode || doc.getElementById('side')?.contains(doc.activeElement) !== true)
        return false;
      event.preventDefault();
      grid?.selectAll();
      return true;
    }

    if (isTextField(event.target))
      return false;

    // Delete はページモードでだけ効かせる（確定事項55）。
    if (event.key === 'Delete' && inPagesMode) {
      event.preventDefault();
      edit.remove();
      return true;
    }
    // Esc は選択の解除。検索バーが開いていればそちらが先に閉じており、
    // ここへは届かない（確定事項19 の優先順位）。
    if (event.key === 'Escape' && inPagesMode) {
      grid?.clearSelection();
      return true;
    }
    return false;
  }

  function handleKey(event, doc) {
    if (handleTabKey(event))
      return;
    if (viewer().getState().open !== true)
      return;
    if (handleFindPrintKey(event))
      return;
    if (handlePageEditKey(event, doc))
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

    bindClick(doc, 'btn-open', () => root.SigK.tabs.openViaDialog());
    bindClick(doc, 'page-prev', () => viewer().prevPage());
    bindClick(doc, 'page-next', () => viewer().nextPage());
    bindClick(doc, 'zoom-in', () => viewer().zoomIn());
    bindClick(doc, 'zoom-out', () => viewer().zoomOut());
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
    }

    // メニューの「開く」（Ctrl+O）と「最近使ったファイル」はメイン側から届く。
    // 開く経路を1本に保つため、ここでもツールバーと同じ処理を呼ぶ。
    // パスが付いていればそれを開き、無ければダイアログを出す。
    root.pdfAPI?.onOpenRequest?.((filePath) => {
      if (typeof filePath === 'string' && filePath.length > 0)
        root.SigK.tabs.openPath(filePath);
      else
        root.SigK.tabs.openViaDialog();
    });

    doc.addEventListener('keydown', (event) => handleKey(event, doc));
    syncAll(doc, viewer().getState());
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.viewerControls = { DOCUMENT_CONTROLS, init, syncAll, syncPage, syncZoom, commitPageInput };
})(typeof window !== 'undefined' ? window : globalThis);
