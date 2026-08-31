'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  APP_ORIGIN,
  APP_INDEX_URL,
  PRIVILEGED_SCHEME,
  CSP_DIRECTIVES,
  CSP_STRING,
  buildWebPreferences,
  isAllowedRequest,
  isAllowedNavigation,
  resolveAppPath,
  contentTypeFor,
} = require('../security-policy.js');

const ROOT = path.resolve(__dirname, '..');

test('buildWebPreferences はレンダラーを閉じ込める設定を返す', () => {
  const prefs = buildWebPreferences({ preloadPath: 'C:\\app\\preload.js' });

  assert.equal(prefs.preload, 'C:\\app\\preload.js');
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.nodeIntegrationInWorker, false);
  assert.equal(prefs.nodeIntegrationInSubFrames, false);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.allowRunningInsecureContent, false);
  assert.equal(prefs.webviewTag, false);
});

test('app:// は標準スキームかつセキュアとして登録される', () => {
  assert.equal(PRIVILEGED_SCHEME.scheme, 'app');
  assert.equal(PRIVILEGED_SCHEME.privileges.standard, true);
  assert.equal(PRIVILEGED_SCHEME.privileges.secure, true);
  assert.equal(PRIVILEGED_SCHEME.privileges.supportFetchAPI, true);
});

test('isAllowedRequest は app: と devtools: だけを通す', () => {
  const allowed = [
    'app://sigk/index.html',
    'app://sigk/renderer/app.js',
    'devtools://devtools/bundled/inspector.html',
  ];
  // file: も拒否する。レンダラーはファイルを直接読まないため許す必要がない。
  const denied = [
    'file:///C:/Users/x/secret.pdf',
    'https://example.com/a.js',
    'http://localhost:3000/',
    'ws://localhost:9229/',
    'chrome-extension://abcdef/background.js',
    'data:text/html,<h1>x</h1>',
    'about:blank',
    '',
    'not a url',
    null,
    undefined,
  ];

  for (const url of allowed)
    assert.equal(isAllowedRequest(url), true, `${url} は許可されるべき`);
  for (const url of denied)
    assert.equal(isAllowedRequest(url), false, `${url} は拒否されるべき`);
});

test('isAllowedNavigation はアプリ内のオリジンだけを通す', () => {
  assert.equal(isAllowedNavigation(APP_INDEX_URL), true);
  assert.equal(isAllowedNavigation(`${APP_ORIGIN}/renderer/app.js`), true);
  assert.equal(isAllowedNavigation('app://other/index.html'), false);
  assert.equal(isAllowedNavigation('https://example.com/'), false);
  assert.equal(isAllowedNavigation('devtools://devtools/bundled/inspector.html'), false);
  assert.equal(isAllowedNavigation(''), false);
});

test('CSP はインラインスクリプトを禁じ、必要な指令をすべて含む', () => {
  const expected = [
    'default-src', 'script-src', 'style-src', 'img-src', 'font-src',
    'connect-src', 'object-src', 'base-uri', 'form-action', 'frame-ancestors',
  ];

  for (const directive of expected)
    assert.ok(CSP_DIRECTIVES.some((line) => line.startsWith(`${directive} `)), `${directive} が無い`);

  const scriptSrc = CSP_DIRECTIVES.find((line) => line.startsWith('script-src '));
  assert.equal(scriptSrc.includes("'unsafe-inline'"), false, 'script-src にインラインを許してはいけない');
  assert.equal(scriptSrc.includes("'unsafe-eval'"), false, 'script-src に eval を許してはいけない');

  // style-src だけは要素の style 属性のために 'unsafe-inline' を許す。
  const styleSrc = CSP_DIRECTIVES.find((line) => line.startsWith('style-src '));
  assert.ok(styleSrc.includes("'unsafe-inline'"));

  assert.equal(CSP_STRING, CSP_DIRECTIVES.join('; '));
});

test('resolveAppPath は app:// のパスをアプリ内のファイルへ写す', () => {
  assert.equal(resolveAppPath(ROOT, APP_INDEX_URL), path.join(ROOT, 'index.html'));
  assert.equal(resolveAppPath(ROOT, `${APP_ORIGIN}/renderer/app.js`), path.join(ROOT, 'renderer', 'app.js'));
  // ルートは index.html に写す。
  assert.equal(resolveAppPath(ROOT, `${APP_ORIGIN}/`), path.join(ROOT, 'index.html'));
});

test('resolveAppPath はホストとスキームの違うものを拒む', () => {
  const denied = [
    'app://other/index.html',
    'file:///C:/index.html',
    'https://example.com/index.html',
    'devtools://devtools/bundled/inspector.html',
    'not a url',
    '',
  ];

  for (const url of denied)
    assert.equal(resolveAppPath(ROOT, url), null, `${url} は拒否されるべき`);
});

test('resolveAppPath は符号化されたスラッシュを含むパスを拒む', () => {
  // URL パーサーは ../ も %2e%2e/ も（大文字小文字を問わず）先に正規化する。
  // 一方 %2f は正規化されず1つのセグメントの中に残るため、復号したうえで弾く。
  const denied = [
    `${APP_ORIGIN}/..%2f..%2fsecret.txt`,
    `${APP_ORIGIN}/renderer%2f..%2f..%2fsecret.txt`,
  ];

  for (const url of denied)
    assert.equal(resolveAppPath(ROOT, url), null, `${url} は拒否されるべき`);
});

test('resolveAppPath はどう書かれてもアプリのフォルダの外を指さない', () => {
  // 守るべき性質はこれ。URL パーサーの正規化に頼らず、解決後のパスで確認する。
  const attempts = [
    `${APP_ORIGIN}/../secret.txt`,
    `${APP_ORIGIN}/renderer/../../secret.txt`,
    `${APP_ORIGIN}/./../secret.txt`,
    `${APP_ORIGIN}/../../../../../../Windows/System32/drivers/etc/hosts`,
    `${APP_ORIGIN}/%2e%2e/secret.txt`,
    `${APP_ORIGIN}/%2E%2E/secret.txt`,
    `${APP_ORIGIN}/renderer/%2e%2e/%2e%2e/secret.txt`,
    `${APP_ORIGIN}/..%2f..%2fsecret.txt`,
  ];

  for (const url of attempts) {
    const resolved = resolveAppPath(ROOT, url);
    if (resolved === null)
      continue;
    assert.ok(
      resolved.toLowerCase().startsWith(`${ROOT.toLowerCase()}${path.sep}`),
      `${url} が ${resolved} を指した`,
    );
  }
});

test('contentTypeFor は拡張子から MIME を返す', () => {
  assert.equal(contentTypeFor('index.html'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('app.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('pdf.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('shell.css'), 'text/css; charset=utf-8');
  assert.equal(contentTypeFor('icon.svg'), 'image/svg+xml');
  assert.equal(contentTypeFor('UniJIS-UCS2-H.bcmap'), 'application/octet-stream');
  assert.equal(contentTypeFor('unknown.xyz'), 'application/octet-stream');
});
