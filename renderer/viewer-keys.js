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
  // 下の isTextField による打ち切りより前で捌く。F3 は検索バー自身の
  // 入力欄から押されるので、奪わないと届かない。Esc は escape-order.js が持つ。
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
    return false;
  }

  // 元に戻す・やり直しのキー。Ctrl+Z は元に戻す、Ctrl+Y と Ctrl+Shift+Z はやり直し（CheckListMaker の画像エディタと同じ）。
  // Shift を見ずに Ctrl+Shift+Z を元に戻すにしていた（計画外の直し⑤）。ほかのキーは null。
  function historyStep(event) {
    if (!event.ctrlKey || event.altKey)
      return null;
    const key = String(event.key ?? '').toLowerCase();
    if (key === 'y')
      return 'redo';
    if (key === 'z')
      return event.shiftKey ? 'redo' : 'undo';
    return null;
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
    const step = historyStep(event);
    if (step !== null) {
      event.preventDefault();
      edit[step]();
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
    return handleAnnotKey(event, doc);
  }

  // 注釈モードの Delete（spec-4-1 確定事項7）。Delete は選んだ注釈を消す。Backspace も Delete と同じく選んだ全部を消す
  // （spec-4b-3a 確定事項H1）。Esc は escape-order.js が持つ。
  // 70 行になった handlePageEditKey から分けた（spec-4b-6a の点検 8。中身は変えていない）。
  function handleAnnotKey(event, doc) {
    const annotate = root.SigK.annotate;
    if (annotate === undefined || doc.documentElement.getAttribute('data-mode') !== 'annot')
      return false;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      annotate.remove();
      return true;
    }
    // トリミングの枠があれば、Enter で切る（spec-4b-6a 確定事項14・26）。選んでいるテキストを直すより先に見る。
    // ボタン（右パネルの［取消］など）にフォーカスがあるときは、そのボタンを押す Enter なので奪わない（点検 2）。
    const onButton = (event.target?.closest?.('button') ?? null) !== null;
    if (event.key === 'Enter' && !onButton && root.SigK.annotateTrim?.hasFrame() === true) {
      event.preventDefault();
      return root.SigK.trimTool.apply();
    }
    // 選んでいるテキストは Enter で直せる（spec-4-2 確定事項5）。
    if (event.key === 'Enter' && annotate.editSelected()) {
      event.preventDefault();
      return true;
    }
    return false;
  }

  function handleKey(event, doc) {
    // 窓（確認・パスワード・文書情報・印刷）が開いている間は、どのキーも下の画面に届けない。Esc は窓が自分で取りやめる
    // （spec-4b-7a 確定事項B）。
    if (doc.querySelector('dialog[open]') !== null)
      return;
    // Esc の順は escape-order.js（spec-4b-7a 確定事項A）。文書が開いていなくても、欄の Esc と道具を外すのは効かせる（点検の直し）。
    if (event.key === 'Escape') {
      root.SigK.escapeOrder.handle(event, doc);
      return;
    }
    if (handleTabKey(event))
      return;
    if (viewer().getState().open !== true)
      return;
    if (handleFindPrintKey(event))
      return;
    // テキストの入力欄と右パネルの欄（「本文」「作成者」・太さと不透明度のスライダーと数値欄）、色のパレットの窓の中のキーは
    // 欄のもの（spec-4-2 確定事項8、spec-4-4 確定事項4、spec-4b-1b 確定事項6・7）。Ctrl+Z は素の取り消し、Delete・
    // PageUp 等も奪わない。Ctrl+Enter は欄自身が確定に使う。
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
