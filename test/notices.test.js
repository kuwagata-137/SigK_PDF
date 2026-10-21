'use strict';

// 第三者ソフトウェアの告知（THIRD-PARTY-NOTICES.md）を作る台本 scripts/notices.js の見張り（PR-6b の点検。docs/06 4-1・4-2）。
//
// pdfjs-dist の中には、パッケージの license（Apache-2.0）とは別の許諾を持つ資料が入っている（文字の対応表・標準の書体・wasm）。
// PR-6b の点検までは、文字の対応表と標準の書体（GPL の Liberation Sans を含む）の許諾が告知から漏れていた。
// パッケージの license の欄だけを見ても見つからないので、許諾のファイルが全部台本に載っていることを見張る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PDFJS = path.join(ROOT, 'node_modules', 'pdfjs-dist');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'scripts', 'notices.js'), 'utf8');

// pdfjs-dist の直下と、その下 1 段のフォルダにある LICENSE で始まるファイル（node_modules からの相対の書き方）。
function pdfjsLicenses() {
  const found = [];
  const visit = (dir, depth) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (depth === 0)
          visit(full, 1);
        continue;
      }
      if (/^LICENSE/i.test(name))
        found.push(`node_modules/pdfjs-dist/${path.relative(PDFJS, full).split(path.sep).join('/')}`);
    }
  };
  visit(PDFJS, 0);
  return found.sort();
}

test('pdfjs-dist の中の許諾のファイル（文字の対応表・標準の書体・wasm など）が、告知を作る台本に全部載っている', () => {
  const licenses = pdfjsLicenses();
  assert.ok(licenses.includes('node_modules/pdfjs-dist/standard_fonts/LICENSE_LIBERATION'), '見張る相手が見つからない（node_modules の形が変わった）');
  const missing = licenses.filter((file) => !SCRIPT.includes(`'${file}'`));
  assert.deepEqual(missing, [], `scripts/notices.js に載っていない許諾のファイル: ${missing.join(', ')}`);
});

test('GPL の書体 Liberation Sans は、ユーザーの確認（docs/07 決定82）を書いた節として載っている', () => {
  assert.match(SCRIPT, /name: 'Liberation Sans [^']*'/);
  assert.match(SCRIPT, /license: 'GPL-2\.0（書体の例外つき）'/);
  assert.match(SCRIPT, /決定82/);
});

// docs/06 4-1。fontkit の縮めたファイルには、作ったときに取り込まれた部品が著作権の表示を消された形で入っている（PR-6b の点検）。
test('fontkit に取り込まれている部品の告知の材料がそろい、台本がその節を組み立てる', () => {
  const { MIT_PACKAGES, MIT_TEXT, OTHER_PARTS } = require('../scripts/notices-fontkit.js');
  for (const entry of MIT_PACKAGES) {
    assert.ok(entry.name && entry.version && entry.copyright, `材料が欠けている: ${JSON.stringify(entry)}`);
  }
  // 縮める前のファイルで取り込まれていることを確かめた主な部品。
  for (const name of ['buffer', 'base64-js', 'iconv-lite', 'safer-buffer', 'deep-equal', 'dfa', 'tiny-inflate', 'unicode-trie', '@pdf-lib/brotli', '@pdf-lib/restructure'])
    assert.ok(MIT_PACKAGES.some((entry) => entry.name === name), `${name} が載っていない`);
  assert.match(MIT_TEXT, /^Permission is hereby granted, free of charge/);
  assert.deepEqual(OTHER_PARTS.map((entry) => entry.license.split('（')[0]), ['ISC', 'BSD-3-Clause', 'ISC', 'Apache-2.0']);
  assert.match(SCRIPT, /## 同梱するもの（fontkit に取り込まれている部品）/);
});
