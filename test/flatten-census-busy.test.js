'use strict';

// フラット化の書き込みを数える処理は、ほかの処理と同時に走らない（計画外の直し）。
//
// フラット化は、対象を決めるとワーカー（kind: flatten-preview）で書き込みを数える。走らせる枠（save.js の runTask）は
// 1 つしかないので、結合などが走っている間に数え始めると、走っている処理の記録を上書きしてしまう。数え終わると記録が
// 空になり、結合がまだ走っているのに「ほかの処理は走っていない」（save.isBusy が false）になって、ほかのツールの
// ［実行…］が押せてしまう。ここは、数える処理がほかの処理の終わりを待ってから走り、欄が埋まることを見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const MERGED = 'C:\\work\\merged.pdf';
const census = (baked) => ({
  ok: true, baked, kept: 0, notes: 0,
  bake: { markup: baked, text: 0, shape: 0, note: 0, other: 0 },
  keep: { functional: 0, noAppearance: 0, hidden: 0 },
});

const plain = (value) => structuredClone(value);
const byId = (shell, id) => shell.document.getElementById(id);
const kinds = (shell) => shell.taskCalls.map((call) => call.spec.kind);

async function settle(shell) {
  for (let index = 0; index < 4; index += 1)
    await shell.flush();
}

// 返事を待たせる Promise と、返事を返す関数の組。
function gated() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return { gate, release };
}

async function createToolsShell(t, options) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) }, ...options });
  t.after(() => shell.cleanup());
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  return shell;
}

// 結合を走らせ、ワーカーの返事を待たせておく。走っている Promise は包んで返す（そのまま返すと終わるまで待ってしまう）。
async function startMerge(shell) {
  const { SigK } = shell;
  // 結合する PDF は帯（＝タブ）。開くと結合の行に既定でチェックが入る（spec-2-5 確定事項E2）。
  await SigK.tabs.openPath(B);
  SigK.tools.select('merge');
  const running = SigK.toolsMerge.run();
  await settle(shell);
  assert.equal(SigK.save.isBusy(), true, '結合が走っている');
  return { running };
}

test('結合が走っている間に対象を決めても、書き込みは結合が終わってから数える', async (t) => {
  const merge = gated();
  const shell = await createToolsShell(t, { savePathResults: [{ path: MERGED }], taskResults: [merge.gate, census(3)] });
  const { SigK } = shell;
  const { running } = await startMerge(shell);

  SigK.tools.select('flatten');
  await SigK.toolsFlatten.setSource(A);
  await settle(shell);
  assert.deepEqual(kinds(shell), ['merge'], '結合が走っている間は、数える処理をワーカーへ渡さない');
  assert.equal(SigK.save.isBusy(), true, '結合がまだ走っている');
  assert.equal(SigK.toolsSplit.canRun(), false, 'ほかのツールの［実行…］は押せない');
  assert.equal(SigK.toolsFlatten.canRun(), false);
  assert.equal(byId(shell, 'fl-summary').textContent, '書き込みを数えています…');
  assert.equal(byId(shell, 'fl-run').getAttribute('aria-disabled'), 'true');

  // 画面には触らずに、結合を終わらせる（中止で終える）。
  merge.release({ canceled: true });
  await running;
  await settle(shell);
  assert.deepEqual(plain(shell.taskCalls.map((call) => call.spec)).slice(1), [{ kind: 'flatten-preview', source: A }]);
  assert.equal(SigK.save.isBusy(), false);
  assert.equal(byId(shell, 'fl-summary').textContent, '書き込み 3 件を焼き込みます');
  assert.equal(SigK.toolsFlatten.canRun(), true);
  assert.notEqual(byId(shell, 'fl-run').getAttribute('aria-disabled'), 'true');
  // 結合の知らせは、数える処理の帯に消されずに残る。
  assert.equal(SigK.viewBanner.text(), '結合を中止しました。');
});

test('結合の間に対象を決め、フラット化を見ないうちに結合が終わっても、フラット化を選べば数えて欄が埋まる', async (t) => {
  const merge = gated();
  const shell = await createToolsShell(t, { savePathResults: [{ path: MERGED }], taskResults: [merge.gate, census(2)] });
  const { SigK } = shell;
  const { running } = await startMerge(shell);

  SigK.tools.select('flatten');
  await SigK.toolsFlatten.setSource(A);
  await settle(shell);
  SigK.tools.select('merge');
  await settle(shell);
  assert.equal(SigK.save.isBusy(), true, '結合がまだ走っている');

  merge.release({ canceled: true });
  await running;
  await settle(shell);
  assert.equal(SigK.save.isBusy(), false, '結合が終わった');

  SigK.tools.select('flatten');
  await settle(shell);
  assert.deepEqual(kinds(shell), ['merge', 'flatten-preview']);
  assert.equal(SigK.save.isBusy(), false);
  assert.equal(byId(shell, 'fl-summary').textContent, '書き込み 2 件を焼き込みます');
  assert.equal(SigK.toolsFlatten.canRun(), true);
});

test('数えている間に対象を選び直すと、前の数えが終わってから選び直した PDF を数える', async (t) => {
  const first = gated();
  const shell = await createToolsShell(t, { taskResults: [first.gate, census(5)] });
  const { SigK } = shell;
  SigK.tools.select('flatten');
  await SigK.toolsFlatten.setSource(A);
  await settle(shell);
  assert.equal(SigK.save.isBusy(), true, 'a.pdf を数えている');

  await SigK.toolsFlatten.setSource(B);
  await settle(shell);
  assert.equal(shell.taskCalls.length, 1, 'a.pdf を数えている間は、b.pdf を数える処理をワーカーへ渡さない');
  assert.equal(SigK.save.isBusy(), true, 'a.pdf をまだ数えている');

  first.release(census(9));
  await settle(shell);
  assert.deepEqual(plain(shell.taskCalls.map((call) => call.spec)), [
    { kind: 'flatten-preview', source: A }, { kind: 'flatten-preview', source: B },
  ]);
  assert.equal(SigK.save.isBusy(), false);
  assert.equal(SigK.toolsFlatten.census().path, B);
  assert.equal(byId(shell, 'fl-summary').textContent, '書き込み 5 件を焼き込みます', 'a.pdf の数えた結果は捨てる');
});
