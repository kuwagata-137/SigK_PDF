'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, screen, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const {
  APP_SCHEME,
  APP_INDEX_URL,
  PRIVILEGED_SCHEME,
  CSP_STRING,
  MIN_WINDOW,
  buildWebPreferences,
  isAllowedRequest,
  isAllowedNavigation,
  resolveAppPath,
  contentTypeFor,
} = require('./security-policy.js');
const { createSettingsStore, clampWindowBounds } = require('./settings.js');
const { createErrorLog } = require('./errorlog.js');

// app.whenReady() の中では手遅れになる。トップレベルで登録すること。
// 遅れると app:// が不透明オリジンになり、CSP の 'self' が何も指さなくなる。
protocol.registerSchemesAsPrivileged([PRIVILEGED_SCHEME]);
app.setAppUserModelId('com.kuwagata.sigkpdf');

const ROOT_DIR = __dirname;

let errorLog = null;
let settings = null;
let mainWindow = null;

function logError(entry) {
  if (errorLog === null) {
    console.error(entry);
    return;
  }
  errorLog.append(entry);
}

// app:// の応答を組み立てる。
// net.fetch(file://…) は使わない。セッションを経由するため、自分で仕掛けた
// file: の遮断に自分で引っかかり、原因表示のない白画面になる。
function createAppProtocolHandler(rootDir) {
  return async function handleAppRequest(request) {
    const filePath = resolveAppPath(rootDir, request.url);
    if (filePath === null)
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

    try {
      const body = await fs.promises.readFile(filePath);
      const headers = { 'content-type': contentTypeFor(filePath) };
      // CSP は <meta> と両方に置く。片方の書き漏れで穴が空くのを防ぐ。
      if (path.extname(filePath).toLowerCase() === '.html')
        headers['content-security-policy'] = CSP_STRING;
      return new Response(body, { status: 200, headers });
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR')
        return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      logError({ message: 'app:// の応答に失敗しました', stack: err.stack, context: { url: request.url } });
      return new Response('Internal Error', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  };
}

// 外部との通信を断つ。onBeforeRequest のリスナーは1セッションに1つで後勝ちのため、
// 1セッションにつき1度だけ呼ぶ。
function applySecurity(targetSession) {
  targetSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url) });
  });
}

function hardenWebContents(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const blockNavigation = (event, url) => {
    if (isAllowedNavigation(url))
      return;
    event.preventDefault();
    logError({ level: 'warn', message: 'アプリ外への遷移を止めました', context: { url } });
  };
  contents.on('will-navigate', blockNavigation);
  contents.on('will-frame-navigate', (event) => blockNavigation(event, event.url));
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function createMainWindow() {
  const saved = settings.get();
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const bounds = clampWindowBounds(saved.window, workAreas);

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x ?? undefined,
    y: bounds.y ?? undefined,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    frame: true,
    backgroundColor: '#eef1f5',
    show: false,
    title: 'SigK PDF',
    webPreferences: buildWebPreferences({ preloadPath: path.join(ROOT_DIR, 'preload.js') }),
  });

  win.once('ready-to-show', () => {
    if (saved.window.maximized)
      win.maximize();
    win.show();
  });

  win.on('close', () => {
    const normal = win.getNormalBounds();
    settings.set({
      window: { width: normal.width, height: normal.height, x: normal.x, y: normal.y, maximized: win.isMaximized() },
    });
    settings.save();
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  win.loadURL(APP_INDEX_URL);
  return win;
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow ?? undefined, {
    type: 'info',
    title: 'SigK PDF について',
    message: `SigK PDF ${app.getVersion()}`,
    detail: [
      `Electron ${process.versions.electron}`,
      `Chromium ${process.versions.chrome}`,
      `Node.js ${process.versions.node}`,
    ].join('\n'),
    buttons: ['閉じる'],
  });
}

// Phase 0 で実際に動く項目だけを並べる。動かない項目をメニューに出さない。
function buildAppMenu() {
  const template = [
    { label: 'ファイル', submenu: [{ label: '終了', role: 'quit' }] },
    {
      label: 'ヘルプ',
      submenu: [{ label: 'バージョン情報', click: showAboutDialog }],
    },
  ];

  if (!app.isPackaged) {
    template.splice(1, 0, {
      label: '開発',
      submenu: [
        { label: '再読み込み', role: 'reload' },
        { label: '開発者ツール', role: 'toggleDevTools' },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    ok: true,
    name: 'SigK PDF',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }));

  ipcMain.handle('log:error', (_event, entry) => ({ ok: errorLog.append(entry) }));
}

// SIGK_SMOKE=1 で起動すると、画面が読み込めたかを標準出力へ書いて終了する。
// 人が窓を見なくても「app:// から読み込まれ、コンソールにエラーが無い」ことを
// 確かめられるようにするためで、CI からも同じ判定ができる。
function installSmokeCheck(win) {
  const problems = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error')
      problems.push(`console: ${event.message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, description, url) => {
    problems.push(`did-fail-load: ${code} ${description} ${url}`);
  });
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      const bounds = win.getBounds();
      console.log(JSON.stringify({
        url: win.webContents.getURL(),
        bounds: { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y },
        title: win.getTitle(),
        preload: Object.keys(win.webContents.getLastWebPreferences() ?? {}).length > 0,
        problems,
      }));
      // destroy ではなく close を使う。設定の保存を通す経路と同じにするため。
      win.close();
    }, 1500);
  });
}

function start() {
  const userData = app.getPath('userData');
  errorLog = createErrorLog({ dir: path.join(userData, 'logs') });
  settings = createSettingsStore({ dir: userData, onError: logError });
  settings.load();

  protocol.handle(APP_SCHEME, createAppProtocolHandler(ROOT_DIR));
  applySecurity(session.defaultSession);
  buildAppMenu();
  registerIpc();
  mainWindow = createMainWindow();

  if (process.env.SIGK_SMOKE === '1')
    installSmokeCheck(mainWindow);
}

app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
app.on('window-all-closed', () => app.quit());

process.on('uncaughtException', (err) => {
  logError({ message: '捕捉されない例外', stack: err.stack, context: { where: 'main' } });
});
process.on('unhandledRejection', (reason) => {
  logError({ message: '処理されない拒否', stack: reason?.stack, context: { where: 'main', reason: String(reason) } });
});

app.whenReady().then(start);
