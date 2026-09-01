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
} = {}) {
  const rendered = [];
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
        return {
          getViewport: ({ scale }) => ({ width: size.width * scale, height: size.height * scale }),
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
function makeSource({ path = 'C:\\work\\sample.pdf', name = null, size = 2048 } = {}) {
  return {
    ok: true,
    path,
    name: name ?? path.split(/[\\/]/).pop(),
    size,
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
