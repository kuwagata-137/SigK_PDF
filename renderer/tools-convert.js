(function (root) {
  'use strict';

  // 画像→PDF の状態と指揮（spec-3-1 確定事項1〜9・18〜27）。
  //
  // 一覧の行（画像）と用紙・出力の設定を持ち、計画（convert-plan.js）を組み、
  // ワーカーへ渡す。描画は tools-convert-list.js（一覧）と tools-convert-view.js
  // （用紙・出力の欄）。実際に書くのはワーカーで、走らせるのは save.js の runTask。
  //
  // 結合（tools-merge.js）と分割（tools-split.js）の両方に似る。行を並べるところは
  // 結合、設定から計画を組んで同名を確かめるところは分割と同じ作法にしてある。

  const state = {
    rows: [], seq: 0,
    paper: 'a4', orientation: 'auto', margin: 'normal', output: 'single',
    folder: null, folderTouched: false,
    running: false,
  };
  let el = null;

  const banner = () => root.SigK.viewBanner;
  const tabs = () => root.SigK.tabs;
  const list = () => root.SigK.toolsConvertList;
  const view = () => root.SigK.toolsConvertView;
  const plan = () => root.SigK.convertPlan;
  const baseName = (filePath) => root.SigK.toolSource.baseName(filePath);

  function pathKey(filePath) {
    return typeof filePath === 'string' ? filePath.replace(/\//g, '\\').toLowerCase() : null;
  }

  function dirOf(filePath) {
    const at = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    return at < 0 ? '' : filePath.slice(0, at);
  }

  // フォルダーの区切りに合わせてつなぐ（tools-split.js と同じ）。
  function joinPath(folder, name) {
    const sep = folder.includes('/') && !folder.includes('\\') ? '/' : '\\';
    return folder.endsWith(sep) ? `${folder}${name}` : `${folder}${sep}${name}`;
  }

  const rows = () => state.rows.map((row) => ({ ...row }));
  const find = (id) => state.rows.find((row) => row.id === id) ?? null;
  const settings = () => ({
    paper: state.paper, orientation: state.orientation, margin: state.margin,
    output: state.output, folder: state.folder,
  });

  function redraw() {
    list()?.render();
    view()?.render();
  }

  // ---- 足す（確定事項1・2・4〜7） ----

  // 読むのは tool-source.js の inspectImage（メインの image-io.js が先頭バイトだけ見る）。
  // 文言の続き「外してください」はこちらで足す（結合と同じ作法）。
  async function inspect(filePath) {
    const info = await root.SigK.toolSource.inspectImage(filePath);
    if (info.ok === true)
      return info;
    return { error: `${info.error}。外してください` };
  }

  async function addPaths(paths) {
    const incoming = (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');
    const room = plan().MAX_INPUTS - state.rows.length;
    if (incoming.length > room) {
      banner().show(`変換できるのは ${plan().MAX_INPUTS} ファイルまでです。`);
      if (room <= 0)
        return [];
    }
    const added = [];
    for (const filePath of incoming.slice(0, Math.max(0, room))) {
      state.seq += 1;
      const row = {
        id: `convert-${state.seq}`,
        path: filePath,
        name: baseName(filePath),
        kind: null,
        width: null,
        height: null,
        blocked: null,
        pending: true,
      };
      state.rows.push(row);
      added.push(row);
    }
    // 出力フォルダーの既定は先頭画像の場所。ユーザーが変えたあとは追従しない（確定事項20）。
    if (!state.folderTouched && state.rows.length > 0)
      state.folder = dirOf(state.rows[0].path);
    redraw();

    await Promise.all(added.map(async (row) => {
      const info = await inspect(row.path);
      row.pending = false;
      if (info.error !== undefined)
        row.blocked = info.error;
      else {
        row.kind = info.kind;
        row.width = info.width;
        row.height = info.height;
        row.name = info.name;
      }
      list()?.syncRow(row.id);
    }));
    redraw();
    return added.map((row) => row.id);
  }

  async function pickFiles() {
    const api = root.pdfAPI;
    if (api?.available !== true || typeof api.pickImageSources !== 'function')
      return [];
    const picked = await api.pickImageSources({ defaultPath: state.rows[0]?.path });
    if (picked?.canceled === true || !Array.isArray(picked?.paths))
      return [];
    return addPaths(picked.paths);
  }

  // `--to-pdf` の受け口（確定事項2・9）。呼ぶ側は Phase 5 で作る。
  async function addFromLaunch(paths) {
    root.SigK.shell.setMode(el.doc, 'tools');
    root.SigK.tools.select('convert');
    return addPaths(paths);
  }

  // ---- 並べ替える・外す（確定事項8） ----

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
    redraw();
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
    redraw();
    return true;
  }

  function clear() {
    state.rows = [];
    redraw();
    return true;
  }

  // ---- 用紙と出力の設定（確定事項10〜14・18・20） ----

  function setPaper(paperId) {
    if (!root.SigK.paperSize.isPaper(paperId))
      return false;
    state.paper = paperId;
    redraw();
    return true;
  }

  function setOrientation(orientation) {
    if (!root.SigK.paperSize.isOrientation(orientation))
      return false;
    state.orientation = orientation;
    redraw();
    return true;
  }

  function setMargin(margin) {
    if (!root.SigK.paperSize.isMargin(margin))
      return false;
    state.margin = margin;
    redraw();
    return true;
  }

  function setOutput(output) {
    if (output !== 'single' && output !== 'each')
      return false;
    state.output = output;
    redraw();
    return true;
  }

  function setFolder(folder) {
    if (typeof folder !== 'string' || folder === '')
      return false;
    state.folder = folder;
    state.folderTouched = true;
    redraw();
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

  // いまの設定から計画を組む。行が無い・読んでいる途中・読めない行があれば
  // ready: false（error は null。理由は行の側にある）。「画像ごと」なら出力先も添える。
  function currentPlan() {
    const planned = plan().planConvert(state.rows, settings());
    if (planned.ready !== true)
      return planned;
    const folder = state.folder ?? (state.rows.length > 0 ? dirOf(state.rows[0].path) : '');
    return { ...planned, folder, targets: planned.names.map((name) => joinPath(folder, name)) };
  }

  function canRun() {
    return !state.running && root.SigK.save?.isBusy() !== true && currentPlan().ready === true;
  }

  // ワーカーへ渡す画像の並び（確定事項22）。layout は計画がそのまま持っている。
  function imagesFor(current, targets) {
    return state.rows.map((row, index) => ({
      path: row.path,
      name: row.name,
      layout: current.pages[index],
      ...(targets === undefined ? {} : { target: targets[index] }),
    }));
  }

  function defaultSingleTarget() {
    const first = state.rows[0];
    if (first === undefined)
      return undefined;
    return joinPath(dirOf(first.path), plan().defaultSingleName(state.rows));
  }

  // ---- 同名確認（確定事項20） ----

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

  // 3択は1回だけ出し、「別名で保存」はフォルダーを選び直してもう一度確かめる
  // （分割の resolveTargets と同じ）。戻り値は { targets } / { canceled }。
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

  // ---- 実行（確定事項19・20・22〜27） ----

  async function run() {
    if (!canRun())
      return { error: '変換できる状態ではありません。' };
    return state.output === 'each' ? runEach() : runSingle();
  }

  // 1つの PDF にまとめる（確定事項19）。保存先は OS の保存ダイアログが決め、
  // 同名の確認もダイアログに任せる（結合と同じ）。
  async function runSingle() {
    const picked = await root.pdfAPI.pickSavePath({
      defaultPath: defaultSingleTarget(),
      title: '変換した PDF を保存',
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

    const current = currentPlan();
    const result = await runTask({
      output: 'single',
      images: imagesFor(current),
      target,
      targets: [target],
    });
    return finishSingle(result, target);
  }

  // 画像ごとに別の PDF（確定事項20）。出力先は一覧から組み、同名は3択で1回だけ確かめる。
  async function runEach() {
    const current = currentPlan();
    if (current.targets.some((target) => state.rows.some((row) => pathKey(row.path) === pathKey(target)))) {
      banner().show('出力先に入力ファイルと同じファイルは選べません。');
      return { error: '出力先に入力ファイルと同じファイルは選べません。' };
    }

    const resolved = await resolveTargets(current.targets);
    if (resolved.canceled === true)
      return { canceled: true };
    const targets = resolved.targets;

    const result = await runTask({
      output: 'each',
      images: imagesFor(currentPlan(), targets),
      targets,
    });
    return finishEach(result, targets);
  }

  async function runTask(spec) {
    state.running = true;
    redraw();
    try {
      return await root.SigK.save.runTask({ kind: 'convert', label: '変換', ...spec });
    } finally {
      state.running = false;
      redraw();
    }
  }

  async function finishSingle(result, target) {
    if (result?.canceled === true) {
      banner().show('変換を中止しました。');
      return result;
    }
    if (result?.ok !== true) {
      banner().show(result?.error ?? '変換できませんでした。');
      return result ?? { error: '変換できませんでした。' };
    }

    const count = state.rows.length;
    if (tabs().count() >= tabs().MAX_TABS) {
      await root.recentAPI?.add?.({ path: target, name: baseName(target), openedAt: new Date().toISOString() });
      banner().show('変換しました。タブが多すぎるため開いていません。');
      return result;
    }
    const opened = await tabs().openPath(target);
    if (opened)
      root.SigK.shell.setMode(el.doc, 'view');
    banner().show(`${count} ファイルを変換しました（${result.pages} ページ）`, 2500);
    return result;
  }

  // 中止までに書き終えた本数。出力先の有無で数えると、上書きする前からあった
  // ファイルまで数えてしまうので、ワーカーの進捗（write の done）を見る（確定事項24）。
  function writtenBeforeCancel() {
    const progress = root.SigK.save?.lastProgress?.() ?? null;
    return progress?.phase === 'write' && Number.isInteger(progress.done) ? progress.done : 0;
  }

  function finishEach(result, targets) {
    if (result?.canceled === true) {
      const written = writtenBeforeCancel();
      banner().show(written > 0 ? `変換を中止しました。${written} ファイルは書き出し済みです。` : '変換を中止しました。');
      return result;
    }
    if (result?.ok !== true) {
      banner().show(result?.error ?? '変換できませんでした。');
      return result ?? { error: '変換できませんでした。' };
    }
    banner().show(`${result.written} ファイルに変換しました`, {
      autoHideMs: 0,
      tone: 'info',
      action: { label: 'フォルダを開く', onClick: () => root.shellAPI?.showInFolder?.(targets[0]) },
    });
    return result;
  }

  function init(doc, win) {
    if (win.__sigkToolsConvertReady === true)
      return false;
    if (doc.getElementById('convert-run') === null)
      return false;
    win.__sigkToolsConvertReady = true;
    el = { doc, win };
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsConvert = {
    init, rows, find, settings, currentPlan, joinPath,
    addPaths, pickFiles, addFromLaunch,
    move, moveTo, remove, clear,
    setPaper, setOrientation, setMargin, setOutput, setFolder, pickFolder,
    canRun, resolveTargets, defaultSingleTarget, run,
    isRunning: () => state.running,
  };
})(typeof window !== 'undefined' ? window : globalThis);
