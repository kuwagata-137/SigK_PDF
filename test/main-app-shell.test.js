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

test('メニュー「ヘルプ」は 使い方・既定のアプリの設定…・区切り・バージョン情報 の順で、起動確認が見張る並びと同じ', () => {
  const order = helpMenuOrder();
  assert.deepEqual(order, ['使い方', '既定のアプリの設定…', '-', 'バージョン情報']);
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
