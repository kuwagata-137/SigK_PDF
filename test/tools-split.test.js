'use strict';

// 分割画面（spec-2-2 確定事項1〜32）。
//
// 実際に書くのはワーカーで、その中身は test/op-split.test.js が見ている。
// ここは「対象をどう決め、どう分け、どこへ出し、何をワーカーへ渡し、終わったら何をするか」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, makeDroppedFile, makeDataTransfer } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const OUT_DIR = 'C:\\out';
const targetsFor = (dir, names) => names.map((name) => `${dir}\\${name}`);
const A_TARGETS = targetsFor('C:\\work', ['a_001.pdf', 'a_002.pdf', 'a_003.pdf']);

async function createSplitShell(t, options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('split');
  return shell;
}

const plain = (value) => structuredClone(value);
const runButton = (shell) => shell.document.getElementById('split-run');
const bannerText = (shell) => shell.SigK.viewBanner.text();
const exampleText = (shell) => shell.document.getElementById('split-example').textContent;
const fire = (shell, id, value) => {
  const input = shell.document.getElementById(id);
  input.value = value;
  input.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
};

// ---- 対象（確定事項1〜5） ----

test('初期状態は対象が無く、実行は押せない', async (t) => {
  const shell = await createSplitShell(t);
  const { document: doc, SigK } = shell;
  assert.equal(SigK.toolsSplit.source(), null);
  assert.equal(doc.getElementById('split-empty').hidden, false);
  assert.equal(doc.getElementById('split-file').hidden, true);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(SigK.toolsSplit.canRun(), false);
  assert.equal(exampleText(shell), '');
});

test('「ファイルを選ぶ」で対象が決まり、ページ数・フォルダー・出力の例が埋まる', async (t) => {
  const shell = await createSplitShell(t, { splitSourceResults: [{ path: A }] });
  const { document: doc, SigK } = shell;
  assert.equal(await SigK.toolsSplit.pickFile(), true);
  const src = SigK.toolsSplit.source();
  assert.equal(src.path, A);
  assert.equal(src.pageCount, 3);
  assert.equal(doc.getElementById('split-name').textContent, 'a.pdf');
  assert.equal(doc.getElementById('split-pages').textContent, '3 ページ');
  assert.equal(doc.getElementById('split-empty').hidden, true);
  assert.equal(doc.getElementById('split-folder').textContent, 'C:\\work');
  // 既定は「1 ページごと」「連番」（確定事項7・8・15）。
  assert.deepEqual(plain(SigK.toolsSplit.currentPlan().targets), A_TARGETS);
  assert.equal(exampleText(shell), 'a_001.pdf … a_003.pdf（3 ファイル）');
  assert.equal(doc.getElementById('split-summary').textContent, '3 ページを 1 ページごとに 3 ファイルへ');
  assert.equal(doc.getElementById('split-rule-seq').textContent, 'a_001.pdf');
  assert.equal(doc.getElementById('split-rule-pages').textContent, 'a_p1.pdf');
  assert.equal(SigK.toolsSplit.canRun(), true);
  assert.equal(runButton(shell).hasAttribute('aria-disabled'), false);
  assert.ok(shell.pdfjs.documents.every((document) => document.destroyed), '読んだ文書は手放す');
  assert.equal(shell.splitSourceCalls.length, 1);
});

test('「開いているファイル」はアクティブなタブを対象にし、未保存なら注意を出す', async (t) => {
  const shell = await createSplitShell(t);
  const { document: doc, SigK } = shell;
  await SigK.tabs.openPath(A);
  await SigK.tabs.openPath(B);
  await shell.flush();
  SigK.pageEdit.commit([{ src: 2, rotate: 0 }, { src: 0, rotate: 0 }, { src: 1, rotate: 0 }]);
  SigK.shell.setMode(doc, 'tools');

  doc.getElementById('split-use-open').click();
  await shell.flush();
  await shell.flush();
  assert.equal(SigK.toolsSplit.source().path, B);
  assert.equal(SigK.toolsSplit.source().note, '未保存の編集は反映されません');
  assert.equal(doc.getElementById('split-note').textContent, '未保存の編集は反映されません');
  assert.match(bannerText(shell), /未保存の編集は分割に反映されません/);
});

test('開いているファイルが無ければ帯で伝える', async (t) => {
  const shell = await createSplitShell(t);
  assert.equal(await shell.SigK.toolsSplit.useOpenTab(), false);
  assert.match(bannerText(shell), /開いているファイルがありません/);
});

test('分割を選んでいるときの PDF のドロップは対象になり、2本以上なら先頭だけ', async (t) => {
  const shell = await createSplitShell(t);
  const { SigK, window } = shell;
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  event.dataTransfer = makeDataTransfer([makeDroppedFile('b.pdf', B), makeDroppedFile('a.pdf', A)]);
  await SigK.fileDrop.handleDrop(event);
  assert.equal(SigK.toolsSplit.source().path, B);
  assert.equal(SigK.tabs.count(), 0, 'タブには開かない');
  assert.equal(SigK.toolsMerge.rows().length, 0, '結合の一覧には足さない');
  assert.equal(bannerText(shell), '1つ目のファイルだけを対象にしました。');
});

test('対象を差し替えても分け方と出力の設定は残る', async (t) => {
  const shell = await createSplitShell(t, { folderResults: [{ path: OUT_DIR }] });
  const { SigK } = shell;
  await SigK.toolsSplit.setSource(A);
  SigK.toolsSplit.setMode('at');
  SigK.toolsSplit.setInput('at', '2');
  SigK.toolsSplit.setRule('pages');
  assert.equal(await SigK.toolsSplit.pickFolder(), true);
  await SigK.toolsSplit.setSource(B);
  const settings = SigK.toolsSplit.settings();
  assert.equal(settings.mode, 'at');
  assert.equal(settings.at, '2');
  assert.equal(settings.rule, 'pages');
  assert.equal(settings.folder, OUT_DIR, 'ユーザーが変えたフォルダーは対象に追従しない');
  assert.deepEqual(plain(SigK.toolsSplit.currentPlan().targets), targetsFor(OUT_DIR, ['b_p1.pdf', 'b_p2-3.pdf']));
});

// ---- 読めない対象（確定事項4） ----

test('壊れた PDF は印が付いて実行できない', async (t) => {
  const shell = await createSplitShell(t, { pdfjs: createPdfjsStub({ openError: new Error('broken') }) });
  const { document: doc, SigK } = shell;
  await SigK.toolsSplit.setSource(A);
  assert.match(SigK.toolsSplit.source().blocked, /開けません。選び直してください/);
  assert.equal(doc.getElementById('split-file').classList.contains('blocked'), true);
  assert.equal(doc.getElementById('split-note').classList.contains('error'), true);
  assert.equal(SigK.toolsSplit.canRun(), false);
  assert.equal(exampleText(shell), '');
});

test('暗号化 PDF はパスワードを聞かずに断る', async (t) => {
  const shell = await createSplitShell(t, { pdfjs: createPdfjsStub({ password: 'secret' }) });
  await shell.SigK.toolsSplit.setSource(A);
  assert.match(shell.SigK.toolsSplit.source().blocked, /パスワード付き/);
  assert.equal(shell.SigK.passwordPrompt.isOpen?.() ?? false, false);
  assert.equal(shell.SigK.toolsSplit.canRun(), false);
});

// ---- 分け方（確定事項7〜13） ----

test('方式ごとに出力の例が変わり、誤りは赤くして実行を止める', async (t) => {
  const shell = await createSplitShell(t);
  const { document: doc, SigK } = shell;
  await SigK.toolsSplit.setSource(A);

  fire(shell, 'split-every', '2');
  assert.equal(exampleText(shell), 'a_001.pdf … a_002.pdf（2 ファイル）');
  assert.equal(doc.getElementById('split-summary').textContent, '3 ページを 2 ページごとに 2 ファイルへ');

  fire(shell, 'split-every', '0');
  assert.equal(SigK.toolsSplit.canRun(), false);
  assert.equal(doc.getElementById('split-every').classList.contains('invalid'), true);
  assert.equal(doc.getElementById('split-every-err').hidden, false);
  assert.equal(doc.getElementById('split-every-err').textContent, '1 以上の整数を書いてください');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  // 入力欄は描き直されない。
  assert.equal(doc.getElementById('split-every').value, '0');

  // 位置指定へ切り替えると、N の誤りは表示から消える。
  doc.querySelector('input[name="split-mode"][value="at"]').click();
  assert.equal(SigK.toolsSplit.settings().mode, 'at');
  assert.equal(doc.getElementById('split-every').classList.contains('invalid'), false);
  fire(shell, 'split-at', '3');
  assert.equal(exampleText(shell), 'a_001.pdf … a_002.pdf（2 ファイル）');
  assert.equal(doc.getElementById('split-summary').textContent, '3 ページを 2 ファイルへ');
  assert.deepEqual(plain(SigK.toolsSplit.currentPlan().parts), [[0, 1], [2]]);
  fire(shell, 'split-at', '1');
  assert.match(doc.getElementById('split-at-err').textContent, /2 から/);
  assert.equal(SigK.toolsSplit.canRun(), false);

  // 範囲は1本になる。
  doc.getElementById('split-range').dispatchEvent(new shell.window.Event('focus'));
  assert.equal(SigK.toolsSplit.settings().mode, 'range');
  fire(shell, 'split-range', '3, 1');
  assert.deepEqual(plain(SigK.toolsSplit.currentPlan().parts), [[2, 0]]);
  assert.equal(exampleText(shell), 'a_001.pdf（1 ファイル）');
  assert.equal(doc.getElementById('split-summary').textContent, '2 ページを取り出して 1 ファイルへ');
  SigK.toolsSplit.setRule('pages');
  assert.equal(exampleText(shell), 'a_p3+1.pdf（1 ファイル）');
});

// ---- 実行（確定事項20〜32） ----

test('実行はワーカーへ source・parts・targets を渡し、終わると帯に「フォルダを開く」が出てタブは開かない', async (t) => {
  const shell = await createSplitShell(t, {
    taskResults: [{ ok: true, written: 3, targets: A_TARGETS, pages: [1, 1, 1] }],
  });
  const { document: doc, SigK } = shell;
  await SigK.toolsSplit.setSource(A);

  const result = await SigK.toolsSplit.run();
  assert.equal(result.ok, true);
  assert.equal(shell.taskCalls.length, 1);
  assert.deepEqual(shell.taskCalls[0].spec, {
    kind: 'split',
    source: A,
    name: 'a.pdf',
    parts: [{ pages: [0], target: A_TARGETS[0] }, { pages: [1], target: A_TARGETS[1] }, { pages: [2], target: A_TARGETS[2] }],
    targets: A_TARGETS,
  });
  assert.equal(SigK.tabs.count(), 0);
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(bannerText(shell), '3 ファイルに分割しました');
  const action = SigK.viewBanner.action();
  assert.equal(action.textContent, 'フォルダを開く');
  action.click();
  assert.deepEqual(plain(shell.showInFolderCalls), [A_TARGETS[0]]);
  // 対象と設定は消さない（確定事項32）。
  assert.equal(SigK.toolsSplit.source().path, A);
  assert.equal(shell.recentCalls.length, 0, '最近使ったファイルには足さない');
});

test('同名があれば3択を1回だけ出す。上書きは全件、中止は何もしない、別名はフォルダーを選び直す', async (t) => {
  const shell = await createSplitShell(t, {
    existingPaths: [A_TARGETS[0], A_TARGETS[2]],
    taskResults: [{ ok: true, written: 3, targets: A_TARGETS }, { ok: true, written: 3, targets: targetsFor(OUT_DIR, ['a_001.pdf', 'a_002.pdf', 'a_003.pdf']) }],
    folderResults: [{ path: OUT_DIR }],
  });
  const { document: doc, SigK } = shell;
  await SigK.toolsSplit.setSource(A);

  // 上書き。
  let pending = SigK.toolsSplit.run();
  await shell.flush();
  assert.equal(SigK.confirmReplace.isOpen(), true);
  assert.equal(doc.getElementById('confirm-replace-text').textContent, '「a_001.pdf」など 2 件のファイルが既にあります。上書きしますか。');
  doc.getElementById('confirm-replace-ok').click();
  assert.equal((await pending).ok, true);
  assert.equal(shell.taskCalls.length, 1);
  assert.deepEqual(shell.taskCalls[0].spec.targets, A_TARGETS);

  // 中止。
  pending = SigK.toolsSplit.run();
  await shell.flush();
  doc.getElementById('confirm-replace-cancel').click();
  assert.deepEqual(plain(await pending), { canceled: true });
  assert.equal(shell.taskCalls.length, 1);

  // 別名で保存はフォルダーを選び直し、そこに同名が無ければ進む。
  pending = SigK.toolsSplit.run();
  await shell.flush();
  doc.getElementById('confirm-replace-rename').click();
  assert.equal((await pending).ok, true);
  assert.equal(shell.folderCalls.length, 1);
  assert.deepEqual(shell.taskCalls[1].spec.targets, targetsFor(OUT_DIR, ['a_001.pdf', 'a_002.pdf', 'a_003.pdf']));
  assert.equal(SigK.toolsSplit.settings().folder, OUT_DIR);
});

test('中止と失敗は帯で伝え、中止では書き出し済みの本数を添える', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = await createSplitShell(t, {
    taskResults: [{ canceled: true }, gate, { error: '2 / 3 本目を書けませんでした。' }],
  });
  const { SigK } = shell;
  await SigK.toolsSplit.setSource(A);

  assert.deepEqual(plain(await SigK.toolsSplit.run()), { canceled: true });
  assert.equal(bannerText(shell), '分割を中止しました。');

  // 走っている間に1本目だけ書き終えてから中止された。本数は進捗から取る
  // （出力先の有無で数えると、上書き前からあったファイルまで数える）。
  const running = SigK.toolsSplit.run();
  await shell.flush();
  shell.fireProgress({ taskId: shell.taskCalls[1].taskId, phase: 'write', label: 'x', step: 5, total: 5, done: 1, of: 3 });
  release({ canceled: true });
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(bannerText(shell), '分割を中止しました。1 ファイルは書き出し済みです。');

  const failed = await SigK.toolsSplit.run();
  assert.match(failed.error, /2 \/ 3/);
  assert.equal(bannerText(shell), failed.error);
});

test('実行中は入力と実行ボタンが押せず、進捗は本数で出る', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = await createSplitShell(t, { taskResults: [gate] });
  const { document: doc, SigK } = shell;
  await SigK.toolsSplit.setSource(A);

  const running = SigK.toolsSplit.run();
  await shell.flush();
  assert.equal(SigK.toolsSplit.isRunning(), true);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('split-use-open').getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('split-pick').getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('split-folder-pick').getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('split-every').disabled, true);
  assert.equal(doc.querySelector('input[name="split-rule"][value="pages"]').disabled, true);

  shell.fireProgress({ taskId: shell.taskCalls[0].taskId, phase: 'write', label: 'x', step: 5, total: 5, done: 1, of: 3 });
  assert.match(bannerText(shell), /分割しています（1 \/ 3 ファイル）/);
  assert.equal(SigK.shell.setMode(doc, 'view'), true, 'モードの切り替えは許す');

  release({ ok: true, written: 3, targets: A_TARGETS });
  await running;
  assert.equal(SigK.toolsSplit.isRunning(), false);
  assert.equal(doc.getElementById('split-every').disabled, false);
});

// ---- --split への備え（確定事項6） ----

test('useFromLaunch はツールモードへ切り替えて分割を選び、先頭の1本を対象にする', async (t) => {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) } });
  t.after(() => shell.cleanup());
  await shell.flush();
  const { SigK, document: doc } = shell;
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'view');

  assert.equal(await SigK.toolsSplit.useFromLaunch([B, A]), true);
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(SigK.tools.selected(), 'split');
  assert.equal(SigK.toolsSplit.source().path, B);
  assert.equal(bannerText(shell), SigK.toolsSplit.NOTE_FIRST_ONLY);
});
