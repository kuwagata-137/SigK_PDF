(function (root) {
  'use strict';

  // 最近使ったファイルの一覧（F-06-3・spec-1-2 確定事項9）。
  // 文書が1つも開いていないときだけ、ページビューの空きに出す。
  // アプリメニュー側の一覧はメイン側が組む。実体はどちらも settings.json にある。
  //
  // 存在確認はしない（確定事項10）。ネットワークドライブ上のパスで固まるためで、
  // 消えていることは押した時点で分かればよい。

  const state = { entries: [], loaded: false };

  let el = null;

  function makeItem(entry) {
    const node = el.doc.createElement('button');
    node.type = 'button';
    node.className = 'recent-item';
    node.dataset.path = entry.path;
    node.title = entry.path;

    const name = el.doc.createElement('span');
    name.className = 'recent-name';
    name.textContent = entry.name;

    const where = el.doc.createElement('span');
    where.className = 'recent-path';
    where.textContent = entry.path;

    node.replaceChildren(name, where);
    return node;
  }

  function draw() {
    if (el === null)
      return;

    if (state.entries.length === 0) {
      el.list.replaceChildren();
      el.list.hidden = true;
      return;
    }

    const head = el.doc.createElement('p');
    head.className = 'recent-head';
    head.textContent = '最近使ったファイル';
    el.list.replaceChildren(head, ...state.entries.map(makeItem));
    el.list.hidden = false;
  }

  // タブが1枚でもあれば隠す。開いている文書の裏に履歴が透けるのは邪魔である。
  function sync() {
    if (el === null)
      return;
    const busy = (root.SigK.tabs?.count() ?? 0) > 0;
    if (busy) {
      el.list.hidden = true;
      return;
    }
    draw();
  }

  async function refresh() {
    const api = root.recentAPI;
    if (!api || api.available !== true) {
      state.entries = [];
      state.loaded = true;
      sync();
      return state.entries;
    }

    try {
      const result = await api.list();
      state.entries = Array.isArray(result?.recent) ? result.recent : [];
    } catch {
      // 履歴が読めなくても、開く手段はダイアログとドロップが残っている。
      state.entries = [];
    }
    state.loaded = true;
    sync();
    return state.entries;
  }

  function onClick(event) {
    const node = event.target.closest?.('[data-path]');
    if (node === null || node === undefined)
      return;
    root.SigK.tabs.openPath(node.dataset.path);
  }

  function init(doc, win) {
    if (win.__sigkRecentReady === true)
      return false;

    const list = doc.getElementById('view-recent');
    if (list === null)
      return false;
    win.__sigkRecentReady = true;

    el = { doc, list };
    list.addEventListener('click', onClick);
    refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.recentPanel = { init, refresh, sync, entries: () => state.entries };
})(typeof window !== 'undefined' ? window : globalThis);
