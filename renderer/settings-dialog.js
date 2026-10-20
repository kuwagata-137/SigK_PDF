(function (root) {
  'use strict';

  // 設定の窓（spec-6-1 タスク E の確定事項E-1〜E-3。見本 screenshots/phase6-mock-settings-window.png）。
  // 開いたときに今の値（renderer/preferences.js の写し）を欄へ写し、［OK］のときだけメインへ書く。［キャンセル］・×・Esc は書かずに閉じる。
  // 開くのはツールバーの歯車のボタンと、メニュー「ファイル」→「設定…」（Ctrl＋,。メインが合図を送る）。開いたときのフォーカスは、
  // いちばん上の選択肢（選んでいる最初のフォルダの選択肢）。「決めたフォルダ」はフォルダが空のまま［OK］を押したら［変更…］の窓を出す。

  let el = null;
  const state = { fixed: null, pending: false };

  const preferences = () => root.SigK.preferences;

  function isOpen() {
    return el !== null && (el.dialog.open === true || el.dialog.hasAttribute('open'));
  }

  function folderInputs() {
    return [...el.dialog.querySelectorAll('input[name="settings-folder"]')];
  }

  function chosenMode() {
    return folderInputs().find((input) => input.checked)?.value ?? 'source';
  }

  function renderFixed() {
    el.fixedPath.textContent = state.fixed ?? 'まだ決めていません';
    el.fixedPath.classList.toggle('empty', state.fixed === null);
  }

  // 今の値を欄へ写す。
  function fill(values) {
    for (const input of folderInputs())
      input.checked = input.value === values.outputFolder.mode;
    state.fixed = values.outputFolder.fixed;
    renderFixed();
    el.backup.checked = values.makeBackup;
    el.toolValues.checked = values.rememberToolValues;
    el.lastTool.checked = values.rememberLastTool;
  }

  function open() {
    if (el === null || isOpen())
      return false;
    fill(preferences().current());
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
    folderInputs().find((input) => input.checked)?.focus();
    return true;
  }

  function close() {
    if (!isOpen())
      return false;
    if (typeof el.dialog.close === 'function' && el.dialog.open === true)
      el.dialog.close();
    else
      el.dialog.removeAttribute('open');
    return true;
  }

  // 「決めたフォルダ」を選ぶ（右の欄の［変更…］と同じフォルダを選ぶ窓）。選んだら「決めたフォルダ」の選択肢も選ぶ。
  async function changeFixed() {
    const picked = await root.pdfAPI?.pickFolder?.({ defaultPath: state.fixed ?? undefined, title: '決めたフォルダを選ぶ' });
    if (typeof picked?.path === 'string' && picked.path !== '') {
      state.fixed = picked.path;
      renderFixed();
      for (const input of folderInputs())
        input.checked = input.value === 'fixed';
    }
    return picked;
  }

  // ［OK］。書けたら閉じて true。「決めたフォルダ」が空のまま選ばれていたら［変更…］の窓を出し、取りやめたら開いたまま false。
  async function confirm() {
    if (!isOpen() || state.pending)
      return false;
    state.pending = true;
    try {
      if (chosenMode() === 'fixed' && state.fixed === null) {
        await changeFixed();
        if (state.fixed === null)
          return false;
      }
      const result = await preferences().set({
        outputFolder: { mode: chosenMode(), fixed: state.fixed },
        makeBackup: el.backup.checked,
        rememberToolValues: el.toolValues.checked,
        rememberLastTool: el.lastTool.checked,
      });
      if (result?.ok !== true) {
        root.SigK.viewBanner?.show(result?.error ?? '設定を書けませんでした。');
        return false;
      }
      close();
      return true;
    } finally {
      state.pending = false;
    }
  }

  // ほかの窓が開いているときは開かない（メニューの合図。保存の合図と同じ扱い）。
  function openUnlessDialog(doc) {
    return doc.querySelector('dialog[open]') === null && open();
  }

  function init(doc, win) {
    if (win.__sigkSettingsReady === true)
      return false;
    const dialog = doc.getElementById('settings-dialog');
    if (dialog === null)
      return false;
    win.__sigkSettingsReady = true;
    const byId = (id) => doc.getElementById(id);
    el = { doc, dialog, fixedPath: byId('settings-fixed-path'), backup: byId('settings-backup'), toolValues: byId('settings-tool-values'), lastTool: byId('settings-last-tool') };
    byId('settings-ok')?.addEventListener('click', () => confirm());
    byId('settings-cancel')?.addEventListener('click', () => close());
    byId('settings-close')?.addEventListener('click', () => close());
    byId('settings-fixed-change')?.addEventListener('click', (event) => {
      event.preventDefault();
      changeFixed();
    });
    byId('settings-default-apps')?.addEventListener('click', () => root.preferencesAPI?.openDefaultApps?.());
    byId('btn-settings')?.addEventListener('click', () => open());
    // Esc（cancel の合図）は書かずに閉じる。
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    root.preferencesAPI?.onOpenRequest?.(() => openUnlessDialog(doc));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.settingsDialog = { init, open, close, isOpen, confirm, changeFixed };
})(typeof window !== 'undefined' ? window : globalThis);
