'use strict';

// vendor/ の CommonJS ファイルを、`require` の一部を差し替えて読む（spec-3-2 確定事項13）。
//
// utif（`vendor/utif.js`）は先頭で `require("pako")` するが、使うのは Deflate の
// `pako.inflate` だけである。素の `require` で読むと `vendor/node_modules/pako` が無くて
// 落ちるので、Node が CommonJS を読むときと同じラッパーを自分で組み、`require` に
// 「`pako` なら Node の zlib を包んだもの」を返す関数を渡す。pako を vendor に足さずに済む。
//
// ASAR の中でも `fs.readFileSync` は効く（Electron が fs に手を入れている）。

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCommonJs(file, { overrides = {}, fsLike = fs } = {}) {
  const source = fsLike.readFileSync(file, 'utf8');
  const wrapper = `(function (exports, require, module, __filename, __dirname) { ${source}\n});`;
  const compiled = vm.runInThisContext(wrapper, { filename: file });
  const loaded = { exports: {} };
  const requireWithOverrides = (id) => (Object.hasOwn(overrides, id) ? overrides[id] : require(id));
  compiled.call(loaded.exports, loaded.exports, requireWithOverrides, loaded, file, path.dirname(file));
  return loaded.exports;
}

module.exports = { loadCommonJs };
