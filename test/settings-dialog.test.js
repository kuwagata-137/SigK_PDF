'use strict';

// 設定の窓（renderer/settings-dialog.js）と、設定の値の写し（renderer/preferences.js）。spec-6-1 タスク E の確定事項E-1〜E-5。
// 見本 screenshots/phase6-mock-settings-window.png。値の持ち主はメイン（preferences.js）で、土台はメインと同じ確かめ方で控える。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

const D_OUT = 'D:\\out';
const C_WORK = 'C:\\work';

async function withShell(t, options = {}) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  await shell.flush();
  return shell;
}

const byId = (shell, id) => shell.document.getElementById(id);
const checkedMode = (shell) => shell.document.querySelector('input[name="settings-folder"]:checked')?.value ?? null;
const isOpen = (shell) => shell.SigK.settingsDialog.isOpen();

test('歯車のボタンで開き、今の値を欄へ写す（既定はどれも今と同じ動き）。フォーカスは選んでいる最初のフォルダの選択肢', async (t) => {
  const shell = await withShell(t);
  byId(shell, 'btn-settings').click();
  assert.equal(isOpen(shell), true);
  assert.equal(checkedMode(shell), 'source');
  assert.equal(byId(shell, 'settings-fixed-path').textContent, 'まだ決めていません');
  assert.equal(byId(shell, 'settings-backup').checked, true);
  assert.equal(byId(shell, 'settings-tool-values').checked, true);
  assert.equal(byId(shell, 'settings-last-tool').checked, true);
  assert.equal(shell.document.activeElement, shell.document.querySelector('input[name="settings-folder"][value="source"]'));
});

test('覚えている値（最後に書き出したフォルダ・控えのファイルを作らない など）を欄へ写す', async (t) => {
  const shell = await withShell(t, { preferences: { outputFolder: { mode: 'fixed', fixed: D_OUT }, makeBackup: false, rememberLastTool: false } });
  shell.SigK.settingsDialog.open();
  assert.equal(checkedMode(shell), 'fixed');
  assert.equal(byId(shell, 'settings-fixed-path').textContent, D_OUT);
  assert.equal(byId(shell, 'settings-backup').checked, false);
  assert.equal(byId(shell, 'settings-last-tool').checked, false);
  assert.equal(shell.document.activeElement, shell.document.querySelector('input[name="settings-folder"][value="fixed"]'));
});

test('［OK］で欄の値を書いて閉じる', async (t) => {
  const shell = await withShell(t);
  shell.SigK.settingsDialog.open();
  shell.document.querySelector('input[name="settings-folder"][value="last"]').checked = true;
  byId(shell, 'settings-backup').checked = false;
  byId(shell, 'settings-tool-values').checked = false;
  assert.equal(await shell.SigK.settingsDialog.confirm(), true);
  assert.equal(isOpen(shell), false);
  assert.deepEqual(shell.preferencesCalls, [{ outputFolder: { mode: 'last', fixed: null }, makeBackup: false, rememberToolValues: false, rememberLastTool: true }]);
  assert.equal(shell.savedPreferences().outputFolder.mode, 'last');
  assert.equal(shell.SigK.preferences.current().makeBackup, false, '写しも書いた値になる');
});

test('［キャンセル］と × は書かずに閉じ、次に開いたときは覚えている値に戻っている', async (t) => {
  const shell = await withShell(t);
  for (const id of ['settings-cancel', 'settings-close']) {
    shell.SigK.settingsDialog.open();
    byId(shell, 'settings-backup').checked = false;
    byId(shell, id).click();
    assert.equal(isOpen(shell), false, id);
  }
  assert.deepEqual(shell.preferencesCalls, []);
  shell.SigK.settingsDialog.open();
  assert.equal(byId(shell, 'settings-backup').checked, true);
});

test('［変更…］でフォルダを選ぶと、決めたフォルダの欄に入り、その選択肢を選ぶ。［OK］でそのフォルダを書く', async (t) => {
  const shell = await withShell(t, { folderResults: [{ path: D_OUT }] });
  shell.SigK.settingsDialog.open();
  byId(shell, 'settings-fixed-change').click();
  await shell.flush();
  assert.equal(byId(shell, 'settings-fixed-path').textContent, D_OUT);
  assert.equal(checkedMode(shell), 'fixed');
  assert.equal(shell.folderCalls[0].title, '決めたフォルダを選ぶ');
  await shell.SigK.settingsDialog.confirm();
  assert.deepEqual(shell.preferencesCalls[0].outputFolder, { mode: 'fixed', fixed: D_OUT });
});

test('「決めたフォルダ」を選んでフォルダが空のまま［OK］を押すと、フォルダを選ぶ窓を出し、取りやめたら書かずに開いたまま', async (t) => {
  const shell = await withShell(t, { folderResults: [{ canceled: true }] });
  shell.SigK.settingsDialog.open();
  shell.document.querySelector('input[name="settings-folder"][value="fixed"]').checked = true;
  assert.equal(await shell.SigK.settingsDialog.confirm(), false);
  assert.equal(shell.folderCalls.length, 1);
  assert.equal(isOpen(shell), true);
  assert.deepEqual(shell.preferencesCalls, []);
});

test('［Windows の設定を開く］は、メニュー「ヘルプ」の「既定のアプリの設定…」と同じ所を開く口を呼ぶ', async (t) => {
  const shell = await withShell(t);
  shell.SigK.settingsDialog.open();
  byId(shell, 'settings-default-apps').click();
  assert.equal(shell.defaultAppsCalls.length, 1);
});

test('メニュー「ファイル」→「設定…」の合図で開く。ほかの窓が開いているときは開かない', async (t) => {
  const shell = await withShell(t);
  shell.fireSettingsRequest();
  assert.equal(isOpen(shell), true);
  shell.SigK.settingsDialog.close();
  byId(shell, 'doc-info').setAttribute('open', '');
  shell.fireSettingsRequest();
  assert.equal(isOpen(shell), false);
});

test('最初のフォルダ: 「元のファイルと同じフォルダ」は呼び出し側のフォルダ、ほかは今あるときだけそのフォルダ（無ければ元のファイルと同じフォルダ）', async (t) => {
  const last = await withShell(t, { preferences: { outputFolder: { mode: 'last', last: D_OUT } }, existingFolders: [D_OUT] });
  assert.equal(last.SigK.preferences.initialFolder(C_WORK), D_OUT);
  assert.equal(last.SigK.preferences.initialPath(`${C_WORK}\\a_抽出.pdf`), `${D_OUT}\\a_抽出.pdf`);
  const gone = await withShell(t, { preferences: { outputFolder: { mode: 'fixed', fixed: D_OUT } } });
  assert.equal(gone.SigK.preferences.initialFolder(C_WORK), C_WORK, '決めたフォルダが無くなっていたら元のファイルと同じフォルダ');
  const source = await withShell(t, { preferences: { outputFolder: { mode: 'source', last: D_OUT } }, existingFolders: [D_OUT] });
  assert.equal(source.SigK.preferences.initialPath(`${C_WORK}\\a.pdf`), `${C_WORK}\\a.pdf`);
});

test('メインが「最後に書き出したフォルダ」を覚えたら（知らせ）、写しも替わる', async (t) => {
  const shell = await withShell(t, { preferences: { outputFolder: { mode: 'last' } }, existingFolders: [D_OUT] });
  assert.equal(shell.SigK.preferences.initialFolder(C_WORK), C_WORK);
  shell.firePreferencesChanged({ outputFolder: { last: D_OUT } });
  assert.equal(shell.SigK.preferences.initialFolder(C_WORK), D_OUT);
});

test('Esc（窓の cancel の合図）は書かずに閉じる', async (t) => {
  const shell = await withShell(t);
  shell.SigK.settingsDialog.open();
  byId(shell, 'settings-backup').checked = false;
  byId(shell, 'settings-dialog').dispatchEvent(new shell.window.Event('cancel', { cancelable: true }));
  assert.equal(isOpen(shell), false);
  assert.deepEqual(shell.preferencesCalls, []);
});
