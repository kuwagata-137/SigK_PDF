'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, screen, session, utilityProcess } = require('electron');
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
const { createSettingsStore, clampWindowBounds, pickUi, mergeUi } = require('./settings.js');
const { createErrorLog } = require('./errorlog.js');
const { createFileIo } = require('./file-io.js');
const { addRecent, removeRecent, normalizeList } = require('./recent-documents.js');
const { createTaskRunner } = require('./task-runner.js');
const { parseLaunchArgs } = require('./launch-args.js');

// app.whenReady() の中では手遅れになる。トップレベルで登録すること。
// 遅れると app:// が不透明オリジンになり、CSP の 'self' が何も指さなくなる。
protocol.registerSchemesAsPrivileged([PRIVILEGED_SCHEME]);
app.setAppUserModelId('com.kuwagata.sigkpdf');

const ROOT_DIR = __dirname;

let errorLog = null;
let settings = null;
let fileIo = null;
let taskRunner = null;
let mainWindow = null;

// 未保存の編集があるタブの数（spec-1-5 確定事項56）。レンダラーが編集の
// たびに知らせてくる。メインがこれを持っておくと、未保存が無いときの終了は
// 従来どおり素通りでき、確認の往復が要るのは実際に未保存があるときだけになる。
let dirtyTabCount = 0;
// 起動要求（docs/03 第3章・spec-1-6 確定事項77）。**レンダラーが購読を始めるまで
// メイン側で保持する。**理由は「読み込みが終わる前だから」ではなく「まだ購読して
// いないから」である。`did-finish-load` を合図に送った分まで消えた（実測で7通中5通）。
let launchReady = false;
const pendingLaunch = [];
// 確認が済んで閉じてよい状態。二度目の close で実際に閉じる。
let allowClose = false;

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

  win.on('close', (event) => {
    // 未保存があれば、閉じる前にレンダラーへ確認を頼む（確定事項56）。
    // 確認のダイアログはアプリ内の <dialog> なので、レンダラーでしか出せない。
    //
    // レンダラーが死んでいるときは聞けない。そのまま閉じる（聞けないせいで
    // 二度と閉じられなくなるほうが困る）。
    const canAsk = !win.webContents.isDestroyed() && !win.webContents.isCrashed();
    if (!allowClose && dirtyTabCount > 0 && canAsk) {
      event.preventDefault();
      win.webContents.send('app:closeRequest');
      return;
    }

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
// ツールバーからの経路と分岐させない（spec-1-1 確定事項10・spec-1-2 確定事項18）。
// パスを渡さなければレンダラーがダイアログを出す。
// 実在するファイルか。引数の絞り込みの3つ目の条件（確定事項75）。
function isExistingFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch (error) {
    return false;
  }
}

function sendLaunch(request) {
  if (!launchReady) {
    pendingLaunch.push(request);
    return;
  }
  mainWindow?.webContents.send('shell:launch', request);
}

// 起動引数を1件の要求にして流す。
//
// **集約はしない**（確定事項78）。`open` はパスが届くたびにタブを1枚足せば済む。
// 集約が要るのは merge・split・toPdf で、いずれも Phase 2 以降である。
// `PENDING_WINDOW_MS` も Phase 5 のままにする（400ms では短いことは実測済み。docs/03）。
function queueLaunch(argv) {
  const request = parseLaunchArgs(argv, { isFile: isExistingFile });
  // 塊⑤ で扱うのは open だけである。ほかの意図は黙って捨てる。
  if (request === null || request.intent !== 'open' || request.paths.length === 0)
    return;
  sendLaunch(request);
}

function requestOpen(filePath = null) {
  mainWindow?.webContents.send('pdf:openRequest', filePath);
}

function requestDocInfo() {
  mainWindow?.webContents.send('pdf:docInfoRequest');
}

// 保存も開くのと同じで、経路はレンダラーに1本だけ持たせる（確定事項23）。
// mode は 'save'（上書き）か 'saveAs'（名前を付けて保存）。
function requestSave(mode) {
  mainWindow?.webContents.send('pdf:saveRequest', mode);
}

// 最近使ったファイルのサブメニュー（spec-1-2 確定事項9）。
// 履歴が空のときは、押せない1項目を出す。項目ごと消すと、メニューの並びが
// 履歴の有無で動いてしまい、狙って押せなくなる。
function buildRecentSubmenu() {
  const recent = normalizeList(settings.get().recent);
  if (recent.length === 0)
    return [{ label: '（履歴なし）', enabled: false }];

  return recent.map((entry) => ({
    // & はメニューでアクセスキーの指定として食われる。ファイル名に含まれ得るので潰す。
    label: entry.name.replace(/&/g, '&&'),
    toolTip: entry.path,
    click: () => requestOpen(entry.path),
  }));
}

// 実際に動く項目だけを並べる。動かない項目をメニューに出さない。
function buildAppMenu() {
  const template = [
    {
      label: 'ファイル',
      submenu: [
        { label: '開く…', accelerator: 'CmdOrCtrl+O', click: () => requestOpen(null) },
        { label: '最近使ったファイル', submenu: buildRecentSubmenu() },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => requestSave('save') },
        { label: '名前を付けて保存…', accelerator: 'CmdOrCtrl+Shift+S', click: () => requestSave('saveAs') },
        { type: 'separator' },
        { label: '文書情報…', accelerator: 'CmdOrCtrl+I', click: requestDocInfo },
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

  // レンダラーが購読を始めた合図（確定事項77）。溜めていた要求をここで流す。
  ipcMain.on('shell:ready', () => {
    launchReady = true;
    while (pendingLaunch.length > 0)
      mainWindow?.webContents.send('shell:launch', pendingLaunch.shift());
  });

  // 未保存の数（spec-1-5 確定事項56）。返事は要らないので send で受ける。
  ipcMain.on('app:dirty', (_event, count) => {
    dirtyTabCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  });

  // 確認の答え。閉じてよければ、もう一度 close を通して実際に閉じる。
  ipcMain.handle('app:closeConfirm', (_event, ok) => {
    if (ok !== true)
      return { ok: false };
    allowClose = true;
    mainWindow?.close();
    return { ok: true };
  });

  ipcMain.handle('pdf:open', () => fileIo.open(mainWindow));
  ipcMain.handle('pdf:read', (_event, filePath) => fileIo.read(filePath));
  ipcMain.handle('pdf:pickSavePath', (_event, options = {}) => fileIo.pickSavePath(mainWindow, options));
  ipcMain.handle('pdf:pickInsertSource', (_event, options = {}) => fileIo.pickInsertSource(mainWindow, options));

  // ワーカーへの委譲（spec-1-6 確定事項1〜10）。進捗は要求元の webContents へ
  // 返す。タスク1本につきプロセスを1つ立てて、終わったら落とすのは
  // task-runner.js の仕事である。
  ipcMain.handle('task:run', (event, taskId, spec) => taskRunner.run(taskId, spec, {
    onProgress: (progress) => {
      if (!event.sender.isDestroyed())
        event.sender.send('task:progress', progress);
    },
  }));
  ipcMain.handle('task:cancel', (_event, taskId) => taskRunner.cancel(taskId));

  // 画面の見た目（モード・サイドパネルの開閉と幅）を覚える。
  // sandbox: true のため、fs に触るのはメインだけである（spec-1-3 確定事項32）。
  ipcMain.handle('settings:getUi', () => ({ ok: true, ui: pickUi(settings.get()) }));
  ipcMain.handle('settings:setUi', (_event, patch) => {
    settings.set(mergeUi(pickUi(settings.get()), patch));
    settings.save();
    return { ok: true, ui: pickUi(settings.get()) };
  });

  // 印刷（spec-1-4 確定事項28〜30）。レンダラーが印刷用のコンテナへ画像を
  // 並べ終えてから呼ぶ。silent: false が OS の印刷ダイアログを出す経路である。
  // 取り消しは失敗ではないので、理由を見て分けて返す。
  ipcMain.handle('print:run', (event, options = {}) => new Promise((resolve) => {
    const contents = event.sender;
    const settingsForPrint = {
      silent: options?.silent === true,
      printBackground: true,
      deviceName: typeof options?.deviceName === 'string' ? options.deviceName : undefined,
    };
    try {
      contents.print(settingsForPrint, (success, reason) => {
        const canceled = success !== true && /cancel/i.test(String(reason ?? ''));
        resolve({ ok: success === true, canceled, reason: success === true ? null : String(reason ?? '') });
      });
    } catch (err) {
      logError({ message: '印刷に失敗しました', stack: err.stack, context: { where: 'print:run' } });
      resolve({ ok: false, canceled: false, reason: err.message });
    }
  }));

  ipcMain.handle('recent:list', () => ({ ok: true, recent: normalizeList(settings.get().recent) }));
  ipcMain.handle('recent:add', (_event, entry) => updateRecent(addRecent(settings.get().recent, entry)));
  ipcMain.handle('recent:remove', (_event, filePath) => updateRecent(removeRecent(settings.get().recent, filePath)));
}

// 履歴が変われば、保存とメニューの作り直しを必ず同時に行う。片方だけ更新すると
// メニューだけ古いまま残る。呼び出し側が忘れないよう、この1本にまとめる。
function updateRecent(recent) {
  settings.set({ recent });
  settings.save();
  buildAppMenu();
  return { ok: true, recent: normalizeList(settings.get().recent) };
}

// SIGK_SMOKE=1 で起動すると、画面が読み込めたかを標準出力へ書いて終了する。
// 人が窓を見なくても「app:// から読み込まれ、コンソールにエラーが無い」ことを
// 確かめられるようにするためで、CI からも同じ判定ができる。
// SIGK_SMOKE_DISPLAY=<番号|secondary> を付けると、起動確認のウィンドウを
// そのディスプレイの中央へ寄せる。確認のたびに作業中の画面へ窓が出てくるのを
// 避けるためである。
//
// 移した位置は settings.json にそのまま残り、次からは通常の起動もその
// ディスプレイに出る（ユーザー判断 2026-09-01）。戻したいときは窓を動かして
// 閉じれば、その位置が覚え直される。
function displayWorkArea(spec) {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  if (spec === 'secondary')
    return (displays.find((display) => display.id !== primaryId) ?? displays[0]).workArea;
  return (displays[Number(spec)] ?? displays[0]).workArea;
}

function moveToDisplay(win, spec) {
  const area = displayWorkArea(spec);
  const size = win.getBounds();
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  win.setBounds({
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  });
}

function installSmokeCheck(win) {
  const problems = [];
  if (process.env.SIGK_SMOKE_DISPLAY) {
    if (win.isMaximized())
      win.unmaximize();
    moveToDisplay(win, process.env.SIGK_SMOKE_DISPLAY);
  }
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

  // SIGK_SMOKE_TABS=<path1>,<path2> を付けると、2つの PDF をタブで開き、
  // 切り替えで読み位置が戻るか、文書情報が埋まるかまで確かめる（spec-1-2）。
  // ドロップだけは自動化できない。代わりに、パスを取り出す橋（webUtils）が
  // 生きているかをここで見る。橋が死んでいれば ドラッグ＆ドロップ は必ず失敗する。
  const tabsScript = (paths) => `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const tabs = window.SigK.tabs;
    const paths = ${JSON.stringify(paths)};

    for (const p of paths) {
      await tabs.openPath(p);
      await wait(700);
    }
    const names = [...document.querySelectorAll('#tabbar .tab .name')].map((el) => el.textContent);

    // 2枚目を 200% の3ページ目にしてから1枚目へ移り、戻して位置を見る。
    window.SigK.viewer.setZoom(2);
    window.SigK.viewer.goToPage(2);
    await wait(500);
    const marked = window.SigK.viewer.getState();

    const ids = tabs.list().map((t) => t.id);
    tabs.activate(ids[0]);
    await wait(700);
    const onFirst = window.SigK.viewer.getState();

    tabs.activate(ids[1]);
    await wait(700);
    const back = window.SigK.viewer.getState();

    await window.SigK.docInfo.open(document);
    const info = [...document.querySelectorAll('#doc-info-body dd')].map((el) => el.textContent);
    const infoOpen = document.getElementById('doc-info').hasAttribute('open');

    // ドロップ由来でない File には '' が返る。例外にならず null が返れば橋は生きている。
    let bridge = 'missing';
    try {
      bridge = String(window.pdfAPI.pathForFile(new File([], 'probe.pdf')));
    } catch (err) {
      bridge = 'threw: ' + err.message;
    }

    // スクリーンショットはこの後で撮る。モーダルを閉じ、素直に読める状態へ戻す。
    window.SigK.docInfo.close(document);
    window.SigK.viewer.applyFit('width');
    window.SigK.viewer.goToPage(0);
    await wait(900);

    const box = document.querySelector('.pdf-page').getBoundingClientRect();
    const canvas = document.querySelector('.pdf-page canvas');

    return {
      names,
      tabCount: tabs.count(),
      canvasCount: document.querySelectorAll('.pdf-page canvas').length,
      pageBox: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
      canvasPixels: canvas === null ? null : { w: canvas.width, h: canvas.height },
      marked: { zoom: Math.round(marked.zoom * 1000) / 1000, current: marked.current },
      onFirst: { name: onFirst.file && onFirst.file.name, current: onFirst.current, fit: onFirst.fit },
      back: { name: back.file && back.file.name, zoom: Math.round(back.zoom * 1000) / 1000, current: back.current },
      infoOpen,
      info,
      bridge,
      title: document.title,
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
    const message = document.getElementById('view-message');
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

  // SIGK_SMOKE_TEXT=1 を付けると、テキストレイヤーとサムネイルの実測を出す
  // （spec-1-3 確定事項27）。jsdom は CSS を解釈せず getBoundingClientRect が
  // すべて 0 を返すため、「文字がページ枠に重なっているか」「実際に選べるか」
  // 「サイドパネルの幅にサムネイルが追従するか」はここでしか確かめられない。
  // SIGK_SMOKE_PDF と一緒に使う（文書が開いていないと測るものが無い）。
  const textScript = `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // 時間で待つと、初回起動（フォントの取得を伴う）で取りこぼす。状態で待つ。
    const until = async (check, limit = 8000) => {
      for (let waited = 0; waited < limit; waited += 100) {
        if (check())
          return true;
        await wait(100);
      }
      return false;
    };

    const layerReady = await until(() => document.querySelector('.pdf-page .textLayer') !== null);
    const round = (rect) => rect === null ? null : {
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.width), h: Math.round(rect.height),
    };

    const page = document.querySelector('.pdf-page');
    const layer = page === null ? null : page.querySelector('.textLayer');
    const pageBox = page === null ? null : page.getBoundingClientRect();
    const layerBox = layer === null ? null : layer.getBoundingClientRect();

    // 本当に選べるか。ページ1枚ぶんを選び、取り出せた文字を見る。
    let selected = null;
    if (layer !== null) {
      const range = document.createRange();
      range.selectNodeContents(layer);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      selected = selection.toString();
      selection.removeAllRanges();
    }

    const measureThumbs = () => {
      const list = [...document.querySelectorAll('#thumbs .thumb')];
      const current = document.querySelector('#thumbs .thumb.current');
      return {
        count: list.length,
        canvasCount: document.querySelectorAll('#thumbs canvas').length,
        cssVar: document.documentElement.style.getPropertyValue('--side-width'),
        sideWidth: document.getElementById('side').clientWidth,
        scrollWidth: document.getElementById('side-scroll').clientWidth,
        columnWidth: window.SigK.thumbnails.getState().columnWidth,
        first: list.length === 0 ? null : round(list[0].getBoundingClientRect()),
        currentPage: current === null ? null : current.dataset.page,
        currentBox: current === null ? null : round(current.getBoundingClientRect()),
      };
    };

    // 紙の幅がサイドパネルの実幅に追従するか（確定事項5）。
    const measureAt = async (width) => {
      const before = window.SigK.thumbnails.getState().columnWidth;
      window.SigK.shell.setSidePanelWidth(document, width);
      await until(() => window.SigK.thumbnails.getState().columnWidth !== before);
      await wait(400);
      return measureThumbs();
    };

    const atDefault = measureThumbs();
    const atMin = await measureAt(180);
    const atMax = await measureAt(420);
    await measureAt(240);

    return {
      // テキストレイヤーが使える状態か。pdf.js の読み込みに失敗していれば false。
      available: window.SigK.textLayer.available(),
      textLayerClass: typeof (window.SigK.pdfjs.lib || {}).TextLayer,
      layerReady,
      spans: layer === null ? 0 : layer.querySelectorAll('span').length,
      pageBox: round(pageBox),
      layerBox: round(layerBox),
      // ページ枠に対するずれ。0 でなければ CSS 変数か viewport の渡し方が違う。
      offset: layerBox === null || pageBox === null ? null : {
        dx: Math.round(layerBox.x - pageBox.x),
        dy: Math.round(layerBox.y - pageBox.y),
        dw: Math.round(layerBox.width - pageBox.width),
        dh: Math.round(layerBox.height - pageBox.height),
      },
      scaleFactor: page === null ? null : page.style.getPropertyValue('--total-scale-factor'),
      selectedLength: selected === null ? null : selected.length,
      selectedHead: selected === null ? null : selected.slice(0, 40),
      thumbs: { atDefault, atMin, atMax },
    };
  })()`;

  // SIGK_SMOKE_FIND=<語> を付けると、検索の実測を出す（spec-1-4 の完了判定）。
  // ヒット数・現在位置・ハイライトの数と緑の位置は jsdom でも見られるが、
  // 全ページのテキスト取り出しにかかる時間と検索バーの実寸はここでしか測れない。
  // SIGK_SMOKE_PDF と一緒に使う。
  const findScript = (term) => `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (check, limit = 8000) => {
      for (let waited = 0; waited < limit; waited += 100) {
        if (check())
          return true;
        await wait(100);
      }
      return false;
    };
    const round = (rect) => rect === null ? null : {
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.width), h: Math.round(rect.height),
    };
    const boxOf = (selector) => {
      const node = document.querySelector(selector);
      return node === null ? null : round(node.getBoundingClientRect());
    };

    const layerReady = await until(() => document.querySelector('.pdf-page .textLayer') !== null);
    window.SigK.findBar.open();
    // 人が打ったときと同じ見た目にする（画面写真のため）。探すのは下で直接呼ぶ。
    document.getElementById('find-input').value = ${JSON.stringify(term)};

    // 1回目は全ページのテキスト取り出しを含む。2回目は取り出し済みなので、
    // 差が取り出しにかかった時間の目安になる（確定事項2 の根拠）。
    const t0 = performance.now();
    const first = await window.SigK.find.run(${JSON.stringify(term)}, { matchCase: false });
    const firstMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    await window.SigK.find.run(${JSON.stringify(term)} + ' ', { matchCase: false });
    const warmMs = Math.round(performance.now() - t1);
    await window.SigK.find.run(${JSON.stringify(term)}, { matchCase: false });
    await wait(600);

    const pages = window.SigK.find.getPages() || [];
    const chars = pages.reduce((sum, items) => sum + items.join('').length, 0);
    const afterNext = window.SigK.find.step(1);
    await wait(400);
    const afterPrev = window.SigK.find.step(-1);
    await wait(400);

    return {
      layerReady,
      term: ${JSON.stringify(term)},
      total: first.total,
      current: first.current,
      page: first.page,
      textPages: pages.length,
      textChars: chars,
      // 取り出し込みの1回目と、取り出し済みの2回目。
      firstMs,
      warmMs,
      extractMs: firstMs - warmMs,
      highlights: document.querySelectorAll('.textLayer .highlight').length,
      selectedCount: document.querySelectorAll('.textLayer .highlight.selected').length,
      selectedText: (document.querySelector('.textLayer .highlight.selected') || {}).textContent || null,
      selectedBox: boxOf('.textLayer .highlight.selected'),
      afterNext: { current: afterNext.current, page: afterNext.page },
      afterPrev: { current: afterPrev.current, page: afterPrev.page },
      countText: document.getElementById('find-count').textContent,
      barBox: boxOf('#find-bar'),
      barHidden: document.getElementById('find-bar').hidden,
    };
  })()`;

  // SIGK_SMOKE_PRINT=<範囲> を付けると、印刷の準備までを実測する。
  // 「all」「current」はそのまま、それ以外は「ページ指定」の文字列として渡す。
  // 印刷ダイアログ自体は自動化できないので、OS へ送る手前までを確かめる
  // （spec-1-4 の完了判定）。
  const printScript = (spec) => `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const round = (rect) => rect === null ? null : {
      w: Math.round(rect.width), h: Math.round(rect.height),
    };
    const spec = ${JSON.stringify(spec)};
    const mode = (spec === 'all' || spec === 'current') ? spec : 'custom';

    window.SigK.print.open();
    await wait(200);
    const dialogBox = round(document.getElementById('print-dialog').getBoundingClientRect());

    const t0 = performance.now();
    const result = await window.SigK.print.prepare({ mode, text: spec });
    const elapsedMs = Math.round(performance.now() - t0);
    const imgs = [...document.querySelectorAll('#print-area img')];
    const measured = {
      mode,
      spec,
      error: result.error || null,
      pageCount: (result.pages || []).length,
      pages: (result.pages || []).slice(0, 12),
      placed: result.placed || 0,
      imgCount: imgs.length,
      firstImage: result.images && result.images[0] ? result.images[0] : null,
      totalBytes: (result.images || []).reduce((sum, image) => sum + image.bytes, 0),
      elapsedMs,
      dialogBox,
    };

    // 上限（確定事項33）が本当に効くかも、同じ経路で見ておく。
    const overflow = await window.SigK.print.prepare({ mode: 'custom', text: '1-1000' });
    measured.overLimitError = overflow.error || null;
    measured.overCountError = window.SigK.print.resolvePages({ mode: 'all', pageCount: 300 }).error || null;

    // 1ページあたりの内訳。描画と PNG への変換のどちらが重いのかは、
    // 上限100ページ（確定事項33）を見直すときの根拠になる。
    const page = await window.SigK.viewer.getPage(1);
    const viewport = page.getViewport({ scale: window.SigK.print.PRINT_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const r0 = performance.now();
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const renderMs = Math.round(performance.now() - r0);
    const e0 = performance.now();
    const url = canvas.toDataURL('image/png');
    const encodeMs = Math.round(performance.now() - e0);
    canvas.width = 0;
    canvas.height = 0;
    measured.perPage = { renderMs, encodeMs, pngBytes: Math.round((url.length - url.indexOf(',') - 1) * 3 / 4) };
    measured.heapMB = performance.memory
      ? Math.round(performance.memory.usedJSHeapSize / 1048576)
      : null;

    // このあと SIGK_SMOKE_SHOT で画面写真を撮ることがある。実際に使う状態で
    // 開き直しておく（準備で作った画像は open が捨てる）。
    window.SigK.print.open();
    document.getElementById('print-mode-' + mode).checked = true;
    if (mode === 'custom')
      document.getElementById('print-pages').value = spec;
    return measured;
  })()`;

  // SIGK_SMOKE_PAGES=<操作列> を付けると、ページ編集の実測を出す
  // （spec-1-5 の完了判定）。SIGK_SMOKE_PDF と一緒に使う。
  //
  // 操作はカンマ区切りで、次のものを受ける。
  //   select:2 / select:0-4  選ぶ（0 起点）   all  全選択
  //   rotate / rotateLeft    右90度 / 左90度  delete  削除
  //   move:3                 選択を3番の手前へ
  //   undo / redo            元に戻す / やり直し
  //
  // 例: SIGK_SMOKE_PAGES=select:0-1,rotate,move:5,delete,undo
  const pagesScript = (spec) => `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const SigK = window.SigK;
    const round = (value) => Math.round(value * 100) / 100;

    SigK.shell.setMode(document, 'pages');
    await wait(500);

    const applied = [];
    for (const raw of ${JSON.stringify(spec)}.split(',')) {
      const step = raw.trim();
      if (step.length === 0)
        continue;
      const [name, arg] = step.split(':');
      const t0 = performance.now();

      if (name === 'scroll') {
        // サイドパネルを縦に送る。同時に持つサムネイルの上限（確定事項26）を
        // 実際に埋めて測るのに要る。
        document.getElementById('side-scroll').scrollTop = Number(arg);
        await wait(900);
      } else if (name === 'width') {
        // サイドパネルの幅を変える。3列（確定事項23）の実測に要る。
        SigK.shell.setSidePanelWidth(document, Number(arg));
        await wait(400);
      } else if (name === 'select') {
        const parts = String(arg).split('-').map(Number);
        const from = parts[0];
        const to = Number.isFinite(parts[1]) ? parts[1] : from;
        const list = [];
        for (let index = from; index <= to; index += 1)
          list.push(index);
        SigK.pageGrid.setSelection(list);
      } else if (name === 'all') {
        SigK.pageGrid.selectAll();
      } else if (name === 'rotate') {
        SigK.pageEdit.rotate(90);
      } else if (name === 'rotateLeft') {
        SigK.pageEdit.rotate(-90);
      } else if (name === 'delete') {
        SigK.pageEdit.remove();
      } else if (name === 'move') {
        const before = SigK.pageGrid.getSelection();
        const moved = SigK.pagePlan.movePages(SigK.viewer.getPlan(), before, Number(arg));
        SigK.pageEdit.commit(moved.plan, { before, after: moved.selection });
      } else if (name === 'undo') {
        SigK.pageEdit.undo();
      } else if (name === 'redo') {
        SigK.pageEdit.redo();
      }

      // 操作そのものにかかった時間（画面が揃うまでを含む）。
      applied.push({ step, ms: round(performance.now() - t0) });
      await wait(150);
    }

    // ページビューとサムネイルが同じ並びを映しているかを数値で見る
    // （完了判定）。回した紙は縦横比が反転するので、並べ替えと回転を
    // 混ぜた列を通すと、一致していなければ必ず食い違う。
    const viewRatios = [...document.querySelectorAll('#view-pages .pdf-page')]
      .map((node) => Math.round((parseFloat(node.style.width) / parseFloat(node.style.height)) * 100));
    const layout = SigK.thumbnails.getLayout();
    const thumbRatios = layout.pages.map((page) => Math.round((page.sheetWidth / page.sheetHeight) * 100));
    const ratiosMatch = viewRatios.length === thumbRatios.length
      && viewRatios.every((value, index) => Math.abs(value - thumbRatios[index]) <= 1);

    // 並べ替え1回から画面が揃うまで（実測に残すもの）。
    // 履歴は通さず applyPlan だけを測る。戻すのも applyPlan で行う。
    // ここで undo を呼ぶと、操作列で積んだ世代まで1つ戻ってしまう。
    const restore = SigK.viewer.getPlan();
    const r0 = performance.now();
    const shuffled = SigK.pagePlan.movePages(restore, [0], 3);
    const planMs = round(performance.now() - r0);
    const a0 = performance.now();
    SigK.viewer.applyPlan(shuffled.plan);
    const applyMs = round(performance.now() - a0);
    await wait(400);
    SigK.viewer.applyPlan(restore);
    await wait(200);

    const thumbState = SigK.thumbnails.getState();
    const plan = SigK.viewer.getPlan();
    return {
      applied,
      pageCount: SigK.viewer.getState().pageCount,
      basePageCount: SigK.viewer.getBasePageCount(),
      // 先頭20枚を「元ページ:相対角度」で出す。
      plan: plan.slice(0, 20).map((page) => page.src + ':' + page.rotate),
      rotated: plan.filter((page) => page.rotate !== 0).length,
      selection: SigK.pageGrid.getSelection().slice(0, 20),
      dirty: SigK.viewer.isDirty(),
      history: SigK.pageEdit.getHistoryState(),
      statusPages: document.getElementById('status-pages').textContent,
      statusDirty: document.getElementById('status-dirty').hidden === false,
      // SIGK_SMOKE_PDF は viewer.open() を直に呼ぶのでタブが作られない。
      // タブの点を見るには SIGK_SMOKE_TABS と組み合わせる。
      tabCount: SigK.tabs.count(),
      tabDirty: document.querySelector('#tabbar .tab .dirty') !== null,
      undoEnabled: document.getElementById('btn-undo').hasAttribute('aria-disabled') === false,
      deleteEnabled: document.getElementById('act-delete').hasAttribute('aria-disabled') === false,
      // 多列グリッドの実測（確定事項23・26）。
      columns: thumbState.columns,
      columnWidth: thumbState.columnWidth,
      sheetWidth: thumbState.sheetWidth,
      thumbCount: document.querySelectorAll('#thumbs .thumb').length,
      renderedThumbs: thumbState.rendered.length,
      maxThumbs: SigK.viewerLayout.maxThumbs(thumbState.columns),
      viewRatios: viewRatios.slice(0, 12),
      thumbRatios: thumbRatios.slice(0, 12),
      ratiosMatch,
      planMs,
      applyMs,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
  })()`;

  // SIGK_SMOKE_SAVE=<出力先> を付けると、保存の経路を丸ごと1回通す
  // （spec-1-6 の完了判定8）。SIGK_SMOKE_PDF と一緒に使う。
  //
  // ここでしか分からないことが2つある。**ワーカーが配布物（asar）の中から
  // fork できるか**と、**レンダラーからワーカーまでが本当につながっているか**
  // である。テストはレンダラー側を偽の taskAPI で、ワーカー側を直接呼びで
  // 見ているので、この2つは通しでしか確かめられない。
  //
  // **名前を付けて保存ではなく上書き保存で通す。**保存ダイアログは OS のもので
  // 自動では押せず、pickSavePath を差し替えて逃げることもできない。
  // contextBridge で公開したオブジェクトへの代入は**例外も出さずに無視される**
  // ためである（実測）。入力を出力先へ複製してから、その複製を開いて上書きする。
  // .bak が出来るかも同時に確かめられる。
  const saveScript = (target) => `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const SigK = window.SigK;

    await SigK.tabs.openPath(${JSON.stringify(target)});
    await wait(700);
    const before = SigK.viewer.getState().pageCount;

    // 1ページ目を90度回して末尾へ送る。保存された中身が plan どおりかを、
    // ページ数と回転で確かめられるようにするためである。
    SigK.shell.setMode(document, 'pages');
    SigK.pageEdit.rotate(90, [0]);
    if (before > 1)
      SigK.viewer.applyPlan(SigK.pagePlan.movePages(SigK.viewer.getPlan(), [0], before).plan);
    await wait(200);
    const dirtyBefore = SigK.viewer.isDirty();

    const started = Date.now();
    const result = await SigK.save.saveActive();
    const ms = Date.now() - started;
    await wait(300);

    const banner = SigK.viewBanner.text();
    const dirtyAfter = SigK.viewer.isDirty();

    // 書いたものを開き直して、並びが移っているかを見る。上書きなので
    // いったん閉じてから開く（同じパスのタブは作り直されない）。
    let reopened = null;
    if (result && result.ok === true) {
      const id = SigK.tabs.activeId();
      SigK.tabs.forceCloseTab(id);
      await wait(200);
      await SigK.tabs.openPath(${JSON.stringify(target)});
      await wait(700);
      const state = SigK.viewer.getState();
      // pdf.js のページから /Rotate を直に読む。開き直したあとの plan は
      // 連番なので、ここに 90 が出れば回転がファイルへ焼き付いたことになる。
      const last = await SigK.viewer.getPage(state.pageCount);
      reopened = {
        pageCount: state.pageCount,
        lastRotation: last ? last.rotate : null,
      };
    }

    return {
      before,
      dirtyBefore,
      ok: result ? result.ok === true : false,
      error: result ? (result.error ?? null) : 'result が無い',
      bytes: result ? (result.bytes ?? null) : null,
      backup: result ? (result.backup ?? null) : null,
      dirtyAfter,
      banner,
      ms,
      reopened,
    };
  })()`;

  // SIGK_SMOKE_DRAG=<from>-<to> を付けると、サムネイルのドラッグを
  // Chromium の Input.dispatchMouseEvent で再現する（完了判定の未検証項目）。
  // 送るのは mouse 系だが、Chromium は互換のため pointer 系も一緒に発火する。
  // これが効けば、並べ替えの経路を人の手を借りずに確かめられる。
  async function dispatchPageDrag(from, to) {
    const boxes = await win.webContents.executeJavaScript(`(() => {
      const thumbs = [...document.querySelectorAll('#thumbs .thumb')];
      const box = (index) => {
        const rect = thumbs[index].getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      };
      return { from: box(${from}), to: box(${to}), count: thumbs.length };
    })()`);

    const { debugger: dbg } = win.webContents;
    dbg.attach('1.3');
    try {
      const base = { button: 'left', buttons: 1, clickCount: 1 };
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...boxes.from, ...base });
      // 閾値（5px）を超えるまでを刻んで送る。1回で飛ばすと、掴む判定と
      // 落とす判定が同じフレームに来て挙動が変わる。
      for (const ratio of [0.2, 0.5, 0.8, 1]) {
        await dbg.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(boxes.from.x + (boxes.to.x - boxes.from.x) * ratio),
          y: Math.round(boxes.from.y + (boxes.to.y - boxes.from.y) * ratio),
          button: 'left',
          buttons: 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...boxes.to, ...base });
    } finally {
      dbg.detach();
    }
    return boxes;
  }

  const dragResultScript = `(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return {
      plan: window.SigK.viewer.getPlan().slice(0, 12).map((page) => page.src + ':' + page.rotate),
      selection: window.SigK.pageGrid.getSelection(),
      dirty: window.SigK.viewer.isDirty(),
      historyDepth: window.SigK.pageEdit.getHistoryState().depth,
      dragging: window.SigK.pageGrid.isDragging(),
      lineLeft: document.querySelector('.drop-line') === null,
    };
  })()`;

  // SIGK_SMOKE_DROP=<path> を付けると、本物のドラッグ＆ドロップを再現する。
  // Chromium の Input.dispatchDragEvent に実ファイルのパスを渡すと、ページには
  // OS から落としたときと同じ File が届く。webUtils.getPathForFile がそこから
  // パスを取り出せるか（spec-1-2 確定事項6）を、人の手を借りずに確かめられる。
  async function dispatchDrop(filePath) {
    const { debugger: dbg } = win.webContents;
    dbg.attach('1.3');
    try {
      const data = { items: [], files: [filePath], dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop'])
        await dbg.sendCommand('Input.dispatchDragEvent', { type, x: 640, y: 400, data });
    } finally {
      dbg.detach();
    }
  }

  const dropResultScript = `(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const state = window.SigK.viewer.getState();
    return {
      tabCount: window.SigK.tabs.count(),
      names: [...document.querySelectorAll('#tabbar .tab .name')].map((el) => el.textContent),
      openedName: state.file && state.file.name,
      openedPath: state.file && state.file.path,
      pageCount: state.pageCount,
      message: document.getElementById('view-empty').hidden ? null : document.getElementById('view-message').textContent,
      overlayHidden: document.getElementById('view-drop').hidden,
    };
  })()`;

  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      const bounds = win.getBounds();
      let shell = null;
      let pdf = null;
      let tabs = null;
      let text = null;
      let find = null;
      let print = null;
      let pages = null;
      let save = null;
      let drag = null;
      let drop = null;
      try {
        // SIGK_SMOKE_THROW=1 のときだけ、例外がレンダラーからログへ届くかを確かめる。
        if (process.env.SIGK_SMOKE_THROW === '1')
          await win.webContents.executeJavaScript('setTimeout(() => { throw new Error("起動確認の意図的な例外"); }, 0); true');
        shell = await win.webContents.executeJavaScript(readShellState);
        if (process.env.SIGK_SMOKE_PDF)
          pdf = await win.webContents.executeJavaScript(openPdfScript(path.resolve(process.env.SIGK_SMOKE_PDF)));
        if (process.env.SIGK_SMOKE_TABS) {
          const paths = process.env.SIGK_SMOKE_TABS.split(',').map((p) => path.resolve(p.trim()));
          tabs = await win.webContents.executeJavaScript(tabsScript(paths));
        }
        if (process.env.SIGK_SMOKE_TEXT === '1')
          text = await win.webContents.executeJavaScript(textScript);
        if (process.env.SIGK_SMOKE_FIND)
          find = await win.webContents.executeJavaScript(findScript(process.env.SIGK_SMOKE_FIND));
        // ページ編集を先に済ませてから印刷を測る。回転が 150dpi の画像に
        // 載るか（確定事項39）を、同じ起動の中で確かめられる。
        if (process.env.SIGK_SMOKE_PAGES)
          pages = await win.webContents.executeJavaScript(pagesScript(process.env.SIGK_SMOKE_PAGES));
        if (process.env.SIGK_SMOKE_PRINT)
          print = await win.webContents.executeJavaScript(printScript(process.env.SIGK_SMOKE_PRINT));
        // 保存はいちばん後ろに置く。前の段（開く・編集）が済んだ状態で通したいのと、
        // 書いたファイルを開き直してタブを増やすためである。
        if (process.env.SIGK_SMOKE_SAVE && process.env.SIGK_SMOKE_PDF) {
          const savePath = path.resolve(process.env.SIGK_SMOKE_SAVE);
          // 入力そのものを書き換えないよう、複製を作ってそちらを上書きする。
          fs.copyFileSync(path.resolve(process.env.SIGK_SMOKE_PDF), savePath);
          save = await win.webContents.executeJavaScript(saveScript(savePath));
        }
        if (process.env.SIGK_SMOKE_DRAG) {
          const [from, to] = process.env.SIGK_SMOKE_DRAG.split('-').map((value) => Number(value.trim()));
          const boxes = await dispatchPageDrag(from, to);
          drag = { boxes, ...(await win.webContents.executeJavaScript(dragResultScript)) };
        }
        if (process.env.SIGK_SMOKE_DROP) {
          await dispatchDrop(path.resolve(process.env.SIGK_SMOKE_DROP));
          drop = await win.webContents.executeJavaScript(dropResultScript);
        }
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
        tabs,
        text,
        find,
        print,
        pages,
        save,
        drag,
        drop,
        screenshot,
        problems,
      }));
      // destroy ではなく close を使う。設定の保存を通す経路と同じにするため。
      //
      // ただし未保存の確認は飛ばす（spec-1-5 確定事項56）。起動確認は編集を
      // する経路（SIGK_SMOKE_PAGES）を持つので、そのまま閉じると確認の
      // ダイアログが出たまま誰も押さず、いつまでも終わらない。
      allowClose = true;
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
  // ワーカーは asar の中からでも fork できる（spec-1-6 事前調査 A で実測）。
  // require ではなくパスで渡すので、配布物への入れ忘れは
  // test/dist-files.test.js が入口として見張っている。
  taskRunner = createTaskRunner({
    utilityProcess,
    workerPath: path.join(ROOT_DIR, 'worker', 'pdf-task.js'),
    onError: logError,
  });

  protocol.handle(APP_SCHEME, createAppProtocolHandler(ROOT_DIR));
  applySecurity(session.defaultSession);
  buildAppMenu();
  registerIpc();
  mainWindow = createMainWindow();

  if (process.env.SIGK_SMOKE === '1')
    installSmokeCheck(mainWindow);

  // 1つ目のプロセス自身の引数も同じ経路に載せる。
  queueLaunch(process.argv);
}

app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
// 保存中は終了を塞いである（確定事項9）ので普通は起きないが、万一残っていたら
// ワーカーを落として書きかけの一時ファイルも片づける。元ファイルは無傷である。
app.on('before-quit', () => taskRunner?.cancelAll());

app.on('window-all-closed', () => app.quit());

process.on('uncaughtException', (err) => {
  logError({ message: '捕捉されない例外', stack: err.stack, context: { where: 'main' } });
});
process.on('unhandledRejection', (reason) => {
  logError({ message: '処理されない拒否', stack: reason?.stack, context: { where: 'main', reason: String(reason) } });
});

// 2つ目以降のプロセスは窓を開かず、引数だけを1つ目へ渡して終わる（確定事項80）。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    queueLaunch(argv);
    if (mainWindow === null)
      return;
    if (mainWindow.isMinimized())
      mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(start);
}
