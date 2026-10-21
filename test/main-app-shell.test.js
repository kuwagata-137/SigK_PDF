'use strict';

// main.js の、メニュー「ヘルプ」とアプリのアイコンの配線（docs/spec-5-2-open-with-icon.md 確定事項B6・C1・C2・E1）。
// main.js は Electron なしでは読み込めないので、文字で見る。押したときの処理そのものは default-apps-link.test.js が見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// buildAppMenu の「ヘルプ」の submenu の中身（項目の名前と区切り）を、書いてある順に拾う。
function helpMenuOrder() {
  const start = MAIN.indexOf("label: 'ヘルプ',");
  const block = MAIN.slice(start, MAIN.indexOf('],', start));
  return [...block.matchAll(/\{ (?:label: '([^']+)'|type: 'separator')/g)].map((m) => m[1] ?? '-');
}

test('メニュー「ヘルプ」は 使い方・既定のアプリの設定…・エラーの記録のフォルダを開く・区切り・バージョン情報 の順で、起動確認が見張る並びと同じ', () => {
  const order = helpMenuOrder();
  assert.deepEqual(order, ['使い方', '既定のアプリの設定…', 'エラーの記録のフォルダを開く', '-', 'バージョン情報']);
  const watched = /const HELP_MENU_ORDER = (\[[^\]]+\]);/.exec(MAIN)[1];
  assert.deepEqual(JSON.parse(watched.replace(/'/g, '"')), order);
});

test('「既定のアプリの設定…」を押すと、製品名を渡して default-apps-link.js の openDefaultAppsSettings を呼ぶ', () => {
  assert.match(MAIN, /\{ label: '既定のアプリの設定…', click: requestDefaultAppsSettings \}/);
  assert.match(MAIN, /function requestDefaultAppsSettings\(\) \{\n {2}openDefaultAppsSettings\(\{ shell, appName: app\.getName\(\), logError \}\);\n\}/);
  assert.match(MAIN, /const \{ openDefaultAppsSettings \} = require\('\.\/default-apps-link\.js'\);/);
  // shell は Electron のもの（起動確認の中の同じ名前の変数ではない）。
  assert.match(MAIN, /^const \{[^}]*\bshell\b[^}]*\} = require\('electron'\);/m);
});

test('「エラーの記録のフォルダを開く」を押すと、記録のフォルダを渡して log-folder.js の openLogFolder を呼ぶ（spec-6-1 タスク B。決定81 ⑧）', () => {
  assert.match(MAIN, /\{ label: 'エラーの記録のフォルダを開く', click: requestLogFolder \}/);
  assert.match(MAIN, /function requestLogFolder\(\) \{\n {2}openLogFolder\(\{ dir: path\.dirname\(errorLog\.filePath\), shell, logError \}\);\n\}/);
  assert.match(MAIN, /const \{ openLogFolder \} = require\('\.\/log-folder\.js'\);/);
});

// 画面の処理が止まったときと、終了まわりの状態（spec-6-1 タスク B の B2 と点検の直し）。main.js は Electron なしでは読めないので文字で見る。
test('画面の処理が止まったら、保存していない変更の数と起動の要求の受け取りの印を戻してから、renderer-gone.js へ渡す', () => {
  const body = /function onRendererGone\(win\) \{([\s\S]*?)\n\}/.exec(MAIN)?.[1] ?? '';
  assert.match(body, /dirtyTabCount = 0;/);
  assert.match(body, /launchReady = false;/, '開き直した画面が shell:ready を送るまで、エクスプローラーから開いたファイルをためておく（確定事項77）');
  assert.match(body, /handleRendererGone\(\{ win, dialog, app, logError, smoke: process\.env\.SIGK_SMOKE === '1', quitting \}\)/);
  assert.match(MAIN, /watchWebContents\(win\.webContents, logError, \(\) => onRendererGone\(win\)\);/);
});

test('「終えている途中」の印は before-quit と Windows の終わり（session-end）で立て、閉じる前の確認へ回したときは戻す', () => {
  assert.match(MAIN, /app\.on\('before-quit', \(\) => \{\n {2}quitting = true;/);
  assert.match(MAIN, /win\.on\('session-end', \(\) => \{\n {4}quitting = true;\n {2}\}\);/);
  const closeBlock = /if \(!allowClose && dirtyTabCount > 0 && canAsk\) \{([\s\S]*?)\n {4}\}/.exec(MAIN)?.[1] ?? '';
  assert.match(closeBlock, /quitting = false;/, '確認で取りやめられたら終わらないので、印を戻す');
  assert.match(closeBlock, /event\.preventDefault\(\);/);
});

test('窓とバージョン情報に、assets/icon.ico を使う', () => {
  assert.match(MAIN, /const APP_ICON_PATH = path\.join\(ROOT_DIR, 'assets', 'icon\.ico'\);/);
  assert.match(MAIN, /new BrowserWindow\(\{[\s\S]*?\n {4}icon: APP_ICON_PATH,\n[\s\S]*?\}\);/);
  assert.match(MAIN, /function showAboutDialog\(\) \{[\s\S]*?icon: nativeImage\.createFromPath\(APP_ICON_PATH\),[\s\S]*?\n\}/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'icon.ico')));
});

test('起動確認の報告に appShell を載せる', () => {
  assert.match(MAIN, /const appShell = readAppShellState\(problems\);/);
  assert.match(MAIN, /\n {8}appShell,\n/);
});

// 設定の窓の値（spec-6-1 タスク E の確定事項E-4・E-6）。main.js は Electron なしでは読めないので文字で見る。
test('設定の窓の値の受け口（preferences:get・set）と、書き出しに成功したときに最後に書き出したフォルダを覚える配線がある', () => {
  // フォルダが今あるかの確かめは非同期（点検の直し I-5）なので、受け口は待ってから返す。
  assert.match(MAIN, /ipcMain\.handle\('preferences:get', async \(\) => \(\{ ok: true, \.\.\.\(await preferences\.snapshot\(\)\) \}\)\);/);
  assert.match(MAIN, /ipcMain\.handle\('preferences:set', async \(_event, patch\) => \(\{ ok: true, \.\.\.\(await preferences\.set\(patch\)\) \}\)\);/);
  assert.match(MAIN, /preferences\.rememberOutput\(spec, result\);/, 'ワーカーの書き出し');
  assert.match(MAIN, /if \(result\?\.ok === true\)\r?\n {6}preferences\.rememberWritten\(target\);/, 'PDF→画像の画像の書き込み');
  assert.match(MAIN, /preferences = createPreferencesHost\(\{ settings, logError, notify: \(snapshot\) => mainWindow\?\.webContents\.send\('preferences:changed', snapshot\) \}\);/);
});

test('メニュー「ファイル」の「文書情報…」の下に「設定…」（Ctrl＋,）があり、押すと画面へ合図を送る（spec-6-1 確定事項E-1）', () => {
  assert.match(MAIN, /\{ label: '文書情報…', accelerator: 'CmdOrCtrl\+I', click: requestDocInfo \},\n {8}\{ label: '設定…', accelerator: 'CmdOrCtrl\+,', click: requestSettings \},/);
  assert.match(MAIN, /function requestSettings\(\) \{\n {2}mainWindow\?\.webContents\.send\('preferences:openRequest'\);\n\}/);
  assert.match(MAIN, /ipcMain\.handle\('preferences:openDefaultApps', \(\) => requestDefaultAppsSettings\(\)\);/, '窓の［Windows の設定を開く］は、メニューの「既定のアプリの設定…」と同じ所');
});
