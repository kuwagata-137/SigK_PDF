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
  // 時点では結合を選んだ状態にする（確定事項1・3）。設定の窓で「最後に使ったツールを覚える」にしていれば、
  // 起動したときに最後に使ったツールを選んでおく（spec-6-1 確定事項E-8。tool-memory.js）。
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

  // ツールごとの画面の描き直しの入口（render）。
  const VIEWS = {
    merge: 'toolsMergeList', split: 'toolsSplitView', convert: 'toolsConvertView',
    toImage: 'toolsToImageView', watermark: 'toolsWatermarkView', flatten: 'toolsFlattenView',
  };

  const state = { selected: 'merge' };
  let el = null;

  function isToolsMode() {
    return el !== null && el.doc.documentElement.getAttribute('data-mode') === 'tools';
  }

  // そのツールの設定の器（右の欄の節。spec-2-5 第 E 章）。2026-10-15 に画像→PDF も右の欄へ移り、前の画面（.tool-panel）は無くなった。
  function panelFor(id) {
    return root.SigK.toolPane?.sectionFor(id) ?? null;
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

  // remember: false は、モードが変わったときに今のツールを出し直すだけの呼び出し（refresh）。ユーザーが選んだとは数えない
  // （起動したときに最後に使ったツールを選んでおく妨げにしない。点検の直し M-2）。
  function select(id, { remember = true } = {}) {
    if (el === null || !TOOLS.some((tool) => tool.id === id))
      return false;
    state.selected = id;
    // 最後に使ったツールとして覚える（spec-6-1 確定事項E-8）。
    if (remember)
      root.SigK.toolMemory?.toolSelected(id);
    // 右の欄の「フォルダ」が無くなったフォルダを指したままにならないように、フォルダが今あるかを聞き直す（点検の直し I-6）。
    root.SigK.preferences?.refresh();
    for (const item of el.list.querySelectorAll('.tool-item'))
      item.classList.toggle('active', item.dataset.tool === id);
    // 真ん中に帯・右の欄に設定を出す（spec-2-5 第 D・E 章）。
    root.SigK.toolPane?.show(isToolsMode() ? id : null);
    // 隠れている間に、ほかの処理が走り始めたり終わったりしていることがある。見せるときに描き直す。
    renderShown();
    return true;
  }

  function renderList() {
    el.list.replaceChildren();
    for (const tool of TOOLS) {
      const item = el.doc.createElement('div');
      item.className = 'tool-item';
      item.dataset.tool = tool.id;
      item.dataset.tip = `tools.${tool.id}`;
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
      select(state.selected, { remember: false });
    else
      root.SigK.toolPane?.show(null);
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
    // 最初のフォルダが替わりうるとき（設定の窓の［OK］・最後に書き出したフォルダ・フォルダが無くなった）に、右の欄の「フォルダ」を描き直す。
    root.SigK.preferences?.subscribe(() => renderShown());
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tools = { TOOLS, init, refresh, select, isToolsMode, selected: () => state.selected, panelFor, renderShown };
})(typeof window !== 'undefined' ? window : globalThis);
