'use strict';

// コマンドライン引数の解釈（spec-1-6 確定事項72〜80・docs/03 第3章）。
//
// Electron に依存しない純関数にしてある（`security-policy.js` と同じ作法）。
// `app.isPackaged` も `app.commandLine` も渡さない。前者は `process.argv` にしか
// 効かず、後者は**1つ目のプロセス自身の引数しか持たない**（実測 I）。
//
// 【スイッチの次を値とみなしてはいけない】（確定事項73）
// `second-instance` に届く argv は **`[exe, ...スイッチ..., ...位置引数...]` の順へ
// 並べ替えられ**、Electron が `--allow-file-access-from-files` を必ず差し込む
// （`disableHardwareAcceleration()` を呼んでいれば `--disable-gpu` も）。その結果
// `--open` と、その直後にあったはずのパスが**隣り合わなくなる**。素朴に組むと
// パスとして `--allow-file-access-from-files` を掴む。
// だから**意図はスイッチ側から、パスは位置引数側から**別々に取る。
//
// 【切り出しは argv.slice(1) で固定】（確定事項74）
// `argv[0]` が実行ファイルであることは全パターンで共通である。開発時は位置引数の
// 先頭へアプリのディレクトリが割り込むが、それは「実在するファイル」の条件で落ちる。

// **Windows の作法で解釈する。**このアプリは Windows 専用だが、テストは CI の
// ubuntu でも回る。素の `path` は走らせる OS の作法に従うので、Linux では
// `isAbsolute('C:\\...')` が false になり、同じ引数の答えが場所によって変わる。
// それで実際に CI が11件落ちた（2026-09-02）。win32 に固定して host に依らせない。
const path = require('node:path').win32;

// 意図を表すスイッチ。Chromium に横取りされないことは実測で確かめてある。
const INTENTS = {
  '--open': 'open',
  '--merge': 'merge',
  '--split': 'split',
  '--to-pdf': 'toPdf',
};

// 意図ごとに受け付ける拡張子。意図に合わないものを掴まないための2つ目の条件。
const EXTENSIONS = {
  open: ['.pdf'],
  merge: ['.pdf'],
  split: ['.pdf'],
  toPdf: ['.pdf', '.png', '.jpg', '.jpeg'],
};

// 裸のパスは「開く」として扱う（確定事項76）。exe へのドラッグ＆ドロップに備える。
const DEFAULT_INTENT = 'open';

function splitTokens(args) {
  const switches = [];
  const positional = [];
  for (const token of args) {
    if (typeof token !== 'string' || token === '')
      continue;
    if (token.startsWith('--'))
      switches.push(token);
    else
      positional.push(token);
  }
  return { switches, positional };
}

// 最初に見つかった意図のスイッチを採る。`--open=<path>` の形は1トークンのまま
// 届くので壊れない（実測 I）。その値もパスの候補に足す。
function readIntent(switches) {
  let intent = null;
  const values = [];
  for (const token of switches) {
    const at = token.indexOf('=');
    const name = at === -1 ? token : token.slice(0, at);
    const known = INTENTS[name];
    if (known === undefined)
      continue;                       // 知らないスイッチは黙って捨てる
    if (intent === null)
      intent = known;
    if (at !== -1)
      values.push(token.slice(at + 1));
  }
  return { intent, values };
}

// ①絶対パス ②拡張子が意図に合う ③実在するファイル、の3条件で絞る（確定事項75）。
// 開発時に位置引数へ割り込むアプリのディレクトリは③で落ちる。
function keepPaths(candidates, intent, isFile) {
  const allowed = EXTENSIONS[intent] ?? [];
  const paths = [];
  for (const value of candidates) {
    if (typeof value !== 'string' || value === '' || !path.isAbsolute(value))
      continue;
    if (!allowed.includes(path.extname(value).toLowerCase()))
      continue;
    if (isFile(value) !== true)
      continue;
    if (!paths.includes(value))
      paths.push(value);
  }
  return paths;
}

// 戻り値は null（受け取るものが無い）か { intent, paths }。
function parseLaunchArgs(argv, { isFile = () => false } = {}) {
  const args = Array.isArray(argv) ? argv.slice(1) : [];
  const { switches, positional } = splitTokens(args);
  const { intent, values } = readIntent(switches);
  const chosen = intent ?? DEFAULT_INTENT;
  const paths = keepPaths([...positional, ...values], chosen, isFile);

  // 意図のスイッチも使えるパスも無ければ、これは起動要求ではない
  // （スタートメニューからの素の起動がここに来る）。
  if (intent === null && paths.length === 0)
    return null;
  return { intent: chosen, paths };
}

module.exports = { INTENTS, EXTENSIONS, DEFAULT_INTENT, parseLaunchArgs };
