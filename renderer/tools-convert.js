(function (root) {
  'use strict';

  // 画像→PDF の状態と指揮（spec-3-1 確定事項1〜9・18〜27、spec-2-5 第 H 章）。
  //
  // 画像の並び（rows）と用紙・出力の設定を持ち、計画（convert-plan.js）を組む。描くのは「変換する画像」の帯（image-strip.js）と
  // 右の欄（tools-convert-view.js）、画像を足すのは convert-intake.js、実行は convert-run.js、書けたあとの始末は convert-result.js。
  // revision は画像の帯の中身・用紙・出力を変えるたびに進む（「できた PDF」のカードを消す合図。H12）。

  // executed は「最後の実行が成功し、その後に画像の並びを変えていない」（spec-5-1 確定事項18）。
  // 用紙・出力の設定は並びではないので、変えても下ろさない。
  const state = {
    rows: [], seq: 0, revision: 0,
    paper: 'a4', orientation: 'auto', margin: 'normal', output: 'single',
    folder: null, folderTouched: false,
    running: false, executed: false,
  };
  let el = null;
  let adder = null;

  const plan = () => root.SigK.convertPlan;

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
  const settings = () => ({ paper: state.paper, orientation: state.orientation, margin: state.margin, output: state.output, folder: state.folder });

  function redraw() {
    root.SigK.imageStrip?.render();
    root.SigK.toolsConvertView?.render();
  }

  // 画像の帯の中身・用紙・出力を変えた。並びを変えたなら実行済みも下ろす。
  function changed({ rowsChanged = false } = {}) {
    state.revision += 1;
    if (rowsChanged)
      state.executed = false;
    redraw();
    return true;
  }

  // 画像を足す所（convert-intake.js）。並びと設定はここが持ち、足す所へ渡す。
  const intakeOf = () => (adder ??= root.SigK.convertIntake.create({ state, changed, redraw, clear, dirOf, doc: () => el.doc }));

  // ---- 並べ替える・外す（確定事項8。spec-2-5 確定事項H6） ----

  // at は「取り除く前」の挿入位置（image-strip-drag.js の落とす先）。
  function moveTo(id, at) {
    const from = state.rows.findIndex((row) => row.id === id);
    if (from < 0 || !Number.isInteger(at))
      return false;
    const target = Math.min(Math.max(at, 0), state.rows.length);
    const to = target > from ? target - 1 : target;
    if (to === from)
      return false;
    state.rows.splice(to, 0, ...state.rows.splice(from, 1));
    return changed({ rowsChanged: true });
  }

  function remove(id) {
    const from = state.rows.findIndex((row) => row.id === id);
    if (from < 0)
      return false;
    state.rows.splice(from, 1);
    return changed({ rowsChanged: true });
  }

  function clear() {
    state.rows = [];
    return changed({ rowsChanged: true });
  }

  // ---- 用紙と出力の設定（確定事項10〜14・18・20） ----

  function setChoice(key, value, isValid) {
    if (!isValid(value))
      return false;
    state[key] = value;
    return changed();
  }

  const paperSize = () => root.SigK.paperSize;
  const setPaper = (id) => setChoice('paper', id, (value) => paperSize().isPaper(value));
  const setOrientation = (id) => setChoice('orientation', id, (value) => paperSize().isOrientation(value));
  const setMargin = (id) => setChoice('margin', id, (value) => paperSize().isMargin(value));
  const setOutput = (id) => setChoice('output', id, (value) => value === 'single' || value === 'each');

  function setFolder(folder) {
    if (!setChoice('folder', folder, (value) => typeof value === 'string' && value !== ''))
      return false;
    state.folderTouched = true;
    return true;
  }

  async function pickFolder() {
    const api = root.pdfAPI;
    if (typeof api?.pickFolder !== 'function')
      return false;
    const picked = await api.pickFolder({ defaultPath: state.folder ?? undefined });
    return picked?.canceled !== true && typeof picked?.path === 'string' && setFolder(picked.path);
  }

  // いまの設定から計画を組む。画像が無い・読んでいる途中・読めない画像があれば ready: false（error は null。理由は画像の側にある）。
  // 「画像ごと」なら出力先も添える。
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

  // 保存ダイアログ・同名の 3 択・書いた後の始末まで実行中と数える（spec-5-1 確定事項12。結合と同じ）。
  async function run() {
    if (!canRun())
      return { error: '変換できる状態ではありません。' };
    state.running = true;
    root.SigK.convertResult?.clear();   // 次の変換を始めたら「できた PDF」のカードを消す（H12）
    redraw();
    try {
      const result = await (state.output === 'each' ? root.SigK.convertRun.runEach() : root.SigK.convertRun.runSingle());
      if (result?.ok === true)
        state.executed = true;
      return result;
    } finally {
      state.running = false;
      redraw();
    }
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
    init, rows, find, settings, currentPlan, joinPath, dirOf,
    addPaths: (paths, options) => intakeOf().addPaths(paths, options),
    addFromLaunch: (paths, options) => intakeOf().addFromLaunch(paths, options),
    moveTo, remove, clear,
    setPaper, setOrientation, setMargin, setOutput, setFolder, pickFolder,
    canRun, run,
    resolveTargets: (targets) => root.SigK.convertRun.resolveTargets(targets),
    defaultSingleTarget: () => root.SigK.convertRun.defaultSingleTarget(),
    revision: () => state.revision,
    isRunning: () => state.running,
  };
})(typeof window !== 'undefined' ? window : globalThis);
