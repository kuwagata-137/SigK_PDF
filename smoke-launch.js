'use strict';

// 起動確認 SIGK_SMOKE_LAUNCH=<待ち時間ms>（spec-1-6 確定事項72〜80・spec-5-1 確定事項35〜37）。
// main.js の installSmokeCheck が使う（2,000 行を超えた main.js にこれ以上足さないため分けた。
// smoke-rewrite.js と同じ）。`--open`・`--merge`・`--split`・`--to-pdf` と絶対パスを付けて起こす。
//
// **ここでしか分からないことがある。**実機の argv がどう届くか（並べ替えと
// `--allow-file-access-from-files` の差し込み）、レンダラーが購読を始めるまで保持した要求が
// 本当に流れるか、右クリックで N 本起きたプロセスの要求が 1 つの窓の画面にまとまるか、である。
// テストは argv を手で組み、購読の順番もスタブで見ているので、通しでしか確かめられない。
//
// 待ち時間の間に 2 本目以降のプロセスを起こす。**`second-instance` の argv は並べ替えられる**ので、
// そこを通してこそ確かめられる。起動確認は常に `--user-data-dir=<scratchpad>` を付けて常用の
// SigK PDF から切り離し、2 本目以降にも同じ指定を付けて転送させる（事前調査 A0）。

// 画面で回すスクリプト（async の即時関数の式）。待ってから、画面の様子を JSON にできる形で返す。
function launchScript(waitMs) {
  const wait = Math.max(0, Math.round(Number(waitMs) || 0));
  return `(async () => {
    await new Promise((resolve) => setTimeout(resolve, ${wait}));
    const SigK = window.SigK;
    const state = SigK.viewer.getState();
    const split = SigK.toolsSplit.source();
    return {
      mode: document.documentElement.getAttribute('data-mode'),
      tool: SigK.tools.selected(),
      tabCount: SigK.tabs.count(),
      names: [...document.querySelectorAll('#tabbar .tab .name')].map((el) => el.textContent),
      openedName: state.file && state.file.name,
      pageCount: state.pageCount,
      message: document.getElementById('view-empty').hidden ? null : document.getElementById('view-message').textContent,
      merge: SigK.toolsMerge.rows().map((row) => ({ name: row.name, batch: row.batch, pageCount: row.pageCount, blocked: row.blocked })),
      convert: SigK.toolsConvert.rows().map((row) => ({ name: row.name, batch: row.batch, kind: row.kind, blocked: row.blocked })),
      split: split === null ? null : { name: split.name, pageCount: split.pageCount, blocked: split.blocked },
      banner: SigK.viewBanner.text(),
      pending: SigK.launch.pending(),
    };
  })()`;
}

module.exports = { launchScript };
