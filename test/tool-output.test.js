'use strict';

// ツールで書き出した PDF の後始末（renderer/tool-output.js。決定80）。
//
// 結合・画像→PDF の「1 つにまとめる」・透かし・フラット化が同じ口を通る。各画面のテストも後始末を見ているが、
// ここは部品そのもの（タブで開く・モードを変えない・タブが上限なら開かない）を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const OUT = 'C:\\out\\a_結合.pdf';
const MESSAGES = { done: '書きました', crowded: '書きましたが、タブが多すぎるため開いていません。' };

async function openShell(t, options = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }), [OUT]: makeSource({ path: OUT }) }, ...options });
  t.after(() => shell.cleanup());
  // 前回の見た目の復元が届くのを待ってからモードを替える（tools-merge.test.js と同じ）。
  await shell.flush();
  return shell;
}

const modeOf = (shell) => shell.document.documentElement.getAttribute('data-mode');
const toneOf = (shell) => shell.document.getElementById('view-banner').getAttribute('data-tone');

test('書けた PDF は新しいタブで開き、ツールモードのままで、青の帯で知らせる', async (t) => {
  const shell = await openShell(t);
  shell.SigK.shell.setMode(shell.document, 'tools');

  assert.equal(await shell.SigK.toolOutput.openWritten(OUT, MESSAGES), true);

  assert.deepEqual(structuredClone(shell.SigK.tabs.list().map((tab) => tab.path)), [OUT]);
  assert.equal(modeOf(shell), 'tools', '閲覧モードへ移らない');
  assert.equal(shell.document.getElementById('tools-view').hidden, false);
  assert.equal(shell.SigK.viewBanner.text(), '書きました');
  // 成功は失敗ではないので赤く塗らない（決定48）。
  assert.equal(toneOf(shell), 'info');
});

test('ほかのモードで呼ばれても、モードは変えない', async (t) => {
  const shell = await openShell(t);
  shell.SigK.shell.setMode(shell.document, 'pages');

  await shell.SigK.toolOutput.openWritten(OUT, MESSAGES);

  assert.equal(shell.SigK.tabs.count(), 1);
  assert.equal(modeOf(shell), 'pages');
});

test('タブが上限なら開かず、「最近使ったファイル」に足して青の帯で知らせる', async (t) => {
  const shell = await openShell(t);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tabs.count = () => shell.SigK.tabs.MAX_TABS;

  assert.equal(await shell.SigK.toolOutput.openWritten(OUT, MESSAGES), false);

  assert.equal(shell.SigK.tabs.list().length, 0);
  assert.equal(shell.SigK.viewBanner.text(), '書きましたが、タブが多すぎるため開いていません。');
  // 開かなかっただけで書けてはいるので、失敗の赤にしない（決定48）。
  assert.equal(toneOf(shell), 'info');
  assert.equal(shell.recentCalls.some((call) => call.kind === 'add' && call.entry.path === OUT), true);
  assert.equal(modeOf(shell), 'tools');
});
