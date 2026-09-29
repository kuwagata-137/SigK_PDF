'use strict';

// フラット化の画面（spec-4-5 確定事項7〜11・32・34・38・40〜44）。
//
// 焼き込むのはワーカーで、その中身は test/op-flatten.test.js が見ている。ここは「対象を決めたら件数を
// 数え、残すもの・失うものを出し、確認のあと何をワーカーへ渡し、終わったら何をするか」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, makeDroppedFile, makeDataTransfer } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const OUT = 'C:\\out\\a_フラット化.pdf';
const CENSUS = {
  ok: true, baked: 12, kept: 3, notes: 2,
  bake: { markup: 4, text: 2, shape: 3, note: 2, other: 1 },
  keep: { functional: 1, noAppearance: 2, hidden: 0 },
};

async function createFlattenShell(t, options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }), [OUT]: makeSource({ path: OUT }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('flatten');
  return shell;
}

const plain = (value) => structuredClone(value);
const byId = (shell, id) => shell.document.getElementById(id);
const summary = (shell) => byId(shell, 'fl-summary').textContent;
const runButton = (shell) => byId(shell, 'fl-run');

async function settle(shell) {
  for (let index = 0; index < 4; index += 1)
    await shell.flush();
}

async function withSource(shell) {
  await shell.SigK.toolsFlatten.setSource(A);
  await settle(shell);
}

test('一覧に「フラット化」が並び、対象が無いうちは実行できない', async (t) => {
  const shell = await createFlattenShell(t);
  const item = shell.document.querySelector('#tools-list .tool-item[data-tool="flatten"]');
  assert.match(item.textContent, /フラット化書き込みを焼き込む/);
  assert.equal(shell.SigK.tools.panelFor('flatten').hidden, false);
  assert.equal(summary(shell), '焼き込む PDF を決めてください。');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(byId(shell, 'fl-list').hidden, true);
});

test('対象を決めるとワーカーで数え、まとまりごとの件数・残すもの・失うものを出す', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS] });
  await withSource(shell);
  assert.deepEqual(plain(shell.taskCalls.map((call) => call.spec)), [{ kind: 'flatten-preview', source: A }]);
  const rows = [...byId(shell, 'fl-list').querySelectorAll('.fl-row')];
  assert.deepEqual(rows.map((row) => row.textContent), [
    'ハイライト・下線・取り消し線4 件', 'テキスト2 件', '図形・ペン3 件', 'ノート2 件', 'スタンプなど1 件',
  ]);
  assert.equal(byId(shell, 'fl-list').querySelector('.total').textContent, '合計12 件');
  assert.equal(byId(shell, 'fl-keep-text').textContent,
    'リンク・フォームの欄など 1 件はそのまま残します。見た目の情報を持たない書き込み 2 件（直線・テキストなど）は焼き込めないため、書き込みのまま残します。');
  assert.equal(byId(shell, 'fl-warn').textContent, 'ノート 2 件は付箋の絵だけが残り、本文と作成者は書き出したファイルに残りません。');
  assert.equal(summary(shell), '書き込み 12 件を焼き込みます');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), null);
  // 数え終えたら「注釈を確認しています」の帯は下げる。
  assert.equal(shell.SigK.viewBanner.isVisible(), false);
});

test('0 件のまとまりと文は出さない。焼くものが無ければ実行できない', async (t) => {
  const shell = await createFlattenShell(t, {
    taskResults: [{ ok: true, baked: 0, kept: 1, notes: 0, bake: { markup: 0, text: 0, shape: 0, note: 0, other: 0 }, keep: { functional: 1, noAppearance: 0, hidden: 0 } }],
  });
  await withSource(shell);
  assert.equal(byId(shell, 'fl-list').hidden, true);
  assert.equal(byId(shell, 'fl-status').textContent, '焼き込める書き込みがありません。');
  assert.equal(byId(shell, 'fl-keep-text').textContent, 'リンク・フォームの欄など 1 件はそのまま残します。');
  assert.equal(byId(shell, 'fl-warn').hidden, true);
  assert.equal(summary(shell), '焼き込める書き込みがありません。');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
});

test('数えられなければ理由を出して実行できない', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [{ error: 'この PDF は内容が壊れているため保存できません。' }] });
  await withSource(shell);
  assert.equal(byId(shell, 'fl-status').textContent, 'この PDF は内容が壊れているため保存できません。');
  assert.equal(summary(shell), 'この PDF は内容が壊れているため保存できません。');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
});

test('パスワード付き・壊れた PDF はパスワードを聞かずに断り、数えずに実行できない', async (t) => {
  for (const [pdfjs, pattern] of [[createPdfjsStub({ password: 'secret' }), /パスワード付き/], [createPdfjsStub({ openError: new Error('broken') }), /開けません/]]) {
    const shell = await createFlattenShell(t, { pdfjs });
    await withSource(shell);
    assert.match(shell.SigK.toolsFlatten.source().blocked, pattern);
    assert.equal(shell.SigK.passwordPrompt.isOpen?.() ?? false, false);
    assert.equal(shell.taskCalls.length, 0, '読めない対象はワーカーで数えない');
    assert.equal(shell.SigK.toolsFlatten.canRun(), false);
    assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  }
});

test('実行は保存ダイアログ → 確認（既定はキャンセル）→ 焼き込み。書けたら新しいタブで開く', async (t) => {
  const shell = await createFlattenShell(t, {
    taskResults: [CENSUS, { ok: true, baked: 12, kept: 3, notes: 2, path: OUT }],
    savePathResults: [{ path: OUT }],
  });
  await withSource(shell);
  const running = shell.SigK.toolsFlatten.run();
  await settle(shell);
  assert.deepEqual(plain(shell.savePathCalls), [{ defaultPath: 'C:\\work\\a_フラット化.pdf', title: 'フラット化した PDF を保存' }]);
  assert.equal(shell.SigK.confirmFlatten.isOpen(), true);
  assert.equal(shell.document.activeElement?.id, 'confirm-flatten-cancel');
  assert.equal(byId(shell, 'confirm-flatten-text').textContent,
    '書き込み 12 件をページの内容として焼き込み、「a_フラット化.pdf」に書き出します。書き出したファイルでは、これらの書き込みを選んだり直したりできません。元のファイルは変わりません。');
  assert.equal(byId(shell, 'confirm-flatten-notes').textContent, 'ノート 2 件の本文と作成者は、書き出したファイルに残りません。');
  assert.equal(shell.taskCalls.length, 1, '確認の前にはワーカーへ渡さない');
  byId(shell, 'confirm-flatten-ok').click();
  const result = await running;
  await settle(shell);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(shell.taskCalls[1].spec), { kind: 'flatten', source: A, target: OUT });
  assert.equal(shell.SigK.tabs.list().some((tab) => tab.path === OUT), true);
  assert.equal(shell.SigK.viewBanner.text(), '書き込み 12 件を焼き込みました');
});

test('保存ダイアログと確認の間も実行中と数え、キャンセルすれば下ろす（spec-5-1 確定事項12）', async (t) => {
  let answer;
  const dialog = new Promise((resolve) => { answer = resolve; });
  const shell = await createFlattenShell(t, { taskResults: [CENSUS], savePathResults: [dialog] });
  await withSource(shell);

  const running = shell.SigK.toolsFlatten.run();
  await settle(shell);
  assert.equal(shell.SigK.toolsFlatten.isRunning(), true, '保存ダイアログの間');
  answer({ path: OUT });
  await settle(shell);
  assert.equal(byId(shell, 'confirm-flatten').open, true);
  assert.equal(shell.SigK.toolsFlatten.isRunning(), true, '確認の間');

  byId(shell, 'confirm-flatten-cancel').click();
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(shell.SigK.toolsFlatten.isRunning(), false);
  assert.equal(shell.SigK.toolsFlatten.canRun(), true);
});

test('確認でキャンセルすれば焼き込まない', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS], savePathResults: [{ path: OUT }] });
  await withSource(shell);
  const running = shell.SigK.toolsFlatten.run();
  await settle(shell);
  byId(shell, 'confirm-flatten-cancel').click();
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(shell.taskCalls.length, 1);
});

test('入力と同じ出力先は、確認を出す前に断る', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS], savePathResults: [{ path: A }] });
  await withSource(shell);
  assert.equal((await shell.SigK.toolsFlatten.run()).error, '出力先に入力ファイルと同じファイルは選べません。');
  assert.equal(shell.SigK.confirmFlatten.isOpen(), false);
  assert.equal(shell.taskCalls.length, 1);
});

test('フラット化を選んでいるときの PDF のドロップは対象になる', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS] });
  const { SigK, window } = shell;
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  event.dataTransfer = makeDataTransfer([makeDroppedFile('b.pdf', B)]);
  await SigK.fileDrop.handleDrop(event);
  await settle(shell);
  assert.equal(SigK.toolsFlatten.source().path, B);
  assert.equal(SigK.tabs.count(), 0, 'タブには開かない');
  assert.deepEqual(plain(shell.taskCalls[0].spec), { kind: 'flatten-preview', source: B });
});

test('「開いているファイル」が未保存なら注意書きと帯を出す', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS] });
  const { document: doc, SigK } = shell;
  await SigK.tabs.openPath(A);
  await shell.flush();
  SigK.pageEdit.commit([{ src: 2, rotate: 0 }, { src: 0, rotate: 0 }, { src: 1, rotate: 0 }]);
  SigK.shell.setMode(doc, 'tools');
  byId(shell, 'fl-use-open').click();
  await settle(shell);
  assert.equal(byId(shell, 'fl-note').textContent, '未保存の編集は反映されません');
  // 数え終えて帯が下がる前に、未保存の帯が出ていたこと（数える帯は数え終えたら下げる）。
  assert.equal(SigK.toolsFlatten.source().note, '未保存の編集は反映されません');
});
