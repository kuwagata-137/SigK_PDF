(function (root) {
  'use strict';

  // キーボードの操作（タブ・検索と印刷・ページ編集・注釈・倍率・ページ送り。spec-1-2 確定事項15・19、spec-1-4 確定事項25・38、
  // spec-1-5 確定事項54・55、spec-4-1 確定事項7、spec-4-2 確定事項5・8、spec-4-4 確定事項4、spec-4b-1b 確定事項6・7）。
  //
  // 300 行に近づいた viewer-controls.js から移した（spec-4b-3a。中身は変えていない）。結線は viewer-controls.js の init が持つ。

  function viewer() {
    return root.SigK.viewer;
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

    // 注釈モードの Delete と Esc（spec-4-1 確定事項7）。Delete は選んだ注釈を消し、
    // Esc は選択を解除、無ければ道具を離す。
    const annotate = root.SigK.annotate;
    const inAnnotMode = doc.documentElement.getAttribute('data-mode') === 'annot';
    if (event.key === 'Delete' && inAnnotMode && annotate !== undefined) {
      event.preventDefault();
      annotate.remove();
      return true;
    }
    if (event.key === 'Escape' && inAnnotMode && annotate !== undefined)
      return annotate.escape();
    // 選んでいるテキストは Enter で直せる（spec-4-2 確定事項5）。
    if (event.key === 'Enter' && inAnnotMode && annotate !== undefined && annotate.editSelected()) {
      event.preventDefault();
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
    // テキストの入力欄と右パネルの欄（「本文」「作成者」・太さと不透明度のスライダーと数値欄）、色のパレットの窓の中のキーは
    // 欄のもの（spec-4-2 確定事項8、spec-4-4 確定事項4、spec-4b-1b 確定事項6・7）。Ctrl+Z は素の取り消し、Delete・Esc・
    // PageUp 等も奪わない。Esc と Ctrl+Enter は欄自身が確定に使い、パレットの窓は Esc で自分を閉じる。
    if (event.target?.closest?.('.free-text-editor, .props-field, .color-pop'))
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

  const SigK = (root.SigK = root.SigK || {});
  SigK.viewerKeys = { handleKey };
})(typeof window !== 'undefined' ? window : globalThis);
