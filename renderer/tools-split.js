(function (root) {
  'use strict';

  // 分割画面の状態と指揮（spec-2-2 確定事項1〜32）。
  //
  // 対象は1ファイル（ユーザー確定①）。分け方と出力の設定を持ち、計画（parts と
  // 出力パス）を組み、同名を確かめてからワーカーへ渡す。描画は tools-split-view.js。
  // 実際に書くのはワーカーで、走らせるのは save.js の runTask（結合と同じ）。
  //
  // 分割はファイルを読み直して分けるので、画面上の並べ替え・回転・削除は結果に
  // 映らない（確定事項3）。未保存のタブを対象にすることは止めず、注意だけ出す。

  const NOTE_UNSAVED = '未保存の編集は反映されません';
  // 右クリック起動で複数本が届いたときの文言。Phase 5 で見直す（確定事項6）。
  const NOTE_FIRST_ONLY = '1つ目のファイルだけを対象にしました。';

  const state = {
    source: null,          // { path, name, pageCount, blocked, note, pending }
    mode: 'every', every: '1', at: '', range: '',
    folder: null, folderTouched: false, rule: 'seq',
    running: false,
  };
  let el = null;

  const banner = () => root.SigK.viewBanner;
  const tabs = () => root.SigK.tabs;
  const view = () => root.SigK.toolsSplitView;
  const planner = () => root.SigK.splitPlan;
  const baseName = (filePath) => root.SigK.toolSource.baseName(filePath);

  function pathKey(filePath) {
    return typeof filePath === 'string' ? filePath.replace(/\//g, '\\').toLowerCase() : null;
  }

  function dirOf(filePath) {
    const at = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    return at < 0 ? '' : filePath.slice(0, at);
  }

  // フォルダーの区切りに合わせてつなぐ。ダイアログが返すのは Windows の「\」だが、
  // テストや将来の環境で「/」が来ても壊さない。
  function joinPath(folder, name) {
    const sep = folder.includes('/') && !folder.includes('\\') ? '/' : '\\';
    return folder.endsWith(sep) ? `${folder}${name}` : `${folder}${sep}${name}`;
  }

  const source = () => (state.source === null ? null : { ...state.source });
  const settings = () => ({ mode: state.mode, every: state.every, at: state.at, range: state.range, folder: state.folder, rule: state.rule });

  // ---- 対象（確定事項1〜5） ----

  async function setSource(filePath, { dirty = false } = {}) {
    if (typeof filePath !== 'string' || filePath === '')
      return false;
    const next = { path: filePath, name: baseName(filePath), pageCount: null, blocked: null, note: dirty ? NOTE_UNSAVED : null, pending: true };
    state.source = next;
    if (!state.folderTouched)
      state.folder = dirOf(filePath);
    view()?.render();

    const info = await root.SigK.toolSource.inspectPdf(filePath);
    if (state.source !== next)
      return false;   // 読んでいる間に差し替えられた
    next.pending = false;
    if (info.reason !== undefined)
      next.blocked = `${info.error}。選び直してください`;
    else {
      next.pageCount = info.pageCount;
      next.name = info.name;
    }
    view()?.render();
    return true;
  }

  async function useOpenTab() {
    const open = tabs()?.list() ?? [];
    const active = open.find((tab) => tab.active) ?? open[0];
    if (active === undefined || typeof active.path !== 'string') {
      banner().show('開いているファイルがありません。');
      return false;
    }
    const dirty = tabs().isDirty(active.id) === true;
    const ok = await setSource(active.path, { dirty });
    if (dirty)
      banner().show('未保存の編集は分割に反映されません。保存してから分割し直してください。');
    return ok;
  }

  async function pickFile() {
    const api = root.pdfAPI;
    if (api?.available !== true || typeof api.pickSplitSource !== 'function')
      return false;
    const picked = await api.pickSplitSource({ defaultPath: state.source?.path });
    if (picked?.canceled === true || typeof picked?.path !== 'string')
      return false;
    return setSource(picked.path);
  }

  // ドロップと `--split` の受け口。対象は1つなので先頭だけ使う（確定事項2・6）。
  async function addPaths(paths) {
    const incoming = (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');
    if (incoming.length === 0)
      return false;
    const ok = await setSource(incoming[0]);
    if (incoming.length > 1)
      banner().show(NOTE_FIRST_ONLY);
    return ok;
  }

  async function useFromLaunch(paths) {
    root.SigK.shell.setMode(el.doc, 'tools');
    root.SigK.tools.select('split');
    return addPaths(paths);
  }

  // ---- 分け方と出力（確定事項7〜19） ----

  function setMode(mode) {
    if (!['every', 'at', 'range'].includes(mode))
      return false;
    state.mode = mode;
    view()?.sync();
    return true;
  }

  function setInput(mode, text) {
    if (!['every', 'at', 'range'].includes(mode))
      return false;
    state[mode] = String(text ?? '');
    view()?.sync();
    return true;
  }

  function setRule(rule) {
    if (rule !== 'seq' && rule !== 'pages')
      return false;
    state.rule = rule;
    view()?.sync();
    return true;
  }

  // ユーザーが変えたあとは対象に追従しない（確定事項14）。
  function setFolder(folder) {
    if (typeof folder !== 'string' || folder === '')
      return false;
    state.folder = folder;
    state.folderTouched = true;
    view()?.sync();
    return true;
  }

  async function pickFolder() {
    const api = root.pdfAPI;
    if (typeof api?.pickFolder !== 'function')
      return false;
    const picked = await api.pickFolder({ defaultPath: state.folder ?? undefined });
    if (picked?.canceled === true || typeof picked?.path !== 'string')
      return false;
    return setFolder(picked.path);
  }

  // いまの設定から計画を組む。対象が決まっていなければ ready: false（error は null）、
  // 入力に誤りがあれば ready: false と error、組めれば parts・names・targets。
  function currentPlan() {
    const src = state.source;
    if (src === null || src.pending || src.blocked !== null || src.pageCount === null)
      return { ready: false, error: null };
    const planned = planner().planSplit({ mode: state.mode, every: state.every, at: state.at, range: state.range }, src.pageCount);
    if (planned.error !== undefined)
      return { ready: false, error: planned.error };
    const names = planner().outputNames(src.name, planned.parts, state.rule);
    const folder = state.folder ?? dirOf(src.path);
    return { ready: true, error: null, parts: planned.parts, names, folder, targets: names.map((name) => joinPath(folder, name)) };
  }

  function canRun() {
    return !state.running && root.SigK.save?.isBusy() !== true && currentPlan().ready === true;
  }

  // ---- 同名確認（確定事項21・22） ----

  async function countExisting(targets) {
    const api = root.pdfAPI;
    if (typeof api?.exists !== 'function')
      return [];
    const found = [];
    for (const target of targets) {
      const answer = await api.exists(target);
      if (answer?.exists === true)
        found.push(target);
    }
    return found;
  }

  // 戻り値は { targets } / { canceled }。3択は1回だけ出し、「別名で保存」は
  // フォルダーを選び直してもう一度確かめる。
  async function resolveTargets(targets) {
    const found = await countExisting(targets);
    if (found.length === 0)
      return { targets };
    const confirm = root.SigK.confirmReplace;
    const answer = await confirm.ask({ name: baseName(found[0]), count: found.length });
    if (answer === confirm.REPLACE)
      return { targets };
    if (answer !== confirm.RENAME)
      return { canceled: true };
    if (!(await pickFolder()))
      return { canceled: true };
    const next = currentPlan();
    return next.ready ? resolveTargets(next.targets) : { canceled: true };
  }

  // ---- 実行（確定事項20・23〜32） ----

  async function run() {
    if (!canRun())
      return { error: '分割できる状態ではありません。' };
    const current = currentPlan();
    const src = state.source;
    if (current.targets.some((target) => pathKey(target) === pathKey(src.path))) {
      banner().show('出力先に元のファイルと同じファイルは選べません。');
      return { error: '出力先に元のファイルと同じファイルは選べません。' };
    }

    const resolved = await resolveTargets(current.targets);
    if (resolved.canceled === true)
      return { canceled: true };
    const targets = resolved.targets;

    state.running = true;
    view()?.render();
    let result;
    try {
      result = await root.SigK.save.runTask({
        kind: 'split',
        label: '分割',
        source: src.path,
        name: src.name,
        parts: current.parts.map((pages, index) => ({ pages, target: targets[index] })),
        targets,
      });
    } finally {
      state.running = false;
      view()?.render();
    }
    return finish(result, targets);
  }

  async function finish(result, targets) {
    if (result?.canceled === true) {
      const written = (await countExisting(targets)).length;
      banner().show(written > 0 ? `分割を中止しました。${written} ファイルは書き出し済みです。` : '分割を中止しました。');
      return result;
    }
    if (result?.ok !== true) {
      banner().show(result?.error ?? '分割できませんでした。');
      return result ?? { error: '分割できませんでした。' };
    }
    banner().show(`${result.written} ファイルに分割しました`, {
      autoHideMs: 0,
      tone: 'info',
      action: { label: 'フォルダを開く', onClick: () => root.shellAPI?.showInFolder?.(targets[0]) },
    });
    return result;
  }

  function init(doc, win) {
    if (win.__sigkToolsSplitReady === true)
      return false;
    if (doc.getElementById('split-run') === null)
      return false;
    win.__sigkToolsSplitReady = true;
    el = { doc, win };
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsSplit = {
    NOTE_UNSAVED, NOTE_FIRST_ONLY,
    init, source, settings, currentPlan, joinPath,
    setSource, useOpenTab, pickFile, addPaths, useFromLaunch,
    setMode, setInput, setRule, setFolder, pickFolder,
    canRun, resolveTargets, run,
    isRunning: () => state.running,
  };
})(typeof window !== 'undefined' ? window : globalThis);
