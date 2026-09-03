(function (root) {
  'use strict';

  // ツールモードの枠組み（spec-2-1 確定事項1〜7）。
  //
  // サイドパネルにツールの一覧を出し、選んだツールの作業画面を `#view-wrap` の
  // **上に重ねて**出す。ページビュー（`#view`）は隠すだけで捨てない。ツールモードを
  // 抜ければ、開いていた文書がそのまま見える（確定事項2）。
  //
  // 一覧に載せるのは動くツールだけである。塊① では「結合」の1つしか無いので、
  // ツールモードに入った時点で結合を選んだ状態にする（確定事項1・3）。変換・透かしは
  // それを作るフェーズで足す。
  //
  // 文書を開いていなくてもツールモードには入れる（確定事項7）。結合は開いている
  // 文書を必要としない。

  const TOOLS = [
    { id: 'merge', label: '結合', hint: '複数の PDF を1つに', icon: 'merge' },
  ];

  const state = { selected: 'merge' };
  let el = null;

  function isToolsMode() {
    return el !== null && el.doc.documentElement.getAttribute('data-mode') === 'tools';
  }

  function panelFor(id) {
    return el?.view.querySelector(`[data-tool="${id}"]`) ?? null;
  }

  function select(id) {
    if (el === null || !TOOLS.some((tool) => tool.id === id))
      return false;
    state.selected = id;
    for (const item of el.list.querySelectorAll('.tool-item'))
      item.classList.toggle('active', item.dataset.tool === id);
    for (const panel of el.view.querySelectorAll('[data-tool]'))
      panel.hidden = panel.dataset.tool !== id;
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
    // サイドパネルはツール一覧が使う。「文書を開くと…」の案内は、ツールモードでは
    // 出さず、抜けたときはサムネイルが無ければ戻す。
    const placeholder = el.doc.getElementById('thumbs-empty');
    if (placeholder !== null)
      placeholder.hidden = active || el.doc.getElementById('thumbs')?.hidden === false;
    if (active)
      select(state.selected);
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
  SigK.tools = { TOOLS, init, refresh, select, isToolsMode, selected: () => state.selected, panelFor };
})(typeof window !== 'undefined' ? window : globalThis);
