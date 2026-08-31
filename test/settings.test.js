'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULTS,
  SIDE_PANEL_MIN,
  SIDE_PANEL_MAX,
  mergeDefaults,
  clampSidePanelWidth,
  clampWindowBounds,
  writeFileAtomic,
  createSettingsStore,
} = require('../settings.js');

// テストは既定で並列に走るため、各テストが自分専用のディレクトリを取る。
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-settings-'));
}

test('既定値はウィンドウ 1280x800・サイドパネルは開いた状態', () => {
  assert.equal(DEFAULTS.window.width, 1280);
  assert.equal(DEFAULTS.window.height, 800);
  assert.equal(DEFAULTS.sidePanel.open, true);
  assert.equal(DEFAULTS.mode, 'view');
});

test('mergeDefaults はオブジェクト以外を既定値に落とす', () => {
  for (const raw of [null, undefined, 42, 'text', [], true])
    assert.deepEqual(mergeDefaults(raw), DEFAULTS);
});

test('mergeDefaults は型の合わないキーを既定値に落とす', () => {
  const merged = mergeDefaults({
    window: { width: 'wide', height: 900, x: null, y: 'top', maximized: 'yes' },
    sidePanel: { open: 1, width: 300 },
    mode: 42,
  });

  assert.equal(merged.window.width, DEFAULTS.window.width);
  assert.equal(merged.window.height, 900);
  assert.equal(merged.window.y, null);
  assert.equal(merged.window.maximized, DEFAULTS.window.maximized);
  assert.equal(merged.sidePanel.open, DEFAULTS.sidePanel.open);
  assert.equal(merged.sidePanel.width, 300);
  assert.equal(merged.mode, DEFAULTS.mode);
});

test('mergeDefaults は未知のキーを捨てる', () => {
  const merged = mergeDefaults({ mode: 'pages', secretToken: 'x', window: { width: 1000, evil: true } });

  assert.equal('secretToken' in merged, false);
  assert.equal('evil' in merged.window, false);
  assert.equal(merged.mode, 'pages');
});

test('clampSidePanelWidth は 180〜420 に丸める', () => {
  assert.equal(clampSidePanelWidth(10), SIDE_PANEL_MIN);
  assert.equal(clampSidePanelWidth(SIDE_PANEL_MIN), SIDE_PANEL_MIN);
  assert.equal(clampSidePanelWidth(240), 240);
  assert.equal(clampSidePanelWidth(SIDE_PANEL_MAX), SIDE_PANEL_MAX);
  assert.equal(clampSidePanelWidth(9999), SIDE_PANEL_MAX);
  assert.equal(clampSidePanelWidth(Number.NaN), DEFAULTS.sidePanel.width);
});

test('clampWindowBounds は最小サイズを下回らせない', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }];

  const bounds = clampWindowBounds({ width: 100, height: 100, x: 10, y: 10 }, areas);

  assert.equal(bounds.width, 960);
  assert.equal(bounds.height, 600);
});

test('clampWindowBounds は画面に残っている位置をそのまま返す', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }];

  const bounds = clampWindowBounds({ width: 1280, height: 800, x: 100, y: 60 }, areas);

  assert.deepEqual(bounds, { width: 1280, height: 800, x: 100, y: 60 });
});

test('clampWindowBounds は画面外の位置を主ディスプレイの中央へ寄せる', () => {
  // モニタを外した後の起動を想定する。
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }];

  const bounds = clampWindowBounds({ width: 1280, height: 800, x: 4000, y: 2000 }, areas);

  assert.equal(bounds.x, Math.round((1920 - 1280) / 2));
  assert.equal(bounds.y, Math.round((1040 - 800) / 2));
});

test('clampWindowBounds は作業領域が無ければ位置を捨てる', () => {
  const bounds = clampWindowBounds({ width: 1280, height: 800, x: 100, y: 60 }, []);

  assert.equal(bounds.x, null);
  assert.equal(bounds.y, null);
});

test('writeFileAtomic は一時ファイルを残さない', () => {
  const dir = makeTempDir();
  const target = path.join(dir, 'settings.json');

  writeFileAtomic(target, '{"a":1}');
  writeFileAtomic(target, '{"a":2}');

  assert.equal(fs.readFileSync(target, 'utf8'), '{"a":2}');
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('初回起動では設定ファイルが無くても既定値を返す', () => {
  const store = createSettingsStore({ dir: makeTempDir() });

  assert.deepEqual(store.load(), DEFAULTS);
});

test('保存した設定は次のストアで読み戻せる', () => {
  const dir = makeTempDir();
  const store = createSettingsStore({ dir });
  store.load();
  store.set({ mode: 'pages', window: { width: 1400, height: 900, x: 20, y: 30, maximized: true } });

  assert.equal(store.save(), true);

  const reopened = createSettingsStore({ dir });
  const loaded = reopened.load();
  assert.equal(loaded.mode, 'pages');
  assert.equal(loaded.window.width, 1400);
  assert.equal(loaded.window.maximized, true);
});

test('BOM 付きで保存された設定も読める', () => {
  const dir = makeTempDir();
  const content = `﻿${JSON.stringify({ mode: 'pages', sidePanel: { open: false, width: 300 } })}`;
  fs.writeFileSync(path.join(dir, 'settings.json'), content, 'utf8');
  const reported = [];
  const store = createSettingsStore({ dir, onError: (entry) => reported.push(entry) });

  const loaded = store.load();

  assert.equal(loaded.mode, 'pages');
  assert.equal(loaded.sidePanel.open, false);
  assert.deepEqual(reported, [], 'BOM を壊れたファイルとして扱ってはいけない');
});

test('壊れた JSON では例外を投げず、既定値で起動して onError を呼ぶ', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ this is not json', 'utf8');
  const reported = [];
  const store = createSettingsStore({ dir, onError: (entry) => reported.push(entry) });

  const loaded = store.load();

  assert.deepEqual(loaded, DEFAULTS);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].level, 'warn');
  assert.equal(reported[0].context.filePath, store.filePath);
});

test('createSettingsStore は dir が無いと落ちる', () => {
  assert.throws(() => createSettingsStore({}), /dir/);
});
