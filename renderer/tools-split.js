(function (root) {
  'use strict';

  // 分割画面の状態と指揮（spec-2-2 確定事項1〜32・spec-2-2b・spec-2-5 第 G 章）。
  //
  // 対象は選んでいる帯（＝映しているタブ。strip-target.js。spec-2-5 G1）。対象と出力の設定を持ち、盤（tools-split-edit.js）から
  // 計画（parts と出力パス）を組む。実行は split-run.js。描くのは tools-split-view.js（右の欄）と split-board-view.js（盤）。
  // 盤は帯の今の並び（保存していない並べ替え・削除・差し込みを含む）で数え、分割はファイルに保存してある中身から作る（spec-2-5 G6・G7）。
  // 保存していない変更は、実行の前に確認の窓で知らせる（run-guard.js）。並び・削除・差し込みを保存していなければ［保存せずに実行］は押せない。

  // 右クリック起動で複数本が届いたときの文言。Phase 5 で見直して変えないことにした（spec-5-1 確定事項20）。
  const NOTE_FIRST_ONLY = '1つ目のファイルだけを対象にしました。';
  const NOTE_ORDER = 'ページの並べ替え・削除・差し込みを保存していないので、✂ の位置がファイルのページとずれます。［保存せずに実行］は使えません。';

  const state = { folder: null, folderTouched: false, rule: 'seq', running: false };
  let el = null;
  let launchBatch = null;

  const banner = () => root.SigK.viewBanner;
  const view = () => root.SigK.toolsSplitView;
  const edit = () => root.SigK.toolsSplitEdit;
  const tabs = () => root.SigK.tabs;
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

  // ---- 対象（spec-2-5 G1・G12） ----

  // 出力のフォルダーは、ユーザーが変えるまで対象の帯のフォルダーに追従する（spec-2-2 確定事項14）。state.folder は、変えるまでは
  // 帯のフォルダー、変えたあとは選んだフォルダー。
  const field = root.SigK.stripTarget.create({
    encryptedError: '分割できません',
    onChange: (src) => {
      if (!state.folderTouched && typeof src?.path === 'string')
        state.folder = dirOf(src.path);
    },
  });

  // 今の出力のフォルダー。変えるまでは、使うたびに設定の窓の「ファイルを書き出すときの、最初のフォルダ」で決め直す
  // （spec-6-1 確定事項E-5。決定81 ⑨。設定を変えたあとも従うように。点検の直し I-3）。
  function folderNow() {
    if (state.folderTouched || state.folder === null)
      return state.folder;
    return root.SigK.preferences?.initialFolder(state.folder) ?? state.folder;
  }

  const source = () => field.source();
  const isReady = (src) => src !== null && src.blocked === null;

  // 並びがファイルと同じか（並べ替え・削除・差し込みを保存していない帯は false。spec-2-5 G7）。同じなら、盤の位置がファイルのページになる。
  function matchesFile(peeked) {
    const plan = peeked?.plan;
    const count = peeked?.basePages?.length;
    return Array.isArray(plan) && plan.length === count && plan.every((page, index) => page.src === index && !Number.isInteger(page.insert));
  }

  // `--split` の受け口（spec-2-2 確定事項6・spec-5-1 確定事項9・20・21、spec-2-5 G13）。右クリックで N 個選ぶと、分割にも
  // 1 本ずつ届く（子の MultiSelectModel=Single は効かない。事前調査 A2）。束の最初でツールモードの分割へ移り、PDF をタブ（帯）で開いて、
  // 束の中でファイル名の順に先頭の帯を選ぶ（後から届いたパスが前なら選び直す。後ろなら、開いて前に出た帯から元の帯へ戻す）。
  // open は launch.js がタブで開く関数。「1つ目のファイルだけを対象にしました。」の通知バーは束につき 1 回。
  async function useFromLaunch(paths, { batch, open = (pdfs) => root.SigK.toolHandoff.openPdfs(pdfs) } = {}) {
    const incoming = (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');
    if (incoming.length === 0)
      return false;
    const { starts } = batches().enter(batch);
    if (starts) {
      root.SigK.shell.setMode(el.doc, 'tools');
      root.SigK.tools.select('split');
    }
    const current = starts ? null : source();
    await open(incoming);
    const first = [...incoming].sort(intake().compareNames)[0];
    const replace = current === null || intake().compareNames(first, current.path ?? '') < 0;
    const tab = replace ? tabs().findByPath(first) : tabs().list().find((entry) => entry.id === current.tabId) ?? null;
    if (tab !== null)
      tabs().activate(tab.id);
    if ((incoming.length > 1 || !starts) && batches().once('first-only'))
      banner().show(NOTE_FIRST_ONLY, { tone: 'warn' });   // 注意・お知らせは黄色（決定49）
    return replace ? tab !== null : true;
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
    const picked = await api.pickFolder({ defaultPath: folderNow() ?? undefined });
    if (picked?.canceled === true || typeof picked?.path !== 'string')
      return false;
    return setFolder(picked.path);
  }

  const settings = () => ({ folder: folderNow(), rule: state.rule });

  // いまの盤から計画を組む。対象が使えなければ reason は 'no-source'。ほかの reason は盤の status（確定事項B5）。
  // parts は盤の位置（帯の今の並びの位置）。ファイルのページへの読み替えは実行のとき（split-run.js）。
  function currentPlan() {
    const src = source();
    const board = isReady(src) ? edit().board() : null;
    if (board === null)
      return { ready: false, reason: 'no-source' };
    const status = root.SigK.splitBoard.status(board);
    const parts = root.SigK.splitBoard.parts(board);
    const names = root.SigK.splitPlan.outputNames(src.name, parts, state.rule);
    const folder = folderNow() ?? dirOf(src.path);
    return { ready: status.ready, reason: status.reason, files: status.files, parts, names, folder, targets: names.map((name) => joinPath(folder, name)) };
  }

  function canRun() {
    return !state.running && root.SigK.save?.isBusy() !== true && currentPlan().ready === true;
  }

  // 保存していない帯の確かめ・同名の 3 択・フォルダーの選び直しの間も実行中と数える（spec-5-1 確定事項12。結合と同じ）。
  async function run() {
    if (!canRun())
      return { error: '分割できる状態ではありません。' };
    state.running = true;
    view()?.render();
    try {
      const tabId = source().tabId;
      // 帯のファイルがほかのアプリで書き換えられていたら止める（spec-2-5 G11。決定81 ⑫ でほかのツールと同じ口にした）。
      const guard = await root.SigK.runGuard.confirmUnsaved([tabId], {
        canRunUnsaved: (id) => matchesFile(tabs().peek(id)),
        runNote: NOTE_ORDER,
        verb: '分割',
      });
      if (!guard.go)
        return guard.error === undefined ? { canceled: true } : { error: guard.error };
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
    NOTE_FIRST_ONLY, NOTE_ORDER,
    init, source, settings, currentPlan, joinPath, pathKey, matchesFile, useFromLaunch,
    setRule, setFolder, pickFolder,
    canRun, run,
    sync: () => field.sync(),
    stateText: () => field.stateText(),
    isRunning: () => state.running,
  };
})(typeof window !== 'undefined' ? window : globalThis);
