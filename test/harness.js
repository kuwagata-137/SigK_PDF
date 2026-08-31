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

// pdf.js の代わり。ページの寸法を返し、描画は即座に終わったことにする。
function createPdfjsStub({ sizes = [A4, A4, A4], openError = null } = {}) {
  const rendered = [];
  const document = {
    numPages: sizes.length,
    destroyed: false,
    destroy() {
      document.destroyed = true;
    },
    async getPage(number) {
      const size = sizes[number - 1];
      return {
        getViewport: ({ scale }) => ({ width: size.width * scale, height: size.height * scale }),
        render: () => {
          rendered.push(number);
          return { promise: Promise.resolve(), cancel: () => {} };
        },
      };
    },
  };

  return {
    available: true,
    stub: true,
    rendered,
    document,
    getDocument: () => ({
      promise: openError === null ? Promise.resolve(document) : Promise.reject(openError),
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

async function createShell({
  appInfo = DEFAULT_APP_INFO,
  withApis = true,
  viewport = DEFAULT_VIEWPORT,
  pdfjs = createPdfjsStub(),
  openResults = [],
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
      read: async () => openResults.shift() ?? { error: '読み込み結果が用意されていません。' },
      onOpenRequest: (callback) => openRequestHandlers.push(callback),
    };
  }

  if (pdfjs !== null)
    window.SigK = { pdfjs };

  applyViewport(window, viewport);

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
    // メニューの「開く」から届く合図を、テストから引く。
    fireOpenRequest: () => openRequestHandlers.forEach((handler) => handler()),
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
  A4,
  readScriptSources,
  readClassicSources,
  createPdfjsStub,
  waitForReady,
  applyViewport,
  createShell,
};
