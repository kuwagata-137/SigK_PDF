(function (root) {
  'use strict';

  // 分割画面の状態と指揮（spec-2-2 確定事項1〜32・spec-2-2b）。
  //
  // 対象は 1 ファイル（spec-2-2 ユーザー確定①）。対象と出力の設定を持ち、盤（tools-split-edit.js）から計画（parts と出力パス）を
  // 組む。実行は split-run.js。描くのは tools-split-view.js（右の欄と下の要約）と split-board-view.js（盤）。
  //
  // 対象は 1 回だけ読み、描く層（split-thumbs.js）が開いたまま持つ（spec-2-2b 確定事項D1）。分割の画面を離れると畳み、戻ると
  // 読み直して、書き換わっていれば知らせる（確定事項D7。split-reload.js）。分割はファイルを読み直して分けるので、画面上の並べ替え・回転・削除は
  // 結果に映らない（spec-2-2 確定事項3）。未保存のタブを対象にすることは止めず、注意だけ出す。

  // 対象の欄は source-picker.js（spec-4-5 確定事項34）。右クリック起動で複数本が届いたときの
  // 文言 NOTE_FIRST_ONLY は、Phase 5 で見直して変えないことにした（spec-5-1 確定事項20）。
  const { NOTE_UNSAVED, NOTE_FIRST_ONLY } = root.SigK.sourcePicker;

  const state = { folder: null, folderTouched: false, rule: 'seq', running: false, boardKey: null };
  let el = null;
  let launchBatch = null;

  const banner = () => root.SigK.viewBanner;
  const view = () => root.SigK.toolsSplitView;
  const edit = () => root.SigK.toolsSplitEdit;
  const thumbs = () => root.SigK.splitThumbs;
  const intake = () => root.SigK.launchIntake;
  const batches = () => (launchBatch ??= intake().createBatchTracker());

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

  // ---- 対象（spec-2-2 確定事項1〜5・spec-2-2b 確定事項B6・D1・F） ----

  const field = root.SigK.sourcePicker.create({
    inspect: (filePath) => thumbs().open(filePath),
    pick: ({ defaultPath }) => {
      const api = root.pdfAPI;
      if (api?.available !== true || typeof api.pickSplitSource !== 'function')
        return null;
      return api.pickSplitSource({ defaultPath });
    },
    dirtyMessage: '未保存の編集は分割に反映されません。保存してから分割し直してください。',
    onSelect: (filePath) => {
      if (!state.folderTouched)
        state.folder = dirOf(filePath);
    },
    onChange: () => {
      syncBoard();
      view()?.render();
    },
  });

  const source = () => field.source();
  const isReady = (src) => src !== null && !src.pending && src.blocked === null && src.pageCount !== null;
  // ドロップの受け口は addPaths（対象は1つなので先頭だけ使う）。`--split` は useFromLaunch。
  const { setSource, useTab, pickFile, addPaths } = field;

  // 対象が読めたら盤を作る。同じファイルを選び直したとき（ページ数も同じ）は今の盤を残す（確定事項B6）。
  function syncBoard() {
    const src = source();
    if (!isReady(src))
      return;
    const key = `${pathKey(src.path)}|${src.pageCount}`;
    if (key === state.boardKey)
      return;
    state.boardKey = key;
    edit().reset(src.pageCount);
  }

  // `--split` の受け口（spec-2-2 確定事項6・spec-5-1 確定事項9・20・21）。右クリックで N 個選ぶと、分割にも
  // 1 本ずつ届く（子の MultiSelectModel=Single は効かない。事前調査 A2）。束の中でファイル名の順に
  // 先頭の 1 本を対象にし、後から届いたパスが前なら差し替える。帯は束につき 1 回。
  async function useFromLaunch(paths, { batch } = {}) {
    const incoming = (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');
    if (incoming.length === 0)
      return false;
    const { starts } = batches().enter(batch);
    if (starts) {
      root.SigK.shell.setMode(el.doc, 'tools');
      root.SigK.tools.select('split');
    }
    const first = [...incoming].sort(intake().compareNames)[0];
    const current = source();
    const replace = starts || current === null || intake().compareNames(first, current.path) < 0;
    const ok = replace ? await setSource(first) : true;
    if ((incoming.length > 1 || !starts) && batches().once('first-only'))
      banner().show(NOTE_FIRST_ONLY, { tone: 'warn' });   // 注意・お知らせは黄色（決定49）
    return ok;
  }

  // ---- 出力（spec-2-2 確定事項14〜19） ----

  function setRule(rule) {
    if (rule !== 'seq' && rule !== 'pages')
      return false;
    state.rule = rule;
    view()?.render();
    return true;
  }

  // ユーザーが変えたあとは対象に追従しない（spec-2-2 確定事項14）。
  function setFolder(folder) {
    if (typeof folder !== 'string' || folder === '')
      return false;
    state.folder = folder;
    state.folderTouched = true;
    view()?.render();
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

  const settings = () => ({ folder: state.folder, rule: state.rule });

  // いまの盤から計画を組む。対象が決まっていなければ reason は 'no-source'。ほかの reason は盤の status（確定事項B5）。
  function currentPlan() {
    const src = source();
    const board = edit().board();
    if (!isReady(src) || board === null)
      return { ready: false, reason: 'no-source' };
    const status = root.SigK.splitBoard.status(board);
    const parts = root.SigK.splitBoard.parts(board);
    const names = root.SigK.splitPlan.outputNames(src.name, parts, state.rule);
    const folder = state.folder ?? dirOf(src.path);
    return { ready: status.ready, reason: status.reason, files: status.files, parts, names, folder, targets: names.map((name) => joinPath(folder, name)) };
  }

  function canRun() {
    return !state.running && root.SigK.save?.isBusy() !== true && currentPlan().ready === true;
  }

  // 同名の 3 択・フォルダーの選び直しの間も実行中と数える（spec-5-1 確定事項12。結合と同じ）。
  async function run() {
    if (!canRun())
      return { error: '分割できる状態ではありません。' };
    state.running = true;
    view()?.render();
    try {
      return await root.SigK.splitRun.execute();
    } finally {
      state.running = false;
      view()?.render();
    }
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
    init, source, settings, currentPlan, joinPath, pathKey,
    setSource, useTab, pickFile, addPaths, useFromLaunch,
    setRule, setFolder, pickFolder,
    canRun, run,
    isRunning: () => state.running,
  };
})(typeof window !== 'undefined' ? window : globalThis);
