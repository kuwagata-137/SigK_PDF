'use strict';

// 1 本の PDF から別の 1 本を書き出すツールの出力先と後始末（spec-4-5 確定事項40〜44）。
// 透かし（tools-watermark.test.js）とフラット化の画面テストも同じ経路を通る。ここは部品そのものを見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const OUT = 'C:\\out\\a_x.pdf';

async function openShell(t, options = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }), [OUT]: makeSource({ path: OUT }) }, ...options });
  t.after(() => shell.cleanup());
  await shell.flush();
  return shell;
}

const MESSAGES = { canceled: 'やめました。', failed: 'できませんでした。', done: '書きました' };

test('refusalFor は入力と同じ出力先（大文字小文字・区切りを問わず）と、タブで開いている出力先を断る', async (t) => {
  const shell = await openShell(t);
  const { refusalFor } = shell.SigK.rewriteOutput;
  assert.equal(refusalFor('c:/work/A.PDF', A), '出力先に入力ファイルと同じファイルは選べません。');
  assert.equal(refusalFor(B, A), null);
  await shell.SigK.tabs.openPath(B);
  assert.equal(refusalFor('C:/WORK/b.pdf', A), '出力先のファイルはタブで開いています。タブを閉じるか、別の名前を選んでください。');
});

test('chooseTarget は保存ダイアログの答えを { target } / { canceled } / { error } にする', async (t) => {
  const shell = await openShell(t, { savePathResults: [{ path: OUT }, { canceled: true }, { error: '選べませんでした。' }, { path: A }] });
  const choose = () => shell.SigK.rewriteOutput.chooseTarget({ sourcePath: A, defaultPath: 'C:\\work\\a_x.pdf', title: 'T' });
  assert.deepEqual(structuredClone(await choose()), { target: OUT });
  assert.deepEqual(structuredClone(await choose()), { canceled: true });
  assert.deepEqual(structuredClone(await choose()), { error: '選べませんでした。' });
  assert.deepEqual(structuredClone(await choose()), { error: '出力先に入力ファイルと同じファイルは選べません。' });
  assert.equal(shell.SigK.viewBanner.text(), '出力先に入力ファイルと同じファイルは選べません。');
  assert.deepEqual(structuredClone(shell.savePathCalls[0]), { defaultPath: 'C:\\work\\a_x.pdf', title: 'T' });
});

test('finish は中止と失敗を帯で伝え、書けたら新しいタブで開いて閲覧モードへ移る', async (t) => {
  const shell = await openShell(t);
  const { finish } = shell.SigK.rewriteOutput;
  shell.SigK.shell.setMode(shell.document, 'tools');
  await finish({ canceled: true }, OUT, MESSAGES);
  assert.equal(shell.SigK.viewBanner.text(), 'やめました。');
  // 自分で止めたので、失敗の赤ではなく青で出す（決定49）。
  assert.equal(shell.document.getElementById('view-banner').getAttribute('data-tone'), 'info');
  await finish({ error: 'ワーカーの文言' }, OUT, MESSAGES);
  assert.equal(shell.SigK.viewBanner.text(), 'ワーカーの文言');
  await finish(undefined, OUT, MESSAGES);
  assert.equal(shell.SigK.viewBanner.text(), 'できませんでした。');
  assert.equal(shell.SigK.tabs.count(), 0);
  await finish({ ok: true }, OUT, MESSAGES);
  assert.equal(shell.SigK.tabs.list()[0].path, OUT);
  assert.equal(shell.document.documentElement.getAttribute('data-mode'), 'view');
  assert.equal(shell.SigK.viewBanner.text(), '書きました');
  // 成功は失敗ではないので赤く塗らない（決定48）。帯の既定の色は失敗の赤である。
  assert.equal(shell.document.getElementById('view-banner').getAttribute('data-tone'), 'info');
});

test('タブが上限なら開かず、「最近使ったファイル」に足して帯で伝える', async (t) => {
  const shell = await openShell(t);
  shell.SigK.tabs.count = () => shell.SigK.tabs.MAX_TABS;
  await shell.SigK.rewriteOutput.finish({ ok: true }, OUT, MESSAGES);
  assert.equal(shell.SigK.viewBanner.text(), '書きました。タブが多すぎるため開いていません。');
  // 開かなかっただけで書けてはいるので、失敗の赤にしない（決定48）。
  assert.equal(shell.document.getElementById('view-banner').getAttribute('data-tone'), 'info');
  assert.equal(shell.recentCalls.some((call) => JSON.stringify(call).includes('a_x.pdf')), true);
  assert.equal(shell.SigK.tabs.list().length, 0);
});
