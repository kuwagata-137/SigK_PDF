// このアプリで唯一の ES Modules である（spec-1-1 確定事項1）。
// pdf.js は ESM でしか配布されていないため、ここだけ import を使い、
// 設定を済ませた入口を window.SigK.pdfjs に載せる。以降のレンダラーは
// 従来どおり IIFE で書き、pdf.js を直接 import しない。
//
// CSP の script-src は 'self' なので、インラインの <script type="module"> は
// 書けない。だからこのファイルが外部ファイルとして存在する。

import * as pdfjsLib from '../vendor/pdf.mjs';

// app://sigk/vendor/ を指す。相対で解くので、配布先のパスに依存しない。
const VENDOR = new URL('../vendor/', import.meta.url).href;

pdfjsLib.GlobalWorkerOptions.workerSrc = `${VENDOR}pdf.worker.mjs`;

// 参照先はすべて vendor/ 配下の app:// URL である。外部の URL は書かない。
// isEvalSupported: false は PDF に埋め込まれた JavaScript の実行経路を塞ぐ
// ためで、docs/02 第6章の決定である。
const DOCUMENT_OPTIONS = Object.freeze({
  cMapUrl: `${VENDOR}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${VENDOR}standard_fonts/`,
  wasmUrl: `${VENDOR}wasm/`,
  iccUrl: `${VENDOR}iccs/`,
  isEvalSupported: false,
});

const SigK = (window.SigK = window.SigK || {});
SigK.pdfjs = {
  available: true,
  lib: pdfjsLib,
  VENDOR,
  DOCUMENT_OPTIONS,
  getDocument: (params) => pdfjsLib.getDocument({ ...DOCUMENT_OPTIONS, ...params }),
};

// module スクリプトは classic スクリプトより後に走る。viewer.js が先に
// 初期化されていても、この合図で pdf.js の到着を知れるようにしておく。
window.dispatchEvent(new Event('sigk:pdfjs-ready'));
