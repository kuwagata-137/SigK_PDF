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
const { createFileIo } = require('./file-io.js');

// app.whenReady() の中では手遅れになる。トップレベルで登録すること。
// 遅れると app:// が不透明オリジンになり、CSP の 'self' が何も指さなくなる。
protocol.registerSchemesAsPrivileged([PRIVILEGED_SCHEME]);
app.setAppUserModelId('com.kuwagata.sigkpdf');

const ROOT_DIR = __dirname;

let errorLog = null;
let settings = null;
let fileIo = null;
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

// 開く経路はレンダラーに1本だけ持たせる。メニューはその引き金を引くだけにして、
// ツールバーからの経路と分岐させない（spec-1-1 確定事項10）。
function requestOpen() {
  mainWindow?.webContents.send('pdf:openRequest');
}

// 実際に動く項目だけを並べる。動かない項目をメニューに出さない。
function buildAppMenu() {
  const template = [
    {
      label: 'ファイル',
      submenu: [
        { label: '開く…', accelerator: 'CmdOrCtrl+O', click: requestOpen },
        { type: 'separator' },
        { label: '終了', role: 'quit' },
      ],
    },
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

  ipcMain.handle('pdf:open', () => fileIo.open(mainWindow));
  ipcMain.handle('pdf:read', (_event, filePath) => fileIo.read(filePath));
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
  // CSP の script-src に 'wasm-unsafe-eval' を足した効果を、その場で確かめる。
  // pdf.js が wasm を使うのは JBIG2・JPEG2000・ICC を含む PDF に限られるため、
  // 手元の検証用 PDF を開くだけでは通ったかどうかが分からない。
  const readShellState = `(async () => {
    const root = document.documentElement;
    let wasm = 'ok';
    try {
      await WebAssembly.compile(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    } catch (err) {
      wasm = err.message;
    }
    return {
      wasm,
      mode: root.getAttribute('data-mode'),
      panel: root.getAttribute('data-panel'),
      railItems: document.querySelectorAll('.rail-item').length,
      icons: document.querySelectorAll('svg').length,
      unfilledIcons: document.querySelectorAll('[data-icon]:empty').length,
      sideTitle: document.getElementById('side-title')?.textContent ?? null,
      version: document.getElementById('status-version')?.textContent ?? null,
      metrics: ['#tabbar', '#toolbar', '#rail', '#side', '#view', '#status'].reduce((acc, sel) => {
        const el = document.querySelector(sel);
        const rect = el.getBoundingClientRect();
        acc[sel] = { w: Math.round(rect.width), h: Math.round(rect.height), bg: getComputedStyle(el).backgroundColor };
        return acc;
      }, {}),
      activeRailColor: getComputedStyle(document.querySelector('.rail-item.active')).color,
      viewClient: { w: document.getElementById('view').clientWidth, h: document.getElementById('view').clientHeight },
    };
  })()`;

  // SIGK_SMOKE_PDF=<path> を付けると、その PDF を実際に開いて結果を報告する。
  // pdf.js が app:// で本当に動いているかを、目で見なくても確かめられるようにする。
  const openPdfScript = (filePath) => `(async () => {
    const result = await window.pdfAPI.read(${JSON.stringify(filePath)});
    if (result.error !== undefined)
      return { error: result.error };
    const opened = await window.SigK.viewer.open(result);
    // 可視ページの描画が終わるのを待つ。
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const state = window.SigK.viewer.getState();
    const box = document.querySelector('.pdf-page')?.getBoundingClientRect() ?? null;
    const canvas = document.querySelector('.pdf-page canvas') ?? null;
    const message = document.getElementById('view-empty');
    return {
      opened,
      name: result.name,
      pageCount: state.pageCount,
      zoom: Math.round(state.zoom * 1000) / 1000,
      fit: state.fit,
      rendered: state.rendered,
      canvasCount: document.querySelectorAll('.pdf-page canvas').length,
      pageBox: box === null ? null : { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
      viewBox: (() => { const r = document.getElementById('view').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; })(),
      canvasPixels: canvas === null ? null : { w: canvas.width, h: canvas.height },
      status: document.getElementById('status-pages').textContent,
      message: message.hidden ? null : message.textContent,
      // 途中まで飛んで、描画が付いてきて、要らなくなった canvas が捨てられるか。
      afterJump: await (async () => {
        const target = Math.min(19, state.pageCount - 1);
        window.SigK.viewer.goToPage(target);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const after = window.SigK.viewer.getState();
        // スクリーンショットはこの後で撮る。先頭に戻しておく。
        window.SigK.viewer.goToPage(0);
        await new Promise((resolve) => setTimeout(resolve, 600));
        return {
          target,
          current: after.current,
          rendered: after.rendered,
          canvasCount: document.querySelectorAll('.pdf-page canvas').length,
          scrollTop: document.getElementById('view').scrollTop,
        };
      })(),
    };
  })()`;

  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      const bounds = win.getBounds();
      let shell = null;
      let pdf = null;
      try {
        // SIGK_SMOKE_THROW=1 のときだけ、例外がレンダラーからログへ届くかを確かめる。
        if (process.env.SIGK_SMOKE_THROW === '1')
          await win.webContents.executeJavaScript('setTimeout(() => { throw new Error("起動確認の意図的な例外"); }, 0); true');
        shell = await win.webContents.executeJavaScript(readShellState);
        if (process.env.SIGK_SMOKE_PDF)
          pdf = await win.webContents.executeJavaScript(openPdfScript(path.resolve(process.env.SIGK_SMOKE_PDF)));
      } catch (err) {
        problems.push(`executeJavaScript: ${err.message}`);
      }
      let screenshot = null;
      if (process.env.SIGK_SMOKE_SHOT) {
        try {
          const image = await win.webContents.capturePage();
          screenshot = path.resolve(process.env.SIGK_SMOKE_SHOT);
          fs.mkdirSync(path.dirname(screenshot), { recursive: true });
          fs.writeFileSync(screenshot, image.toPNG());
        } catch (err) {
          problems.push(`capturePage: ${err.message}`);
        }
      }

      console.log(JSON.stringify({
        url: win.webContents.getURL(),
        bounds: { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y },
        title: win.getTitle(),
        shell,
        pdf,
        screenshot,
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
  fileIo = createFileIo({ dialog, onError: logError });

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
