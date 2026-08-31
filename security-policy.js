'use strict';

// セキュリティに関する判定と定数をここに集約する。
// このファイルは Electron を require しない。main.js から使う一方で、
// node --test からも直接 require して検証できるようにするためである（spec-0 テストの範囲）。

const path = require('node:path');

// レンダラーの配信は app:// スキームで行う（spec-0 確定事項14）。
// ホスト名を必ず付ける。app:///index.html はホストが空で拒否されることがある。
const APP_SCHEME = 'app';
const APP_HOST = 'sigk';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

// app.whenReady() より前、モジュールのトップレベルで登録すること。
// 遅れると app:// が不透明オリジンになり、CSP の 'self' が何も指さなくなる。
const PRIVILEGED_SCHEME = {
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true,
    codeCache: true,
  },
};

// style-src に 'unsafe-inline' を許すのは、レンダラーが要素の style 属性で
// 色や位置を変えるためである。script-src にインラインは許さない。
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
];
const CSP_STRING = CSP_DIRECTIVES.join('; ');

// frame-ancestors は <meta> で配ると仕様上無視され、Chromium が警告を出す。
// <meta> 側だけこれを外す。効かない指令を書いて警告を残すより、
// ヘッダで確実に効かせ、meta では効く指令だけを二重化するほうがよい。
const META_IGNORED_DIRECTIVES = ['frame-ancestors'];
const CSP_META_DIRECTIVES = CSP_DIRECTIVES.filter(
  (line) => !META_IGNORED_DIRECTIVES.some((name) => line.startsWith(`${name} `)),
);
const CSP_META_STRING = CSP_META_DIRECTIVES.join('; ');

const DEFAULT_WINDOW = { width: 1280, height: 800 };
const MIN_WINDOW = { width: 960, height: 600 };

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/vnd.microsoft.icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
};

function buildWebPreferences({ preloadPath }) {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
  };
}

function parseUrl(url) {
  if (typeof url !== 'string' || url === '')
    return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// app: と devtools: 以外はすべて拒否する。file: も含めて拒否する（spec-0 確定事項5）。
// レンダラーはファイルを直接読まず、PDF のバイト列はメインが読んで IPC で渡すため、
// file: を許す必要がない。自動更新も入れないので、アプリは一切通信しない。
function isAllowedRequest(url) {
  const parsed = parseUrl(url);
  if (parsed === null)
    return false;
  return parsed.protocol === `${APP_SCHEME}:` || parsed.protocol === 'devtools:';
}

// アプリ外への遷移を許さない。
function isAllowedNavigation(url) {
  const parsed = parseUrl(url);
  if (parsed === null)
    return false;
  return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
}

function isInside(rootDir, candidate) {
  const root = path.resolve(rootDir);
  const target = path.resolve(candidate);
  // Windows は大文字小文字を区別しないため、比較も区別しない。
  const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  return normalize(target) === normalize(root) || normalize(target).startsWith(normalize(root + path.sep));
}

// app://sigk/renderer/app.js → <rootDir>/renderer/app.js
// ホスト違い・ディレクトリ脱出は null を返す。
function resolveAppPath(rootDir, requestUrl) {
  const parsed = parseUrl(requestUrl);
  if (parsed === null || parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST)
    return null;

  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }

  if (pathname === '' || pathname === '/')
    pathname = '/index.html';

  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '.' || segment === '..'))
    return null;

  const resolved = path.join(rootDir, ...segments);
  return isInside(rootDir, resolved) ? resolved : null;
}

function contentTypeFor(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

module.exports = {
  APP_SCHEME,
  APP_HOST,
  APP_ORIGIN,
  APP_INDEX_URL,
  PRIVILEGED_SCHEME,
  CSP_DIRECTIVES,
  CSP_STRING,
  META_IGNORED_DIRECTIVES,
  CSP_META_DIRECTIVES,
  CSP_META_STRING,
  DEFAULT_WINDOW,
  MIN_WINDOW,
  buildWebPreferences,
  isAllowedRequest,
  isAllowedNavigation,
  resolveAppPath,
  contentTypeFor,
};
