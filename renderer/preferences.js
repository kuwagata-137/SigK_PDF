(function (root) {
  'use strict';

  // 設定の窓の値の写し（spec-6-1 タスク E の確定事項E-4・E-5）。持ち主はメイン（preferences.js）で、画面は写しを持つ。
  // 写しは起動したときに読み、書いたとき（set の戻り値）と、メインが「最後に書き出したフォルダ」を覚えたとき（preferencesAPI.onChanged）に
  // 置き換える。最初のフォルダ（initialFolder）は写しから同期で決める（右の欄の「フォルダ」の欄は、描くときにすぐ値が要るため）。
  // フォルダが今あるかは写しを読んだ時点のものなので、保存の窓を出す前（resolvePath）・ツールを選んだとき・窓が前に出たとき（refresh）に
  // メインに聞き直す（点検の直し I-6）。

  // preferences.js の PREFERENCE_DEFAULTS と同じ（メインに届かない環境・読み込む前の既定）。
  const DEFAULTS = Object.freeze({
    outputFolder: Object.freeze({ mode: 'source', fixed: null, last: null }),
    makeBackup: true,
    rememberToolValues: true,
    rememberLastTool: true,
    toolValues: Object.freeze({}),
    lastTool: null,
  });

  const state = { snapshot: null, listeners: [] };
  // 最初のフォルダを左右する部分（決め方と、今あるフォルダ）。替わったときだけ subscribe の相手を呼ぶ。
  const foldersKey = (snapshot) => JSON.stringify([snapshot?.preferences?.outputFolder?.mode, snapshot?.available]);
  // 起動したときの読み込みが済んだら（読めなくても）解ける。覚えた値を当てる部品（tool-memory.js）が待つ。
  let markReady = () => {};
  const readyPromise = new Promise((resolve) => { markReady = resolve; });

  const api = () => (root.preferencesAPI?.available === true ? root.preferencesAPI : null);

  function accept(snapshot) {
    if (snapshot?.ok !== true || typeof snapshot.preferences !== 'object' || snapshot.preferences === null)
      return false;
    const before = foldersKey(state.snapshot);
    state.snapshot = { preferences: snapshot.preferences, available: snapshot.available ?? { last: null, fixed: null } };
    if (foldersKey(state.snapshot) !== before) {
      for (const listener of state.listeners)
        listener(state.snapshot.preferences);
    }
    return true;
  }

  // 今の値（読み込む前とメインに届かない環境では既定）。
  function current() {
    return state.snapshot?.preferences ?? DEFAULTS;
  }

  // 差分を書く。戻り値は { ok, preferences, available } か { error }。
  async function set(patch) {
    const target = api();
    if (target === null)
      return { error: '設定を書けません。' };
    try {
      const result = await target.set(patch);
      accept(result);
      return result;
    } catch (error) {
      root.SigK.log?.warn('preferences', '設定を書けませんでした', error);
      return { error: '設定を書けませんでした。' };
    }
  }

  // 書き出すときの最初のフォルダ（確定事項E-5）。sourceFolder は「元のファイルと同じフォルダ」（呼び出し側の今の決め方）。
  // 「最後に書き出したフォルダ」「決めたフォルダ」が無い・無くなっていたら sourceFolder。
  function initialFolder(sourceFolder) {
    const { mode } = current().outputFolder;
    const available = state.snapshot?.available ?? {};
    if (mode === 'last' && typeof available.last === 'string')
      return available.last;
    if (mode === 'fixed' && typeof available.fixed === 'string')
      return available.fixed;
    return sourceFolder;
  }

  // メインに今の値（フォルダが今あるかを含む）を聞き直す。読めなければ写しのまま。
  async function refresh() {
    const target = api();
    if (target === null)
      return false;
    try {
      return accept(await target.get());
    } catch (error) {
      root.SigK.log?.warn('preferences', '設定を読み直せませんでした', error);
      return false;
    }
  }

  // 保存の窓の最初の場所（フォルダ＋ファイルの名前）。defaultPath のフォルダを、最初のフォルダに差し替える。
  function initialPath(defaultPath) {
    if (typeof defaultPath !== 'string' || defaultPath === '')
      return defaultPath;
    const at = Math.max(defaultPath.lastIndexOf('\\'), defaultPath.lastIndexOf('/'));
    const sourceFolder = at < 0 ? null : defaultPath.slice(0, at);
    const folder = initialFolder(sourceFolder);
    if (folder === sourceFolder || typeof folder !== 'string')
      return defaultPath;
    return `${folder.replace(/[\\/]+$/, '')}\\${defaultPath.slice(at + 1)}`;
  }

  // 保存の窓を出す直前に使う。フォルダが今あるかを聞き直してから initialPath で決める。
  async function resolvePath(defaultPath) {
    await refresh();
    return initialPath(defaultPath);
  }

  // 最初のフォルダが替わりうるとき（決め方・最後に書き出したフォルダ・フォルダが今あるか）に呼ぶ。tools.js が右の欄を描き直す。
  function subscribe(listener) {
    state.listeners.push(listener);
  }

  async function init(doc, win) {
    if (win.__sigkPreferencesReady === true)
      return false;
    win.__sigkPreferencesReady = true;
    const target = api();
    if (target === null) {
      markReady();
      return false;
    }
    target.onChanged?.((snapshot) => accept({ ok: true, ...snapshot }));
    // ほかのアプリでフォルダを消して戻ってきたときに、右の欄の「フォルダ」が無いフォルダを指したままにならないように。
    win.addEventListener('focus', () => refresh());
    try {
      accept(await target.get());
    } catch (error) {
      root.SigK.log?.warn('preferences', '設定を読めませんでした', error);
    }
    markReady();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.preferences = { DEFAULTS, init, ready: () => readyPromise, current, set, refresh, initialFolder, initialPath, resolvePath, subscribe };
})(typeof window !== 'undefined' ? window : globalThis);
