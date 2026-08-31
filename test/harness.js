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

// index.html が読み込む順に <script src> のパスを返す。
// renderer に新しいファイルを足したのに index.html へ書き忘れる、を検出できる。
function readScriptSources(document) {
  return [...document.querySelectorAll('script[src]')].map((el) => el.getAttribute('src'));
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

async function createShell({ appInfo = DEFAULT_APP_INFO, withApis = true } = {}) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const dom = new JSDOM(html, {
    url: pathToFileURL(INDEX_PATH).href,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const logs = [];

  if (withApis) {
    window.appInfoAPI = { available: true, get: async () => appInfo };
    window.appLogAPI = {
      available: true,
      error: async (entry) => {
        logs.push(entry);
        return { ok: true };
      },
    };
  }

  const sources = readScriptSources(window.document);
  for (const src of sources) {
    const filePath = path.join(ROOT, ...src.split('/'));
    window.eval(fs.readFileSync(filePath, 'utf8'));
  }

  await waitForReady(window);

  return {
    dom,
    window,
    document: window.document,
    SigK: window.SigK,
    logs,
    sources,
    // タイマーが残ると npm test が終わらなくなる。必ず呼ぶこと。
    cleanup: () => window.close(),
  };
}

module.exports = { ROOT, INDEX_PATH, DEFAULT_APP_INFO, readScriptSources, waitForReady, createShell };
