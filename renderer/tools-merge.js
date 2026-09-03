(function (root) {
  'use strict';

  // 結合画面の状態と指揮（spec-2-1 確定事項8〜25・35〜40）。
  //
  // 一覧の行を持ち、足す・並べ替える・範囲を検証する・実行する、を受け持つ。
  // 描画と行のドラッグは tools-merge-list.js にある。実際に書くのはワーカーで、
  // 走らせるのは save.js の runTask（進捗の帯・中止・二重起動の防止を1か所に持つ）。
  //
  // 結合はファイルを読み直して組むので、画面上の並べ替え・回転・削除は結果に
  // 映らない（確定事項11）。未保存のタブを足すことは止めず、注意だけ出す。

  const MAX_INPUTS = 100;
  const NOTE_UNSAVED = '未保存の編集は反映されません';
  const NOTE_LAUNCH_ORDER = null;   // 右クリック起動の並び順の注記。文言は Phase 5（確定事項17）。

  const state = { rows: [], seq: 0, running: false, launchNote: false };
  let el = null;

  const banner = () => root.SigK.viewBanner;
  const tabs = () => root.SigK.tabs;
  const list = () => root.SigK.toolsMergeList;

  function pathKey(filePath) {
    return typeof filePath === 'string' ? filePath.replace(/\//g, '\\').toLowerCase() : null;
  }

  function baseName(filePath) {
    return String(filePath ?? '').split(/[\\/]/).pop();
  }

  function rows() {
    return state.rows.map((row) => ({ ...row }));
  }

  function find(id) {
    return state.rows.find((row) => row.id === id) ?? null;
  }

  // ---- ページ数を読む（確定事項14） ----

  // pdf.js で numPages だけ読む。パスワード付きは聞かずに断る（password-prompt.js は
  // 通さない）。読めたら文書はすぐ手放す。
  async function inspect(filePath) {
    const api = root.pdfAPI;
    if (api?.available !== true || root.SigK.pdfjs?.available !== true)
      return { error: 'PDF を読む機能を使えません' };
    const read = await api.read(filePath);
    if (read?.error !== undefined)
      return { error: read.error };

    const task = root.SigK.pdfjs.getDocument({ data: read.bytes });
    let encrypted = false;
    task.onPassword = (update) => {
      encrypted = true;
      update(new Error('パスワード付きの PDF は結合できません'));
    };
    try {
      const doc = await task.promise;
      const pageCount = doc.numPages;
      doc.destroy?.();
      return { pageCount, name: read.name ?? baseName(filePath) };
    } catch {
      return { error: encrypted ? '保存できない PDF です（パスワード付き）。外してください' : 'この PDF を開けません。外してください' };
    }
  }

  // ---- 足す・外す・並べ替える ----

  async function addPaths(paths, { dirty = () => false } = {}) {
    const incoming = (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');
    const room = MAX_INPUTS - state.rows.length;
    if (incoming.length > room) {
      banner().show(`結合できるのは ${MAX_INPUTS} ファイルまでです。`);
      if (room <= 0)
        return [];
    }
    const added = [];
    for (const filePath of incoming.slice(0, Math.max(0, room))) {
      state.seq += 1;
      const row = {
        id: `merge-${state.seq}`,
        path: filePath,
        name: baseName(filePath),
        pageCount: null,
        range: '',
        pages: null,
        error: null,
        blocked: null,
        note: dirty(filePath) === true ? NOTE_UNSAVED : null,
        pending: true,
      };
      state.rows.push(row);
      added.push(row);
    }
    list()?.render();

    await Promise.all(added.map(async (row) => {
      const info = await inspect(row.path);
      row.pending = false;
      if (info.error !== undefined)
        row.blocked = info.error;
      else {
        row.pageCount = info.pageCount;
        row.name = info.name;
      }
      list()?.syncRow(row.id);
    }));
    list()?.render();
    return added.map((row) => row.id);
  }

  // 開いているタブを、まだ一覧に無いものだけ末尾へ足す（確定事項10・11）。
  async function addOpenTabs() {
    const open = tabs()?.list() ?? [];
    const present = new Set(state.rows.map((row) => pathKey(row.path)));
    const fresh = open.filter((tab) => typeof tab.path === 'string' && !present.has(pathKey(tab.path)));
    if (open.length === 0) {
      banner().show('開いているファイルがありません。');
      return [];
    }
    if (fresh.length === 0) {
      banner().show('開いているファイルはすべて一覧に入っています。');
      return [];
    }
    const dirtyIds = new Set(fresh.filter((tab) => tabs().isDirty(tab.id)).map((tab) => pathKey(tab.path)));
    const ids = await addPaths(fresh.map((tab) => tab.path), { dirty: (filePath) => dirtyIds.has(pathKey(filePath)) });
    if (dirtyIds.size > 0)
      banner().show('未保存の編集は結合に反映されません。保存してから結合し直してください。');
    return ids;
  }

  async function pickFiles() {
    const api = root.pdfAPI;
    if (api?.available !== true || typeof api.pickMergeSources !== 'function')
      return [];
    const picked = await api.pickMergeSources({ defaultPath: state.rows[0]?.path });
    if (picked?.canceled === true || !Array.isArray(picked?.paths))
      return [];
    return addPaths(picked.paths);
  }

  // `--merge` の受け口（確定事項39）。塊① では呼ぶ側を作らない。
  async function addFromLaunch(paths) {
    root.SigK.shell.setMode(el.doc, 'tools');
    root.SigK.tools.select('merge');
    state.launchNote = true;
    const ids = await addPaths(paths);
    if (NOTE_LAUNCH_ORDER !== null)
      banner().show(NOTE_LAUNCH_ORDER);
    return ids;
  }

  function setRange(id, text) {
    const row = find(id);
    if (row === null)
      return false;
    row.range = String(text ?? '');
    row.error = null;
    row.pages = null;
    if (row.pageCount !== null) {
      const parsed = root.SigK.pageRange.parsePageRange(row.range, row.pageCount);
      if (parsed.error !== undefined)
        row.error = parsed.error;
      else if (row.range.trim() !== '')
        row.pages = parsed.pages;
    }
    list()?.syncRow(id);
    return true;
  }

  function moveTo(id, at) {
    const from = state.rows.findIndex((row) => row.id === id);
    if (from < 0 || !Number.isInteger(at))
      return false;
    const target = Math.min(Math.max(at, 0), state.rows.length);
    // at は「取り除く前」の挿入位置。取り除いたぶんだけ詰める。
    const to = target > from ? target - 1 : target;
    if (to === from)
      return false;
    const [row] = state.rows.splice(from, 1);
    state.rows.splice(to, 0, row);
    list()?.render();
    return true;
  }

  function move(id, delta) {
    const from = state.rows.findIndex((row) => row.id === id);
    if (from < 0)
      return false;
    const to = from + delta;
    if (to < 0 || to >= state.rows.length)
      return false;
    return moveTo(id, delta > 0 ? to + 1 : to);
  }

  function remove(id) {
    const from = state.rows.findIndex((row) => row.id === id);
    if (from < 0)
      return false;
    state.rows.splice(from, 1);
    list()?.render();
    return true;
  }

  function clear() {
    state.rows = [];
    list()?.render();
    return true;
  }

  // ---- 実行（確定事項21〜25・35〜38） ----

  function canRun() {
    return !state.running
      && root.SigK.save?.isBusy() !== true
      && state.rows.length > 0
      && state.rows.every((row) => !row.pending && row.blocked === null && row.error === null);
  }

  function outputPages() {
    return state.rows.reduce((sum, row) => sum + (row.pages?.length ?? row.pageCount ?? 0), 0);
  }

  function defaultTargetFor(filePath) {
    if (typeof filePath !== 'string' || filePath === '')
      return undefined;
    return `${filePath.replace(/\.pdf$/i, '')}_結合.pdf`;
  }

  // 出力先に同名があれば3択を出す（確定事項26〜28）。塊① の結合は OS の保存
  // ダイアログが同名を確認するので通らない経路だが、塊② がそのまま使う。
  // 戻り値は { path } / { canceled }。
  async function resolveTarget(target, { name = baseName(target) } = {}) {
    const api = root.pdfAPI;
    if (typeof api?.exists !== 'function')
      return { path: target };
    const found = await api.exists(target);
    if (found?.exists !== true)
      return { path: target };

    const answer = await root.SigK.confirmReplace.ask({ name });
    if (answer === root.SigK.confirmReplace.REPLACE)
      return { path: target };
    if (answer !== root.SigK.confirmReplace.RENAME)
      return { canceled: true };
    const picked = await api.pickSavePath({ defaultPath: target, title: '結合した PDF を保存' });
    if (picked?.canceled === true || typeof picked?.path !== 'string')
      return { canceled: true };
    return resolveTarget(picked.path);
  }

  async function run() {
    if (!canRun())
      return { error: '結合できる状態ではありません。' };

    const picked = await root.pdfAPI.pickSavePath({
      defaultPath: defaultTargetFor(state.rows[0].path),
      title: '結合した PDF を保存',
    });
    if (picked?.canceled === true)
      return { canceled: true };
    if (typeof picked?.path !== 'string')
      return { error: picked?.error ?? '保存先を決められませんでした。' };

    const target = picked.path;
    if (state.rows.some((row) => pathKey(row.path) === pathKey(target))) {
      banner().show('出力先に入力ファイルと同じファイルは選べません。');
      return { error: '出力先に入力ファイルと同じファイルは選べません。' };
    }

    state.running = true;
    list()?.render();
    let result;
    try {
      result = await root.SigK.save.runTask({
        kind: 'merge',
        label: '結合',
        inputs: state.rows.map((row) => ({ path: row.path, name: row.name, pages: row.pages })),
        target,
      });
    } finally {
      state.running = false;
      list()?.render();
    }
    return finish(result, target);
  }

  async function finish(result, target) {
    if (result?.canceled === true) {
      banner().show('結合を中止しました。');
      return result;
    }
    if (result?.ok !== true) {
      banner().show(result?.error ?? '結合できませんでした。');
      return result ?? { error: '結合できませんでした。' };
    }

    const count = state.rows.length;
    if (tabs().count() >= tabs().MAX_TABS) {
      await root.recentAPI?.add?.({ path: target, name: baseName(target), openedAt: new Date().toISOString() });
      banner().show('結合しました。タブが多すぎるため開いていません。');
      return result;
    }
    const opened = await tabs().openPath(target);
    if (opened)
      root.SigK.shell.setMode(el.doc, 'view');
    banner().show(`${count} ファイルを結合しました（${result.pages} ページ）`, 2500);
    return result;
  }

  function init(doc, win) {
    if (win.__sigkToolsMergeReady === true)
      return false;
    if (doc.getElementById('merge-list') === null)
      return false;
    win.__sigkToolsMergeReady = true;
    el = { doc, win };
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsMerge = {
    MAX_INPUTS, NOTE_UNSAVED,
    init, rows, find, addPaths, addOpenTabs, pickFiles, addFromLaunch,
    setRange, move, moveTo, remove, clear,
    canRun, outputPages, defaultTargetFor, resolveTarget, run,
    isRunning: () => state.running,
  };
})(typeof window !== 'undefined' ? window : globalThis);
