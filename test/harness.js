'use strict';

// 画面テストの土台。index.html を jsdom で開き、レンダラーのスクリプトを
// 自前で順に評価する。
//
// runScripts:'outside-only' にすると、文書内の <script src> は実行されず
// window.eval だけが使える。読み込み順をこちらで制御できるのが利点で、
// jsdom の非同期なリソース読み込みに待たされることもない。
//
// CSS は jsdom が解釈しない。getBoundingClientRect() はすべて 0 を返すため、
// 寸法や配色の検証はここでは行わない。見た目は npm start の実測で担保する。

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'index.html');

const DEFAULT_APP_INFO = {
  ok: true,
  name: 'SigK PDF',
  version: '0.0.0-test',
  electron: '0.0.0',
  chrome: '0.0.0',
  node: process.versions.node,
  platform: process.platform,
};

// ビューアが読む寸法だけを与える。jsdom はレイアウトしないので、これが無いと
// 「見えている範囲」が常に空になり、倍率も配置も確かめられない。
const DEFAULT_VIEWPORT = { width: 900, height: 700 };

// サイドパネルのスクロール器の寸法。サムネイルの紙幅はここから決まるので、
// 与えないと枠が1枚も並ばない（spec-1-3 確定事項5）。
const DEFAULT_SIDE = { width: 240, height: 600 };

// 前回の見た目。settings.json に入っているものと同じ形にする。
const DEFAULT_UI = { mode: 'view', sidePanel: { open: true, width: 240 } };

const A4 = { width: 595.28, height: 841.89 };

// index.html が読み込む順に <script src> のパスを返す。
// renderer に新しいファイルを足したのに index.html へ書き忘れる、を検出できる。
function readScriptSources(document) {
  return [...document.querySelectorAll('script[src]')].map((el) => el.getAttribute('src'));
}

// window.eval で動かせるのは classic スクリプトだけである。
// renderer/pdfjs-bridge.mjs は import を含むため評価できない。代わりに
// window.SigK.pdfjs へスタブを差し込む（spec-1-1 確定事項18）。
function readClassicSources(document) {
  return [...document.querySelectorAll('script[src]')]
    .filter((el) => el.getAttribute('type') !== 'module')
    .map((el) => el.getAttribute('src'));
}

// pdf.js の TextLayer の代わり（spec-1-3 確定事項26）。
//
// 本物は canvas の 2D コンテキストでフォントの高さを測るため、jsdom では
// 動かない。ここは「span を items の数だけ並べる」ところまでを真似る。
// 位置の正しさは jsdom では確かめられないので、npm start の実測で担保する。
function createTextLayerStub(layers) {
  return class TextLayerStub {
    constructor({ textContentSource, container, viewport }) {
      this.container = container;
      this.viewport = viewport;
      this.items = textContentSource?.items ?? [];
      this.canceled = false;
      this.settled = null;
      this.spans = [];
      layers.push(this);
    }

    render() {
      const doc = this.container.ownerDocument;
      for (const item of this.items) {
        const span = doc.createElement('span');
        span.textContent = item.str;
        this.container.append(span);
        this.spans.push(span);
      }
      this.settled = Promise.withResolvers();
      // 本物は読み終えた時点で解決する。ここは次のティックで済ませ、
      // 「解決前に cancel される」経路もテストから作れるようにしておく。
      queueMicrotask(() => {
        if (!this.canceled)
          this.settled.resolve();
      });
      return this.settled.promise;
    }

    // 本物と同じく、まだ終わっていなければ render() の promise を拒否する。
    // DOM は消さない（ページ枠ごと捨てられる前提）。
    cancel() {
      this.canceled = true;
      this.settled?.reject(new Error('TextLayer task cancelled.'));
    }

    get textDivs() {
      return this.spans;
    }

    // 本物と1対1で並ぶ、各 span の元の文字列（spec-1-4 確定事項14）。
    // 検索のハイライトが span の中身を組み替えたあと、元へ戻すのに使う。
    get textContentItemsStr() {
      return this.items.map((item) => item.str);
    }
  };
}

// 角度を 0/90/180/270 に丸める。pdf.js の PageViewport と同じ扱いにする
// （360 で剰余し、負値には +360 する）。
function normalizeAngle(degrees) {
  return (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
}

// pdf.js の代わり。ページの寸法を返し、描画は即座に終わったことにする。
//
// getDocument() は呼ばれるたびに別の文書を作る。タブは複数の文書を同時に
// 抱えるため、1つを使い回すと「どのタブの文書が破棄されたか」を確かめられない。
function createPdfjsStub({
  sizes = [A4, A4, A4],
  openError = null,
  info = {},
  // ページ1枚あたりのテキスト。null にすると TextLayer ごと使えない状態を作れる。
  textItems = ['あいうえお', 'かきくけこ'],
  // ページごとに違う本文を与えたいとき（検索のテスト）。0 起点の配列で、
  // 埋まっていないページは textItems へ落ちる。
  pageTextItems = null,
  // ページ自身の /Rotate（spec-1-5）。plan の相対角度はこれに足される。
  // 埋まっていないページは 0。
  rotations = null,
} = {}) {
  const rendered = [];
  // getViewport の呼び出し。どの元ページを、どの回転と倍率で見に行ったかが
  // 残る（spec-1-5 の写像と回転の検証）。jsdom には 2D コンテキストが無く
  // page.render() まで届かないので、rendered だけでは経路を追えない。
  const viewportCalls = [];
  const documents = [];
  const textLayers = [];

  function createDocument() {
    const document = {
      id: documents.length,
      numPages: sizes.length,
      destroyed: false,
      destroy() {
        document.destroyed = true;
      },
      async getMetadata() {
        return { info, metadata: null };
      },
      async getPage(number) {
        const size = sizes[number - 1];
        // pdf.js は /Rotate を 90 の倍数へ正規化して持つ。
        const rotate = normalizeAngle(rotations?.[number - 1] ?? 0);
        return {
          // 何ページ目を借りたのかをテストから見る。plan の写像の検証に使う。
          pageNumber: number,
          // どの文書から来たかも見る。差し込んだページは別の文書から引かれる
          // （spec-1-6 確定事項93）ので、これが無いと写像を確かめられない。
          docId: document.id,
          rotate,
          // 本物と同じく、rotation は絶対値として置き換える。既定値はページ
          // 自身の rotate である（spec-1-5 の事前調査）。
          getViewport: ({ scale, rotation = rotate }) => {
            const angle = normalizeAngle(rotation);
            const swapped = angle % 180 !== 0;
            viewportCalls.push({ page: number, rotation: angle, scale });
            return {
              width: (swapped ? size.height : size.width) * scale,
              height: (swapped ? size.width : size.height) * scale,
              rotation: angle,
              scale,
            };
          },
          render: () => {
            rendered.push(number);
            return { promise: Promise.resolve(), cancel: () => {} };
          },
          async getTextContent() {
            const items = pageTextItems?.[number - 1] ?? textItems ?? [];
            return { items: items.map((str) => ({ str })), styles: {} };
          },
        };
      },
    };
    documents.push(document);
    return document;
  }

  return {
    available: true,
    stub: true,
    rendered,
    viewportCalls,
    documents,
    textLayers,
    // 本物の pdfjs-bridge.mjs は lib に pdf.js の名前空間をそのまま載せる。
    // text-layer.js が TextLayer をここから取るので、同じ形にしておく。
    lib: { TextLayer: textItems === null ? undefined : createTextLayerStub(textLayers) },
    // 最後に開いた文書。1文書しか扱わないテストのための近道。
    get document() {
      return documents.at(-1) ?? null;
    },
    getDocument: () => ({
      promise: openError === null ? Promise.resolve(createDocument()) : Promise.reject(openError),
    }),
  };
}

// jsdom は構築直後の readyState が 'loading' で、DOMContentLoaded は次の
// ティックで発火する。実際の初期化経路をそのまま通すため、発火を待つ。
function waitForReady(window) {
  if (window.document.readyState !== 'loading')
    return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

function applyViewport(window, viewport) {
  const view = window.document.getElementById('view');
  if (view === null || viewport === null)
    return;
  Object.defineProperty(view, 'clientWidth', { value: viewport.width, configurable: true });
  Object.defineProperty(view, 'clientHeight', { value: viewport.height, configurable: true });
}

function applySide(window, side) {
  const scroll = window.document.getElementById('side-scroll');
  if (scroll === null || side === null)
    return;
  Object.defineProperty(scroll, 'clientWidth', { value: side.width, configurable: true });
  Object.defineProperty(scroll, 'clientHeight', { value: side.height, configurable: true });
}

// 読み込み結果を1つ作る。中身は使われないので、PDF の署名だけ入れておく。
function makeSource({ path = 'C:\\work\\sample.pdf', name = null, size = 2048, mtimeMs = 1 } = {}) {
  return {
    ok: true,
    path,
    name: name ?? path.split(/[\\/]/).pop(),
    size,
    // 保存の直前に外部での書き換えを見分けるための控え（spec-1-6 確定事項21）。
    mtimeMs,
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
  };
}

// ドロップされた File の代わり。webUtils が返すはずのパスを持たせておく。
function makeDroppedFile(name, filePath) {
  return { name, __path: filePath ?? `C:\\work\\${name}` };
}

function makeDataTransfer(files, { types = ['Files'] } = {}) {
  return { types, files, dropEffect: 'none' };
}

async function createShell({
  appInfo = DEFAULT_APP_INFO,
  withApis = true,
  viewport = DEFAULT_VIEWPORT,
  side = DEFAULT_SIDE,
  pdfjs = createPdfjsStub(),
  openResults = [],
  recent = [],
  ui = DEFAULT_UI,
  // パス → 読み込み結果。pdfAPI.read(path) がここを引く。
  files = {},
  // printAPI.print() が返すもの。取り消しや失敗の経路を作れる。
  printResult = { ok: true, canceled: false, reason: null },
  // taskAPI.run() が返すものの並び。1本ずつ取り出す（spec-1-6）。
  taskResults = [],
  // pdfAPI.pickSavePath() が返すものの並び。
  savePathResults = [],
  // pdfAPI.pickInsertSource() が返すものの並び（spec-1-6 確定事項53）。
  insertSourceResults = [],
} = {}) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const dom = new JSDOM(html, {
    url: pathToFileURL(INDEX_PATH).href,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const logs = [];
  const openRequestHandlers = [];
  const docInfoRequestHandlers = [];
  const recentCalls = [];
  const uiCalls = [];
  const printCalls = [];
  const closeRequestHandlers = [];
  // メインへ知らせた未保存のタブ数と、確認の答え（spec-1-5 確定事項56）。
  const dirtyCalls = [];
  const closeAnswers = [];
  // taskAPI.run() に届いた spec の並びと、進捗を流す口（spec-1-6）。
  const taskCalls = [];
  const taskCancels = [];
  const progressHandlers = [];
  const saveRequestHandlers = [];
  const savePathCalls = [];
  const insertSourceCalls = [];
  let recentList = [...recent];
  let savedUi = structuredClone(ui);

  if (withApis) {
    window.appInfoAPI = { available: true, get: async () => appInfo };
    window.appLogAPI = {
      available: true,
      error: async (entry) => {
        logs.push(entry);
        return { ok: true };
      },
    };
    window.pdfAPI = {
      available: true,
      open: async () => openResults.shift() ?? { canceled: true },
      read: async (filePath) => files[filePath]
        ?? openResults.shift()
        ?? { error: '読み込み結果が用意されていません。' },
      // 本物は webUtils.getPathForFile を呼ぶ。ここでは仕込んだパスを返す。
      pathForFile: (file) => file?.__path ?? null,
      onOpenRequest: (callback) => openRequestHandlers.push(callback),
      onDocInfoRequest: (callback) => docInfoRequestHandlers.push(callback),
      // 保存先の選択と、メニューからの合図（spec-1-6 確定事項23・25）。
      pickSavePath: async (options) => {
        savePathCalls.push(structuredClone(options ?? {}));
        return savePathResults.shift() ?? { canceled: true };
      },
      onSaveRequest: (callback) => saveRequestHandlers.push(callback),
      // 差し込む元の選択（確定事項53）。形式の判定はワーカー側なので、
      // ここはパスを返すだけである。
      pickInsertSource: async (options) => {
        insertSourceCalls.push(structuredClone(options ?? {}));
        return insertSourceResults.shift() ?? { canceled: true };
      },
    };
    // 重い処理をワーカーへ出す口（spec-1-6 確定事項1〜10）。実際に書くのは
    // メイン側なので、ここは届いた spec と、返す結果だけを扱う。
    window.taskAPI = {
      available: true,
      run: async (taskId, spec) => {
        taskCalls.push({ taskId, spec: structuredClone(spec ?? {}) });
        return taskResults.shift() ?? { error: '結果が用意されていません。' };
      },
      cancel: async (taskId) => {
        taskCancels.push(taskId);
        return { ok: true };
      },
      onProgress: (callback) => progressHandlers.push(callback),
    };
    window.settingsAPI = {
      available: true,
      getUi: async () => ({ ok: true, ui: structuredClone(savedUi) }),
      setUi: async (patch) => {
        uiCalls.push(structuredClone(patch));
        savedUi = {
          mode: patch?.mode ?? savedUi.mode,
          sidePanel: { ...savedUi.sidePanel, ...(patch?.sidePanel ?? {}) },
        };
        return { ok: true, ui: structuredClone(savedUi) };
      },
    };
    // 未保存を持ったまま終了しようとしたときの往復（spec-1-5 確定事項56）。
    // 実際に窓を閉じるのはメイン側なので、ここは往復だけを真似る。
    window.appCloseAPI = {
      available: true,
      setDirty: (count) => dirtyCalls.push(count),
      onCloseRequest: (callback) => closeRequestHandlers.push(callback),
      confirm: async (ok) => {
        closeAnswers.push(ok);
        return { ok: true };
      },
    };
    // 印刷（spec-1-4 確定事項30）。実際に紙へ送るのはメイン側なので、
    // ここは呼ばれたことと渡された値だけを控える。
    window.printAPI = {
      available: true,
      print: async (options) => {
        printCalls.push(structuredClone(options ?? {}));
        return printResult;
      },
    };
    window.recentAPI = {
      available: true,
      list: async () => ({ ok: true, recent: recentList }),
      add: async (entry) => {
        recentCalls.push({ kind: 'add', entry });
        recentList = [entry, ...recentList.filter((e) => e.path !== entry.path)].slice(0, 10);
        return { ok: true, recent: recentList };
      },
      remove: async (filePath) => {
        recentCalls.push({ kind: 'remove', path: filePath });
        recentList = recentList.filter((e) => e.path !== filePath);
        return { ok: true, recent: recentList };
      },
    };
  }

  if (pdfjs !== null)
    window.SigK = { pdfjs };

  applyViewport(window, viewport);
  applySide(window, side);

  const sources = readScriptSources(window.document);
  for (const src of readClassicSources(window.document)) {
    const filePath = path.join(ROOT, ...src.split('/'));
    window.eval(fs.readFileSync(filePath, 'utf8'));
  }

  await waitForReady(window);

  return {
    dom,
    window,
    document: window.document,
    SigK: window.SigK,
    pdfjs,
    logs,
    sources,
    openResults,
    recentCalls,
    recentList: () => recentList,
    // 覚えた見た目と、そこへ届いた patch の並び。
    uiCalls,
    // printAPI.print() に届いたオプションの並び。
    printCalls,
    // taskAPI.run() に届いた { taskId, spec } の並び（spec-1-6）。
    taskCalls,
    // taskAPI.cancel() に届いた taskId の並び。
    taskCancels,
    // pdfAPI.pickSavePath() に届いたオプションの並び。
    savePathCalls,
    insertSourceCalls,
    // ワーカーからの進捗を流す。
    fireProgress: (progress) => progressHandlers.forEach((handler) => handler(progress)),
    // メニューの「保存」「名前を付けて保存…」から届く合図。
    fireSaveRequest: (mode) => saveRequestHandlers.forEach((handler) => handler(mode)),
    // appCloseAPI.setDirty() に届いた数の並び（最後が「いま」）。
    dirtyCalls,
    // appCloseAPI.confirm() に返した答えの並び。
    closeAnswers,
    // 終了しようとしていることをメインから知らせる。
    fireCloseRequest: () => Promise.all(closeRequestHandlers.map((handler) => handler())),
    savedUi: () => savedUi,
    // メニューの「開く」から届く合図を、テストから引く。パスを渡せば
    // 「最近使ったファイル」から選んだのと同じ経路になる。
    fireOpenRequest: (filePath) => openRequestHandlers.forEach((handler) => handler(filePath)),
    fireDocInfoRequest: () => docInfoRequestHandlers.forEach((handler) => handler()),
    // サイドパネルの幅を変えたことにする。jsdom はレイアウトしないので、
    // clientWidth を差し替えてから shell 経由で知らせる。
    resizeSide: (width) => {
      applySide(window, { width, height: side?.height ?? DEFAULT_SIDE.height });
      window.SigK.shell.setSidePanelWidth(window.document, width);
    },
    // ポインタ操作を送る（spec-1-5 のドラッグ並べ替え）。jsdom は
    // setPointerCapture も elementFromPoint も持たないので、実装側はどちらにも
    // 頼らない作りにしてある。座標はそのまま clientX / clientY に載る。
    firePointer: (node, type, { x = 0, y = 0, button = 0 } = {}) => {
      const Ctor = window.PointerEvent ?? window.MouseEvent;
      const event = new Ctor(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button,
        pointerId: 1,
      });
      node.dispatchEvent(event);
      return event;
    },
    // サイドパネルを縦にスクロールしたことにする。
    scrollSide: (top) => {
      const scroll = window.document.getElementById('side-scroll');
      scroll.scrollTop = top;
      scroll.dispatchEvent(new window.Event('scroll'));
    },
    // スクロール後の描画は requestAnimationFrame で1フレーム遅れる。待つための口。
    flush: () => new Promise((resolve) => {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
    }),
    // タイマーが残ると npm test が終わらなくなる。必ず呼ぶこと。
    cleanup: () => window.close(),
  };
}

module.exports = {
  ROOT,
  INDEX_PATH,
  DEFAULT_APP_INFO,
  DEFAULT_VIEWPORT,
  DEFAULT_SIDE,
  DEFAULT_UI,
  A4,
  readScriptSources,
  readClassicSources,
  createPdfjsStub,
  makeSource,
  makeDroppedFile,
  makeDataTransfer,
  waitForReady,
  applyViewport,
  applySide,
  createShell,
};
