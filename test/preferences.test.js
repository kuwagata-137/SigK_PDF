'use strict';

// 設定の窓の値（preferences.js。spec-6-1 タスク E の確定事項E-4・E-6）。settings.json の preferences の欄に置き、メインが持つ。

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PREFERENCE_DEFAULTS, mergePreferences, applyPreferencesPatch, outputFolderOf, createPreferencesHost,
} = require('../preferences.js');
const { DEFAULTS, mergeDefaults } = require('../settings.js');

test('既定は、最初のフォルダが「元のファイルと同じフォルダ」、控えのファイルを作る、ツールの値と最後のツールを覚える（どれも今と同じ動き）', () => {
  assert.deepEqual(structuredClone(PREFERENCE_DEFAULTS), {
    outputFolder: { mode: 'source', fixed: null, last: null },
    makeBackup: true,
    rememberToolValues: true,
    rememberLastTool: true,
    toolValues: {},
    lastTool: null,
  });
  assert.deepEqual(DEFAULTS.preferences, structuredClone(PREFERENCE_DEFAULTS), 'settings.json の既定にも入る');
});

test('mergePreferences は、型の違う値・知らない値・相対パスを既定へ落とす', () => {
  const merged = mergePreferences({
    outputFolder: { mode: 'どこか', fixed: 'relative\\dir', last: 42 },
    makeBackup: 'yes',
    rememberToolValues: false,
    toolValues: { watermark: { text: '社外秘' }, unknownTool: { a: 1 }, split: 'seq' },
    lastTool: 'paint',
    extra: true,
  });
  assert.deepEqual(merged, {
    outputFolder: { mode: 'source', fixed: null, last: null },
    makeBackup: true,
    rememberToolValues: false,
    rememberLastTool: true,
    toolValues: { watermark: { text: '社外秘' } },
    lastTool: null,
  });
  assert.deepEqual(mergePreferences(undefined), structuredClone(PREFERENCE_DEFAULTS), '古い settings.json に欄が無ければ既定');
});

test('settings.json の読み込み（mergeDefaults）も preferences の欄を確かめて残す', () => {
  const settings = mergeDefaults({ preferences: { outputFolder: { mode: 'fixed', fixed: 'D:\\out', last: null }, lastTool: 'split' } });
  assert.equal(settings.preferences.outputFolder.mode, 'fixed');
  assert.equal(settings.preferences.outputFolder.fixed, 'D:\\out');
  assert.equal(settings.preferences.lastTool, 'split');
});

test('applyPreferencesPatch は差分だけを当てる（最初のフォルダの欄とツールの値は、ツールごと・欄ごとに重ねる）', () => {
  const current = mergePreferences({ outputFolder: { mode: 'last', fixed: 'D:\\out', last: 'C:\\work' }, toolValues: { split: { rule: 'pages' } } });
  const next = applyPreferencesPatch(current, { outputFolder: { last: 'E:\\new' }, toolValues: { watermark: { text: '控え' } }, makeBackup: false });
  assert.deepEqual(next.outputFolder, { mode: 'last', fixed: 'D:\\out', last: 'E:\\new' });
  assert.deepEqual(next.toolValues, { split: { rule: 'pages' }, watermark: { text: '控え' } });
  assert.equal(next.makeBackup, false);
  assert.equal(current.makeBackup, true, '元は変えない');
});

test('ツールの値が大きすぎれば捨てる（設定のファイルを膨らませない）', () => {
  const merged = mergePreferences({ toolValues: { watermark: { text: 'あ'.repeat(5000) } } });
  assert.deepEqual(merged.toolValues, {});
});

test('outputFolderOf は、ユーザーのファイルへ書く実行の行き先のフォルダを返し、書かない実行は null', () => {
  assert.equal(outputFolderOf({ kind: 'save', target: 'C:\\work\\a.pdf' }), 'C:\\work');
  assert.equal(outputFolderOf({ target: 'C:\\work\\a.pdf' }), 'C:\\work', 'kind が無いのは保存');
  for (const kind of ['extract', 'merge', 'watermark', 'flatten'])
    assert.equal(outputFolderOf({ kind, target: 'D:\\out\\x.pdf' }), 'D:\\out', kind);
  assert.equal(outputFolderOf({ kind: 'split', targets: ['E:\\parts\\a_001.pdf', 'E:\\parts\\a_002.pdf'] }), 'E:\\parts');
  assert.equal(outputFolderOf({ kind: 'convert', target: 'F:\\img\\all.pdf' }), 'F:\\img');
  assert.equal(outputFolderOf({ kind: 'convert', targets: ['F:\\img\\a.pdf'] }), 'F:\\img');
  for (const kind of ['copy-pages', 'insert-preview', 'flatten-preview', 'annotation-details', 'page-boxes'])
    assert.equal(outputFolderOf({ kind, target: 'C:\\work\\a.pdf' }), null, kind);
});

// settings.js の createSettingsStore の代わり。
function fakeSettings(initial = {}) {
  let current = mergeDefaults(initial);
  let saves = 0;
  return { get: () => current, set: (patch) => { current = mergeDefaults({ ...current, ...patch }); return current; }, save: () => { saves += 1; return true; }, saves: () => saves };
}

test('createPreferencesHost: snapshot は値と、今あるフォルダ（最後に書き出したフォルダ・決めたフォルダ）を返す', () => {
  const settings = fakeSettings({ preferences: { outputFolder: { mode: 'last', fixed: 'D:\\gone', last: 'C:\\work' } } });
  const host = createPreferencesHost({ settings, isDirectory: (folder) => folder === 'C:\\work' });
  assert.deepEqual(host.snapshot().available, { last: 'C:\\work', fixed: null });
  assert.equal(host.snapshot().preferences.outputFolder.mode, 'last');
});

test('createPreferencesHost: set は差分を当てて書き、確かめた全体を返す', () => {
  const settings = fakeSettings();
  const host = createPreferencesHost({ settings, isDirectory: () => true });
  const snapshot = host.set({ makeBackup: false, outputFolder: { mode: 'fixed', fixed: 'D:\\out' } });
  assert.equal(snapshot.preferences.makeBackup, false);
  assert.equal(settings.get().preferences.outputFolder.fixed, 'D:\\out');
  assert.equal(settings.saves(), 1);
});

test('createPreferencesHost: 書き出しに成功したら、行き先のフォルダを「最後に書き出したフォルダ」として覚え、画面へ知らせる', () => {
  const settings = fakeSettings();
  const notified = [];
  const host = createPreferencesHost({ settings, isDirectory: () => true, notify: (snapshot) => notified.push(snapshot) });
  host.rememberOutput({ kind: 'merge', target: 'D:\\out\\m.pdf' }, { ok: true });
  assert.equal(settings.get().preferences.outputFolder.last, 'D:\\out');
  assert.equal(notified.length, 1);
  host.rememberOutput({ kind: 'merge', target: 'D:\\out\\m2.pdf' }, { ok: true });
  assert.equal(notified.length, 1, '同じフォルダなら書かず、知らせない');
  host.rememberOutput({ kind: 'merge', target: 'E:\\x\\m.pdf' }, { error: '書けない' });
  assert.equal(settings.get().preferences.outputFolder.last, 'D:\\out', '失敗は覚えない');
  host.rememberWritten('F:\\images\\a_001.png');
  assert.equal(settings.get().preferences.outputFolder.last, 'F:\\images', 'PDF→画像の画像の書き込みも覚える');
  assert.equal(settings.saves(), 2);
});
