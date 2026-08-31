'use strict';

// 設定の保存。JSON 1ファイル、アトミック書き込み。
// 壊れていたら既定値で起動し、エラーログに残す（spec-0 確定事項7）。
// このファイルは Electron を require しない。ディレクトリは呼び出し側が渡す。

const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_WINDOW, MIN_WINDOW } = require('./security-policy.js');

const DEFAULTS = {
  version: 1,
  window: { width: DEFAULT_WINDOW.width, height: DEFAULT_WINDOW.height, x: null, y: null, maximized: false },
  sidePanel: { open: true, width: 240 },
  mode: 'view',
};

const SIDE_PANEL_MIN = 180;
const SIDE_PANEL_MAX = 420;
const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function pickNullableNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function pickBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

// 型が合わないキーは既定値へ落とし、未知のキーは捨てる。
function mergeDefaults(raw) {
  if (!isPlainObject(raw))
    return structuredClone(DEFAULTS);

  const window = isPlainObject(raw.window) ? raw.window : {};
  const sidePanel = isPlainObject(raw.sidePanel) ? raw.sidePanel : {};

  return {
    version: DEFAULTS.version,
    window: {
      width: pickNumber(window.width, DEFAULTS.window.width),
      height: pickNumber(window.height, DEFAULTS.window.height),
      x: pickNullableNumber(window.x),
      y: pickNullableNumber(window.y),
      maximized: pickBoolean(window.maximized, DEFAULTS.window.maximized),
    },
    sidePanel: {
      open: pickBoolean(sidePanel.open, DEFAULTS.sidePanel.open),
      width: clampSidePanelWidth(pickNumber(sidePanel.width, DEFAULTS.sidePanel.width)),
    },
    mode: typeof raw.mode === 'string' ? raw.mode : DEFAULTS.mode,
  };
}

function clampSidePanelWidth(px) {
  if (!Number.isFinite(px))
    return DEFAULTS.sidePanel.width;
  return Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, Math.round(px)));
}

function overlapArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

// モニタを外した後などに、ウィンドウが画面の外へ復元されるのを防ぐ。
// どの作業領域とも十分に重ならなければ、最初の作業領域の中央へ寄せる。
function clampWindowBounds(bounds, workAreas = []) {
  const width = Math.max(MIN_WINDOW.width, pickNumber(bounds?.width, DEFAULTS.window.width));
  const height = Math.max(MIN_WINDOW.height, pickNumber(bounds?.height, DEFAULTS.window.height));
  const x = pickNullableNumber(bounds?.x);
  const y = pickNullableNumber(bounds?.y);

  if (workAreas.length === 0 || x === null || y === null)
    return { width, height, x: null, y: null };

  const candidate = { x, y, width, height };
  const visible = workAreas.some((area) => overlapArea(candidate, area) >= 80 * 80);
  if (visible)
    return candidate;

  const primary = workAreas[0];
  return {
    width: Math.min(width, primary.width),
    height: Math.min(height, primary.height),
    x: Math.round(primary.x + (primary.width - Math.min(width, primary.width)) / 2),
    y: Math.round(primary.y + (primary.height - Math.min(height, primary.height)) / 2),
  };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 一時ファイルへ書いてから rename で置換する。書きかけのファイルを残さない。
// Windows ではウイルス対策ソフト等がファイルを掴んでいると EPERM / EBUSY になるため再試行する。
function writeFileAtomic(filePath, text) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `${path.basename(filePath)}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);

  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(tmpPath, text, 'utf8');
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(tmpPath, filePath);
        return;
      } catch (err) {
        const retriable = err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES';
        if (!retriable || attempt >= RENAME_RETRIES - 1)
          throw err;
        sleepSync(RENAME_RETRY_DELAY_MS);
      }
    }
  } finally {
    if (fs.existsSync(tmpPath))
      fs.rmSync(tmpPath, { force: true });
  }
}

function createSettingsStore({ dir, fileName = 'settings.json', onError = () => {} } = {}) {
  if (!dir)
    throw new Error('createSettingsStore: dir が必要です');

  const filePath = path.join(dir, fileName);
  let current = structuredClone(DEFAULTS);

  function load() {
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch {
      // 初回起動。エラーではない。
      current = structuredClone(DEFAULTS);
      return current;
    }

    try {
      current = mergeDefaults(JSON.parse(text));
    } catch {
      onError({
        level: 'warn',
        message: '設定ファイルが壊れているため既定値で起動しました',
        context: { filePath },
      });
      current = structuredClone(DEFAULTS);
    }
    return current;
  }

  function get() {
    return current;
  }

  function set(patch) {
    current = mergeDefaults({ ...current, ...patch });
    return current;
  }

  function save() {
    try {
      writeFileAtomic(filePath, `${JSON.stringify(current, null, 2)}\n`);
      return true;
    } catch (err) {
      onError({ level: 'error', message: '設定の保存に失敗しました', stack: err.stack, context: { filePath } });
      return false;
    }
  }

  return { filePath, load, get, set, save };
}

module.exports = {
  DEFAULTS,
  SIDE_PANEL_MIN,
  SIDE_PANEL_MAX,
  mergeDefaults,
  clampSidePanelWidth,
  clampWindowBounds,
  writeFileAtomic,
  createSettingsStore,
};
