(function (root) {
  'use strict';

  // ツールモードの枠組み（spec-2-1 確定事項1〜7）。
  //
  // サイドパネルにツールの一覧を出し、選んだツールの作業画面を `#view-wrap` の
  // **上に重ねて**出す。ページビュー（`#view`）は隠すだけで捨てない。ツールモードを
  // 抜ければ、開いていた文書がそのまま見える（確定事項2）。
  //
  // 一覧に載せるのは動くツールだけである。塊① の結合、塊② の分割（spec-2-2
  // 確定事項39）、塊④ の画像→PDF（spec-3-1 確定事項34）、塊⑥ の PDF→画像
  // （spec-3-3 確定事項28）、Phase 4 塊⑤ の透かしとフラット化（spec-4-5 確定事項1）。ツールモードに入った
  // 時点では結合を選んだ状態にする（確定事項1・3。最後に使ったツールは覚えない。
  // 覚えるかどうかは Phase 6 の設定画面で決める）。
  //
  // 文書を開いていなくてもツールモードには入れる（確定事項7）。結合も分割も変換も
  // 開いている文書を必要としない。

  const TOOLS = [
    { id: 'merge', label: '結合', hint: '複数の PDF を1つに', icon: 'merge' },
    { id: 'split', label: '分割', hint: '1つの PDF を複数に', icon: 'split' },
    { id: 'convert', label: '画像→PDF', hint: '画像を PDF に', icon: 'convert' },
    { id: 'toImage', label: 'PDF→画像', hint: 'PDF のページを画像に', icon: 'toImage' },
    { id: 'watermark', label: '透かし', hint: '文字や画像を重ねる', icon: 'watermark' },
    { id: 'flatten', label: 'フラット化', hint: '書き込みを焼き込む', icon: 'flatten' },
  ];

  // ツールごとの画面の描き直しの入口（render）。画像→PDF の［実行…］は欄の側（tools-convert-view.js）も合わせるので、
  // 一覧（tools-convert-list.js）までは描き直さない。
  const VIEWS = {
    merge: 'toolsMergeList', split: 'toolsSplitView', convert: 'toolsConvertView',
    toImage: 'toolsToImageView', watermark: 'toolsWatermarkView', flatten: 'toolsFlattenView',
  };

  const state = { selected: 'merge' };
  let el = null;

  function isToolsMode() {
    return el !== null && el.doc.documentElement.getAttribute('data-mode') === 'tools';
  }

  function panelFor(id) {
    return el?.view.querySelector(`[data-tool="${id}"]`) ?? null;
  }

  // 見えているツールの画面を描き直す（計画外の直し）。［実行…］が押せるかは、各ツールの canRun() が
  // ほかの処理が走っているか（save.isBusy）も見て決める。ほかの処理の走り始めと終わりに save.js の syncButtons から
  // 呼ばれる。描き直さないと、走っている間に描いた「押せない」が、終わっても残る。
  function renderShown() {
    if (!isToolsMode())
      return false;
    root.SigK[VIEWS[state.selected]]?.render();
    return true;
  }

  function select(id) {
    if (el === null || !TOOLS.some((tool) => tool.id === id))
      return false;
    state.selected = id;
    // ［開いているタブから選ぶ ▾］の一覧は、ツールを切り替えたら閉じる（spec-2-2b 確定事項F6）。
    root.SigK.tabMenu?.close();
    // 分割の盤は、見えている間だけ PDF を開いておく（spec-2-2b 確定事項D5）。
    root.SigK.splitReload?.setShown(isToolsMode() && id === 'split');
    for (const item of el.list.querySelectorAll('.tool-item'))
      item.classList.toggle('active', item.dataset.tool === id);
    for (const panel of el.view.querySelectorAll('[data-tool]'))
      panel.hidden = panel.dataset.tool !== id;
    // 隠れている間に、ほかの処理が走り始めたり終わったりしていることがある。見せるときに描き直す。
    // 分割は、盤の PDF を開き直してから splitReload が描き直すので、ここでは描かない。
    if (id !== 'split')
      renderShown();
    return true;
  }

  function renderList() {
    el.list.replaceChildren();
    for (const tool of TOOLS) {
      const item = el.doc.createElement('div');
      item.className = 'tool-item';
      item.dataset.tool = tool.id;
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      if (root.SigK.icons?.has(tool.icon))
        item.append(root.SigK.icons.create(el.doc, tool.icon, { size: 16 }));
      const label = el.doc.createElement('span');
      label.textContent = tool.label;
      const hint = el.doc.createElement('span');
      hint.className = 'desc';
      hint.textContent = tool.hint;
      item.append(label, hint);
      item.addEventListener('click', () => select(tool.id));
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select(tool.id);
        }
      });
      el.list.append(item);
    }
  }

  // モードが変わるたびに shell.js から呼ばれる。ツールモードなら一覧と作業画面を
  // 出し、それ以外なら両方を隠す。
  function refresh() {
    if (el === null)
      return false;
    const active = isToolsMode();
    el.list.hidden = !active;
    el.view.hidden = !active;
    // サイドパネルはツール一覧が使う。「文書を開くと…」の案内は、ツールモードと、編集モードで注釈一覧を
    // 選んでいるとき（spec-4b-1a 確定事項16）は出さず、それ以外はサムネイルが無ければ戻す。
    const placeholder = el.doc.getElementById('thumbs-empty');
    const html = el.doc.documentElement;
    const listShown = html.getAttribute('data-mode') === 'annot' && html.getAttribute('data-edit-side') === 'list';
    if (placeholder !== null)
      placeholder.hidden = active || listShown || el.doc.getElementById('thumbs')?.hidden === false;
    if (active)
      select(state.selected);
    else {
      root.SigK.tabMenu?.close();
      root.SigK.splitReload?.setShown(false);
    }
    root.SigK.save?.syncButtons();
    return active;
  }

  function init(doc, win) {
    if (win.__sigkToolsReady === true)
      return false;
    const list = doc.getElementById('tools-list');
    const view = doc.getElementById('tools-view');
    if (list === null || view === null)
      return false;
    win.__sigkToolsReady = true;

    el = { doc, win, list, view };
    renderList();
    refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tools = { TOOLS, init, refresh, select, isToolsMode, selected: () => state.selected, panelFor, renderShown };
})(typeof window !== 'undefined' ? window : globalThis);
