'use strict';

// 設定の窓の値（spec-6-1 タスク E。確定事項E-2・E-4・E-6）。settings.json の preferences の欄に置き、メインが持つ。
// 中身の確かめ（mergePreferences）は settings.js の mergeDefaults から呼ぶ（annotation-settings.js と同じ形）。
// 「最後に書き出したフォルダ」は、書き出しに成功したときにメインが覚え、画面へ知らせる（createPreferencesHost）。
// このファイルは Electron を読まない（テストから直に呼ぶ）。

const fs = require('node:fs');
const path = require('node:path');

const FOLDER_MODES = ['source', 'last', 'fixed'];
// renderer/tools.js の TOOLS の id と同じ並び。
const TOOL_IDS = ['merge', 'split', 'convert', 'toImage', 'watermark', 'flatten'];
const PATH_MAX = 1024;
// 1 つのツールの覚える値の上限（JSON にした字数）。設定のファイルを膨らませない。
const TOOL_VALUES_MAX = 4000;

const PREFERENCE_DEFAULTS = Object.freeze({
  outputFolder: Object.freeze({ mode: 'source', fixed: null, last: null }),
  makeBackup: true,
  rememberToolValues: true,
  rememberLastTool: true,
  toolValues: Object.freeze({}),
  lastTool: null,
});

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const pickBoolean = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

// Windows の絶対パスだけを受ける（相対パス・長すぎるものは捨てる）。
function pickFolder(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= PATH_MAX && path.win32.isAbsolute(value) ? value : null;
}

function pickToolValues(raw) {
  const values = {};
  if (!isPlainObject(raw))
    return values;
  for (const id of TOOL_IDS) {
    const value = raw[id];
    if (isPlainObject(value) && JSON.stringify(value).length <= TOOL_VALUES_MAX)
      values[id] = structuredClone(value);
  }
  return values;
}

// 型が合わない値・知らない値は既定へ落とす。
function mergePreferences(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const folder = isPlainObject(source.outputFolder) ? source.outputFolder : {};
  return {
    outputFolder: {
      mode: FOLDER_MODES.includes(folder.mode) ? folder.mode : PREFERENCE_DEFAULTS.outputFolder.mode,
      fixed: pickFolder(folder.fixed),
      last: pickFolder(folder.last),
    },
    makeBackup: pickBoolean(source.makeBackup, PREFERENCE_DEFAULTS.makeBackup),
    rememberToolValues: pickBoolean(source.rememberToolValues, PREFERENCE_DEFAULTS.rememberToolValues),
    rememberLastTool: pickBoolean(source.rememberLastTool, PREFERENCE_DEFAULTS.rememberLastTool),
    toolValues: pickToolValues(source.toolValues),
    lastTool: TOOL_IDS.includes(source.lastTool) ? source.lastTool : null,
  };
}

// 差分だけを当てる。最初のフォルダの欄は欄ごとに、ツールの値はツールごとに重ねる。元は変えない。
function applyPreferencesPatch(current, patch) {
  const base = mergePreferences(current);
  if (!isPlainObject(patch))
    return base;
  return mergePreferences({
    ...base,
    ...patch,
    outputFolder: { ...base.outputFolder, ...(isPlainObject(patch.outputFolder) ? patch.outputFolder : {}) },
    toolValues: { ...base.toolValues, ...(isPlainObject(patch.toolValues) ? patch.toolValues : {}) },
  });
}

// ユーザーのファイルへ書く実行の kind（保存は kind を持たないこともある）。下見・読み取り・写しは書かない。
const WRITING_KINDS = new Set(['save', 'extract', 'merge', 'split', 'convert', 'watermark', 'flatten']);

// 実行の行き先のフォルダ。書かない実行は null。
function outputFolderOf(spec) {
  const kind = spec?.kind ?? 'save';
  if (!WRITING_KINDS.has(kind))
    return null;
  const target = typeof spec?.target === 'string' ? spec.target : Array.isArray(spec?.targets) ? spec.targets[0] : null;
  return typeof target === 'string' && target.length > 0 ? path.win32.dirname(target) : null;
}

// メインが持つ口。settings は settings.js の createSettingsStore の戻り値。isDirectory(folder) はフォルダが今あるか。
// notify(snapshot) は画面へ知らせる（preferences:changed）。
function createPreferencesHost({ settings, isDirectory = isExistingDirectory, notify = () => {} }) {
  const current = () => mergePreferences(settings.get().preferences);

  function snapshot() {
    const preferences = current();
    const exists = (folder) => (folder !== null && isDirectory(folder) ? folder : null);
    return { preferences, available: { last: exists(preferences.outputFolder.last), fixed: exists(preferences.outputFolder.fixed) } };
  }

  function set(patch) {
    settings.set({ preferences: applyPreferencesPatch(current(), patch) });
    settings.save();
    return snapshot();
  }

  // 書いたファイルのフォルダを「最後に書き出したフォルダ」として覚える（確定事項E-6）。同じなら書かない。
  function rememberWritten(filePath) {
    const folder = typeof filePath === 'string' && filePath.length > 0 ? path.win32.dirname(filePath) : null;
    if (folder === null || current().outputFolder.last === folder)
      return false;
    notify(set({ outputFolder: { last: folder } }));
    return true;
  }

  function rememberOutput(spec, result) {
    const folder = result?.ok === true ? outputFolderOf(spec) : null;
    return folder === null ? false : rememberWritten(path.win32.join(folder, '_'));
  }

  return { snapshot, set, rememberWritten, rememberOutput };
}

// フォルダが今あるか（createPreferencesHost の isDirectory の既定）。
function isExistingDirectory(folder) {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

module.exports = {
  FOLDER_MODES, TOOL_IDS, TOOL_VALUES_MAX, PREFERENCE_DEFAULTS,
  mergePreferences, applyPreferencesPatch, outputFolderOf, createPreferencesHost, isExistingDirectory,
};
