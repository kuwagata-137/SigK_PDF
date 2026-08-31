'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 配布物に入れ忘れがないことを見張る。
//
// electron-builder の files は手で並べた配列である。ルート直下にモジュールを
// 足したときに書き足すのを忘れると、npm test も npm run dist も緑のまま通り、
// インストーラーから入れたアプリだけが起動時に Cannot find module で落ちる。
// 塊② で recent-documents.js を取りこぼし、実際にそれが起きた。
//
// 見張り方は scripts/vendor.js の verifyVendorSources と同じ考え方である。
// 「必要なものの一覧」を実物から機械的に求め、宣言と突き合わせて欠けを列挙する。

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// アプリの入口。main は package.json が指すもの、preload は main.js が
// webPreferences へ渡すもので、どちらも require では辿れない。
const ENTRY_POINTS = [pkg.main, 'preload.js'];

const REQUIRE_LOCAL = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const HTML_ASSET = /(?:<script[^>]+src|<link[^>]+href)\s*=\s*["']([^"']+)["']/g;

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

function matchAll(text, pattern) {
  return [...text.matchAll(pattern)].map((m) => m[1]);
}

// ローカルの require を推移的に辿る。node: と node_modules は配布の対象外なので見ない。
function collectLocalRequires(entries) {
  const found = new Set();
  const queue = [...entries];

  while (queue.length > 0) {
    const rel = queue.shift();
    if (found.has(rel))
      continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs))
      throw new Error(`入口のファイルが無い: ${rel}`);
    found.add(rel);

    const dir = path.dirname(rel);
    for (const spec of matchAll(fs.readFileSync(abs, 'utf8'), REQUIRE_LOCAL))
      queue.push(toPosix(path.normalize(path.join(dir, spec))));
  }
  return [...found];
}

// index.html が読むもの。相対パスだけを見る（外部 URL は CSP が塞いでいる）。
function collectHtmlAssets(htmlFile) {
  const text = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
  const dir = path.dirname(htmlFile);
  return matchAll(text, HTML_ASSET)
    .filter((src) => !/^[a-z]+:/i.test(src) && !src.startsWith('/'))
    .map((src) => toPosix(path.normalize(path.join(dir, src))));
}

// files に書けるのは「そのままのパス」と「dir/**」の2種類だけである。
// 一般の glob は解釈しない。増やしたくなったらここを直す前に、書き方を
// 揃えられないかを考えること。
function isCovered(rel, patterns) {
  return patterns.some((pattern) => {
    if (pattern === rel)
      return true;
    if (!pattern.endsWith('/**'))
      return false;
    return rel.startsWith(`${pattern.slice(0, -2)}`);
  });
}

test('files のパターンは そのままのパス か dir/** のどちらかである', () => {
  for (const pattern of pkg.build.files) {
    const ok = pattern.endsWith('/**') || !pattern.includes('*');
    assert.ok(ok, `解釈できないパターン: ${pattern}（isCovered を直すこと）`);
  }
});

test('main と preload から辿れるモジュールがすべて配布物に入る', () => {
  const needed = collectLocalRequires(ENTRY_POINTS);
  const missing = needed.filter((rel) => !isCovered(rel, pkg.build.files));

  assert.deepEqual(missing, [], `package.json の build.files に足りない: ${missing.join(', ')}`);
  // 入口2本と、いま実在するルート直下のモジュールを辿れているかの目安。
  assert.ok(needed.length >= 7, `辿れた数が少なすぎる（${needed.length} 件）。正規表現が効いていない疑い`);
});

test('index.html が読むスクリプトとスタイルがすべて配布物に入る', () => {
  const assets = collectHtmlAssets('index.html');
  const missing = assets.filter((rel) => !isCovered(rel, pkg.build.files));

  assert.deepEqual(missing, [], `package.json の build.files に足りない: ${missing.join(', ')}`);
  assert.ok(assets.length > 0, 'index.html から読み込み対象を1件も拾えていない');
});

test('files に書いたものが実在する', () => {
  const missing = pkg.build.files
    .map((pattern) => (pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern))
    // vendor/ は npm install の postinstall が作る。テストの前提にしない。
    .filter((rel) => rel !== 'vendor')
    .filter((rel) => !fs.existsSync(path.join(ROOT, rel)));

  assert.deepEqual(missing, [], `build.files が実在しないものを指している: ${missing.join(', ')}`);
});
