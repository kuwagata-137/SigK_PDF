(function (root) {
  'use strict';

  // 設定の窓の値の写し（spec-6-1 タスク E の確定事項E-4・E-5）。持ち主はメイン（preferences.js）で、画面は写しを持つ。
  // 写しは起動したときに読み、書いたとき（set の戻り値）と、メインが「最後に書き出したフォルダ」を覚えたとき（preferencesAPI.onChanged）に
  // 置き換える。最初のフォルダ（initialFolder）は写しから同期で決める（右の欄の「フォルダ」の欄は、描くときにすぐ値が要るため）。

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

  const api = () => (root.preferencesAPI?.available === true ? root.preferencesAPI : null);

  function accept(snapshot) {
    if (snapshot?.ok !== true || typeof snapshot.preferences !== 'object' || snapshot.preferences === null)
      return false;
    state.snapshot = { preferences: snapshot.preferences, available: snapshot.available ?? { last: null, fixed: null } };
    for (const listener of state.listeners)
      listener(state.snapshot.preferences);
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

  // 値が替わったら呼ぶ（ツールが覚えた値を当て直すなど）。
  function subscribe(listener) {
    state.listeners.push(listener);
  }

  async function init(doc, win) {
    if (win.__sigkPreferencesReady === true)
      return false;
    win.__sigkPreferencesReady = true;
    const target = api();
    if (target === null)
      return false;
    target.onChanged?.((snapshot) => accept({ ok: true, ...snapshot }));
    try {
      accept(await target.get());
    } catch (error) {
      root.SigK.log?.warn('preferences', '設定を読めませんでした', error);
    }
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.preferences = { DEFAULTS, init, current, set, initialFolder, initialPath, subscribe };
})(typeof window !== 'undefined' ? window : globalThis);
