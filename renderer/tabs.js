(function (root) {
  'use strict';

  // 開いている文書の束。開く経路はここに1本だけ集める（spec-1-2 確定事項18）。
  //
  // 画面に映るのは常に1文書で、それを持っているのは viewer.js である。
  // 非アクティブなタブは session（文書・寸法・倍率・読み位置）だけを抱え、
  // canvas は持たない（確定事項1）。アクティブなタブの session は null で、
  // 実体は viewer が握っている。この非対称が分かりにくいので、出し入れは
  // stash() と restore() の2つに閉じてある。

  const MAX_TABS = 20;
  const TITLE = 'SigK PDF';

  const state = {
    list: [],
    activeId: null,
    nextId: 1,
  };

  let el = null;

  function viewer() {
    return root.SigK.viewer;
  }

  // Windows のパスは大文字小文字を区別しない。recent-documents.js と同じ規則。
  function pathKey(filePath) {
    return typeof filePath === 'string' ? filePath.replace(/\//g, '\\').toLowerCase() : null;
  }

  function find(id) {
    return state.list.find((tab) => tab.id === id) ?? null;
  }

  function indexOf(id) {
    return state.list.findIndex((tab) => tab.id === id);
  }

  function list() {
    return state.list.map((tab) => ({ id: tab.id, path: tab.path, name: tab.name, active: tab.id === state.activeId }));
  }

  // そのタブに未保存の編集があるか（spec-1-5 確定事項49）。
  //
  // 映しているタブの plan は viewer が握っており、ほかのタブのぶんは
  // session の中にある。この非対称は塊② からの作りで、ここでも同じ形になる。
  function isTabDirty(tab) {
    if (tab === null || tab === undefined)
      return false;
    if (tab.id === state.activeId)
      return root.SigK.viewer?.isDirty() === true;
    if (tab.session === null || tab.session === undefined)
      return false;
    return root.SigK.pagePlan.isDirty(tab.session.plan ?? [], tab.session.basePages?.length ?? 0);
  }

  function isDirty(id) {
    return isTabDirty(find(id));
  }

  // アクティブなタブの中身を viewer から引き取る。切り替えの前に必ず呼ぶ。
  // 直前までアクティブだった id を返す（開くのに失敗したとき元へ戻すため）。
  function stash() {
    const previous = state.activeId;
    if (previous === null)
      return null;
    const tab = find(previous);
    const session = viewer().detach();
    if (tab !== null)
      tab.session = session;
    state.activeId = null;
    return previous;
  }

  function restore(tab) {
    if (tab === null || tab === undefined)
      return false;
    state.activeId = tab.id;
    // 開けなかったタブは session を持たない。理由をもう一度出す（確定事項19）。
    if (tab.session === null) {
      viewer().setMessage(tab.error ?? viewer().EMPTY_MESSAGE);
      return false;
    }
    viewer().attach(tab.session);
    tab.session = null;
    return true;
  }

  // ---- 表示 ----

  function makeTabNode(tab) {
    const node = el.doc.createElement('div');
    const classes = ['tab'];
    if (tab.id === state.activeId)
      classes.push('active');
    if (tab.error !== null)
      classes.push('failed');
    node.className = classes.join(' ');
    node.dataset.tabId = String(tab.id);
    node.title = tab.path ?? tab.name;

    const name = el.doc.createElement('span');
    name.className = 'name';
    name.textContent = tab.name;

    const close = el.doc.createElement('span');
    close.className = 'x';
    close.title = 'このタブを閉じる';
    close.replaceChildren(root.SigK.icons.create(el.doc, 'close', { size: 11, strokeWidth: 2 }));

    // 未保存の点（確定事項49）。CSS は Phase 0 からあったが、dirty になる
    // 経路が無かったので実装は塊④ が初めてである。
    if (isTabDirty(tab)) {
      const dot = el.doc.createElement('span');
      dot.className = 'dirty';
      dot.title = '編集内容が保存されていません';
      node.replaceChildren(dot, name, close);
      return node;
    }

    node.replaceChildren(name, close);
    return node;
  }

  // タイトルバーに出す名前（確定事項14）。document.title を書き換えると
  // Electron が page-title-updated で拾うため、IPC を増やさずに済む。
  function syncTitle() {
    const tab = find(state.activeId);
    el.doc.title = tab === null ? TITLE : `${tab.name} — ${TITLE}`;
  }

  // 上限まで開くとタブバーの幅を超える（20枚 × 最小 96px = 1920px）。
  // Ctrl+Tab で画面外のタブへ移ったとき、選ばれているタブが見えないままに
  // ならないよう寄せる（spec-1-2 確定事項21）。
  function revealActive() {
    const node = el.bar.querySelector('.tab.active');
    // jsdom は scrollIntoView を実装しない。画面テストで落とさないため確かめる。
    if (node === null || typeof node.scrollIntoView !== 'function')
      return false;
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  function render() {
    if (el === null)
      return;
    const nodes = state.list.map(makeTabNode);
    // 「＋」は Phase 0 から index.html にある。並べ替えても最後に残す。
    if (el.add !== null) {
      el.add.removeAttribute('aria-disabled');
      nodes.push(el.add);
    }
    el.bar.replaceChildren(...nodes);
    revealActive();
    syncTitle();
    root.SigK.recentPanel?.sync();
  }

  // ---- 開く ----

  function messageFor(text) {
    viewer().setMessage(text);
  }

  async function rememberRecent(source) {
    const api = root.recentAPI;
    if (!api || api.available !== true || typeof source.path !== 'string')
      return;
    try {
      await api.add({ path: source.path, name: source.name, openedAt: new Date().toISOString() });
      // 一覧の控えが古いままにならないよう読み直す。次にタブを全部閉じたとき、
      // いま開いたファイルが履歴の先頭に出ていてほしい。
      await root.SigK.recentPanel?.refresh();
    } catch {
      // 履歴が残らなくても、文書は開けている。ここで止めない。
    }
  }

  async function forgetRecent(filePath) {
    const api = root.recentAPI;
    if (!api || api.available !== true || typeof filePath !== 'string')
      return;
    try {
      await api.remove(filePath);
    } catch {
      // 同上。
    }
  }

  // 読み込み結果（{ ok, path, name, size, bytes } / { error }）を1枚のタブにする。
  async function openSource(source) {
    if (source?.error !== undefined) {
      messageFor(source.error);
      return false;
    }

    // 同じファイルは2枚にしない（確定事項4）。
    const key = pathKey(source.path);
    const existing = key === null ? null : state.list.find((tab) => pathKey(tab.path) === key);
    if (existing !== null && existing !== undefined) {
      activate(existing.id);
      return true;
    }

    if (state.list.length >= MAX_TABS) {
      messageFor(`タブが多すぎます。${MAX_TABS} 個まで開けます。使わないタブを閉じてください。`);
      return false;
    }

    stash();
    const opened = await viewer().open(source);

    // 開けなくてもタブは作る（確定事項19）。ページビューには理由が出ている。
    // 作らずに前のタブへ戻すと、その理由が上書きされて消えてしまう。
    const tab = {
      id: state.nextId,
      path: source.path ?? null,
      name: source.name ?? '（名前なし）',
      session: null,
      error: opened ? null : viewer().getMessage(),
    };
    state.nextId += 1;
    state.list.push(tab);
    state.activeId = tab.id;
    render();

    // 開けなかったものは履歴に残さない。押すたびに同じ失敗を繰り返すため。
    if (opened)
      await rememberRecent(source);
    return opened;
  }

  async function openPath(filePath) {
    const api = root.pdfAPI;
    if (!api || api.available !== true) {
      messageFor('ファイルを開く機能が使えません。');
      return false;
    }

    // 開いている同じファイルなら、読み直さずに切り替える。
    const key = pathKey(filePath);
    const existing = key === null ? null : state.list.find((tab) => pathKey(tab.path) === key);
    if (existing !== null && existing !== undefined) {
      activate(existing.id);
      return true;
    }

    const result = await api.read(filePath);
    if (result?.error !== undefined) {
      // 消えた・動かされたファイルを履歴に残しても押すたびに失敗する（確定事項10）。
      await forgetRecent(filePath);
      messageFor(result.error);
      root.SigK.recentPanel?.refresh();
      return false;
    }
    return openSource(result);
  }

  async function openViaDialog() {
    const api = root.pdfAPI;
    if (!api || api.available !== true) {
      messageFor('ファイルを開く機能が使えません。');
      return false;
    }
    const result = await api.open();
    if (result?.canceled === true)
      return false;
    return openSource(result);
  }

  // ---- 切り替えと後始末 ----

  function activate(id) {
    const tab = find(id);
    if (tab === null || id === state.activeId)
      return false;
    stash();
    restore(tab);
    render();
    return true;
  }

  // 未保存があるときだけ確認を挟む（確定事項56）。
  //
  // 戻り値は boolean か Promise<boolean> になる。確認が要らない場合まで
  // 非同期にすると、塊② から続く「閉じたら次の行が同期で決まる」という
  // 呼び出し側の前提が崩れるためである。
  function closeTab(id) {
    const tab = find(id);
    if (tab === null)
      return false;
    if (!isTabDirty(tab))
      return forceCloseTab(id);

    return root.SigK.confirmDiscard
      .ask({ name: tab.name })
      .then((ok) => (ok ? forceCloseTab(id) : false));
  }

  function forceCloseTab(id) {
    const index = indexOf(id);
    if (index === -1)
      return false;

    const tab = state.list[index];
    const wasActive = tab.id === state.activeId;

    if (wasActive) {
      state.activeId = null;
      viewer().close();
    } else {
      viewer().destroySession(tab.session);
    }
    tab.session = null;
    state.list.splice(index, 1);

    // 右隣へ。右端を閉じたときは左隣（確定事項17）。
    if (wasActive && state.list.length > 0)
      restore(state.list[Math.min(index, state.list.length - 1)]);

    render();
    return true;
  }

  function closeActive() {
    return state.activeId === null ? false : closeTab(state.activeId);
  }

  function cycle(step) {
    if (state.list.length < 2)
      return false;
    const index = indexOf(state.activeId);
    if (index === -1)
      return false;
    const count = state.list.length;
    const next = ((index + step) % count + count) % count;
    return activate(state.list[next].id);
  }

  // ---- 結線 ----

  function onBarClick(event) {
    const node = event.target.closest?.('[data-tab-id]');
    if (node === null || node === undefined)
      return;
    const id = Number(node.dataset.tabId);
    if (event.target.closest('.x') !== null) {
      closeTab(id);
      return;
    }
    activate(id);
  }

  function init(doc, win) {
    if (win.__sigkTabsReady === true)
      return false;

    const bar = doc.getElementById('tabbar');
    if (bar === null)
      return false;
    win.__sigkTabsReady = true;

    el = { doc, bar, add: doc.querySelector('.tab-add') };

    bar.addEventListener('click', onBarClick);
    // 中クリックで閉じる（docs/04 第3章）。auxclick を使うのは、中ボタンが
    // click として届かないためである。
    bar.addEventListener('auxclick', (event) => {
      if (event.button !== 1)
        return;
      const node = event.target.closest?.('[data-tab-id]');
      if (node !== null && node !== undefined)
        closeTab(Number(node.dataset.tabId));
    });
    el.add?.addEventListener('click', () => openViaDialog());

    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tabs = {
    MAX_TABS,
    TITLE,
    init,
    list,
    activeId: () => state.activeId,
    count: () => state.list.length,
    openSource,
    openPath,
    openViaDialog,
    activate,
    closeTab,
    forceCloseTab,
    isDirty,
    closeActive,
    cycle,
    render,
    revealActive,
  };
})(typeof window !== 'undefined' ? window : globalThis);
