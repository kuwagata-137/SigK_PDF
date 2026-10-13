'use strict';

// 分割画面（spec-2-2 確定事項1〜32・spec-2-2b）。
//
// 実際に書くのはワーカーで、その中身は test/op-split.test.js が見ている。盤の上の操作（✂・選ぶ・まとめて分ける・元に戻す）は
// test/split-board.test.js が見ている。ここは「対象をどう決め、どこへ出し、何をワーカーへ渡し、終わったら何をするか」を見る。
// 入れた直後は分け目が無く実行できない（spec-2-2b 決定76 ④）ので、実行のテストは先に 1 ページずつに分けてから走らせる。

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
const bannerTone = (shell) => shell.document.getElementById('view-banner').getAttribute('data-tone');
// 対象を決めて、1 ページずつに分ける（3 ページの A なら A_TARGETS の 3 本になる）。
async function useEach(shell, filePath = A) {
  await shell.SigK.toolsSplit.setSource(filePath);
  shell.SigK.toolsSplitEdit.bulk('each');
}

test('出力先に元のファイルと同じパスが入っていれば、書かずに断る（spec-2-2 確定事項20）', async (t) => {
  // 規則では必ず接尾辞が付くので起きないが、念のため実行の前に照らす。ファイル名の規則を差し替えて起こす。
  const shell = await createSplitShell(t);
  await useEach(shell);
  const original = shell.SigK.splitPlan.outputNames;
  shell.SigK.splitPlan.outputNames = (...args) => original(...args).map((name, index) => (index === 1 ? 'a.pdf' : name));
  const result = await shell.SigK.toolsSplit.run();
  assert.equal(result.error, '出力先に元のファイルと同じファイルは選べません。');
  assert.equal(bannerText(shell), '出力先に元のファイルと同じファイルは選べません。');
  assert.equal(shell.taskCalls.length, 0);
});

test('結合が走っている間は分割を実行できず、結合が終われば実行できる（spec-2-2 確定事項28）', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const merged = 'C:\\work\\merged.pdf';
  const shell = await createSplitShell(t, { savePathResults: [{ path: merged }], taskResults: [gate] });
  await useEach(shell);
  await shell.SigK.toolsMerge.addPaths([B]);
  shell.SigK.tools.select('merge');
  const merging = shell.SigK.toolsMerge.run();
  await shell.flush();
  assert.equal(shell.SigK.save.isBusy(), true);

  shell.SigK.tools.select('split');
  await shell.flush();
  assert.equal(shell.SigK.toolsSplit.canRun(), false);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.deepEqual(plain(await shell.SigK.toolsSplit.run()), { error: '分割できる状態ではありません。' });
  assert.equal(shell.taskCalls.length, 1, '走っているのは結合の 1 本だけ');

  release({ ok: true, path: merged, pages: 3 });
  await merging;
  await shell.flush();
  assert.equal(shell.SigK.toolsSplit.canRun(), true);
});

// ［開いているタブから選ぶ ▾］を押し、一覧からそのファイルの行を選ぶ（spec-2-2b 確定事項F2）。
function chooseTab(shell, buttonId, filePath) {
  shell.document.getElementById(buttonId).click();
  [...shell.document.querySelectorAll('.tab-menu .tab-menu-row')].find((row) => row.title === filePath).click();
}

// ---- 対象（確定事項1〜5） ----

test('初期状態は対象が無く、実行は押せない', async (t) => {
  const shell = await createSplitShell(t);
  const { document: doc, SigK } = shell;
  assert.equal(SigK.toolsSplit.source(), null);
  assert.equal(doc.getElementById('split-empty').hidden, false);
  assert.equal(doc.getElementById('split-file').hidden, true);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(SigK.toolsSplit.canRun(), false);
  assert.equal(doc.getElementById('split-summary').textContent, '分割する PDF を決めてください。');
});

test('「ファイルを選ぶ」で対象が決まり、ページ数・フォルダーが埋まる。分け目を入れると実行できる', async (t) => {
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
  // 入れた直後は分け目が無く、実行できない（spec-2-2b 決定76 ④）。名前の規則の既定は連番（確定事項15）。
  assert.equal(SigK.toolsSplit.canRun(), false);
  assert.equal(doc.getElementById('split-rule-seq').textContent, 'a_001.pdf');
  assert.equal(doc.getElementById('split-rule-pages').textContent, 'a_p1-3.pdf');
  SigK.toolsSplitEdit.bulk('each');
  assert.deepEqual(plain(SigK.toolsSplit.currentPlan().targets), A_TARGETS);
  assert.equal(doc.getElementById('split-summary').textContent, '3 ページを 3 つのファイルに分けます。');
  assert.equal(doc.getElementById('split-rule-pages').textContent, 'a_p1.pdf');
  assert.equal(SigK.toolsSplit.canRun(), true);
  assert.equal(runButton(shell).hasAttribute('aria-disabled'), false);
  assert.equal(shell.pdfjs.documents.length, 1, '読むのは 1 回（spec-2-2b 確定事項D1）');
  assert.equal(shell.pdfjs.documents[0].destroyed, false, '盤のために開いたまま持つ');
  assert.equal(shell.splitSourceCalls.length, 1);
});

test('［開いているタブから選ぶ］で選んだタブを対象にし、未保存なら注意を出す', async (t) => {
  const shell = await createSplitShell(t);
  const { document: doc, SigK } = shell;
  await SigK.tabs.openPath(A);
  await SigK.tabs.openPath(B);
  await shell.flush();
  SigK.pageEdit.commit([{ src: 2, rotate: 0 }, { src: 0, rotate: 0 }, { src: 1, rotate: 0 }]);
  SigK.shell.setMode(doc, 'tools');

  chooseTab(shell, 'split-use-open', B);
  await shell.flush();
  await shell.flush();
  assert.equal(SigK.toolsSplit.source().path, B);
  assert.equal(SigK.toolsSplit.source().note, '未保存の編集は反映されません');
  assert.equal(doc.getElementById('split-note').textContent, '未保存の編集は反映されません');
  assert.match(bannerText(shell), /未保存の編集は分割に反映されないので/);
  // 注意・お知らせは黄色の帯で出す（決定49）。
  assert.equal(bannerTone(shell), 'warn');
});

test('タブが無ければ、一覧に案内の 1 行を出す（帯は出さない）', async (t) => {
  const shell = await createSplitShell(t);
  shell.document.getElementById('split-use-open').click();
  assert.equal(shell.document.querySelector('.tab-menu .tab-menu-empty').textContent, 'タブで開いている PDF はありません');
  assert.equal(await shell.SigK.toolsSplit.useTab(999), false);
  assert.equal(bannerText(shell), '');
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
  // 注意・お知らせは黄色の帯で出す（決定49）。
  assert.equal(bannerTone(shell), 'warn');
});

test('対象を差し替えると盤は作り直し、出力の設定は残る（spec-2-2b 確定事項B6）', async (t) => {
  const shell = await createSplitShell(t, { folderResults: [{ path: OUT_DIR }] });
  const { SigK } = shell;
  await SigK.toolsSplit.setSource(A);
  SigK.toolsSplitEdit.cut(1);
  SigK.toolsSplit.setRule('pages');
  assert.equal(await SigK.toolsSplit.pickFolder(), true);
  await SigK.toolsSplit.setSource(B);
  const settings = SigK.toolsSplit.settings();
  assert.equal(settings.rule, 'pages');
  assert.equal(settings.folder, OUT_DIR, 'ユーザーが変えたフォルダーは対象に追従しない');
  assert.equal(SigK.toolsSplit.currentPlan().reason, 'untouched', '盤は作り直す');
  SigK.toolsSplitEdit.cut(1);
  assert.deepEqual(plain(SigK.toolsSplit.currentPlan().targets), targetsFor(OUT_DIR, ['b_p1.pdf', 'b_p2-3.pdf']));
});

test('同じファイルを選び直したときは、盤を残す', async (t) => {
  const shell = await createSplitShell(t);
  const { SigK } = shell;
  await SigK.toolsSplit.setSource(A);
  SigK.toolsSplitEdit.cut(2);
  await SigK.toolsSplit.setSource(A);
  assert.deepEqual(plain(SigK.toolsSplit.currentPlan().parts), [[0, 1], [2]]);
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
  assert.equal(doc.getElementById('split-board-empty').hidden, false, '盤には何も並べない（spec-2-2b 確定事項D8）');
});

test('暗号化 PDF はパスワードを聞かずに断る', async (t) => {
  const shell = await createSplitShell(t, { pdfjs: createPdfjsStub({ password: 'secret' }) });
  await shell.SigK.toolsSplit.setSource(A);
  assert.match(shell.SigK.toolsSplit.source().blocked, /パスワード付き/);
  assert.equal(shell.SigK.passwordPrompt.isOpen?.() ?? false, false);
  assert.equal(shell.SigK.toolsSplit.canRun(), false);
});

// ---- 実行（確定事項20〜32） ----

test('実行はワーカーへ source・parts・targets を渡し、終わると帯に「フォルダを開く」が出てタブは開かない', async (t) => {
  const shell = await createSplitShell(t, {
    taskResults: [{ ok: true, written: 3, targets: A_TARGETS, pages: [1, 1, 1] }],
  });
  const { document: doc, SigK } = shell;
  await useEach(shell);

  const result = await SigK.toolsSplit.run();
  assert.equal(result.ok, true);
  assert.equal(shell.taskCalls.length, 1);
  assert.deepEqual(shell.taskCalls[0].spec, {
    kind: 'split',
    source: A,
    name: 'a.pdf',
    parts: [{ pages: [0], target: A_TARGETS[0] }, { pages: [1], target: A_TARGETS[1] }, { pages: [2], target: A_TARGETS[2] }],
    targets: A_TARGETS,
    expectSource: { size: 2048, mtimeMs: 1 },
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
  await useEach(shell);

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

// ---- タブで開いている出力先（確定事項42） ----

test('出力先のどれかがタブで開いていれば、同名の3択を出す前に断る', async (t) => {
  const shell = await createSplitShell(t, {
    files: { [A]: makeSource({ path: A }), [A_TARGETS[1]]: makeSource({ path: A_TARGETS[1] }) },
    existingPaths: [A_TARGETS[0], A_TARGETS[1]],
  });
  const { document: doc, SigK } = shell;
  await SigK.tabs.openPath(A_TARGETS[1]);
  SigK.shell.setMode(doc, 'tools');
  await useEach(shell);

  const result = await SigK.toolsSplit.run();
  assert.equal(result.error, '出力先の「a_002.pdf」はタブで開いています。タブを閉じるか、フォルダを変えてください。');
  assert.equal(SigK.confirmReplace.isOpen(), false, '置き換えてよいかは聞かない');
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(bannerText(shell), result.error);
});

test('「別名で保存」で選び直したフォルダーの出力先がタブで開いていても断る', async (t) => {
  const outTargets = targetsFor(OUT_DIR, ['a_001.pdf', 'a_002.pdf', 'a_003.pdf']);
  const shell = await createSplitShell(t, {
    files: { [A]: makeSource({ path: A }), [outTargets[0]]: makeSource({ path: outTargets[0] }) },
    existingPaths: [A_TARGETS[0]],
    folderResults: [{ path: OUT_DIR }],
  });
  const { document: doc, SigK } = shell;
  await SigK.tabs.openPath(outTargets[0]);
  SigK.shell.setMode(doc, 'tools');
  await useEach(shell);

  const pending = SigK.toolsSplit.run();
  await shell.flush();
  doc.getElementById('confirm-replace-rename').click();
  const result = await pending;
  assert.equal(result.error, '出力先の「a_001.pdf」はタブで開いています。タブを閉じるか、フォルダを変えてください。');
  assert.equal(shell.taskCalls.length, 0);
});

test('中止と失敗は帯で伝え、中止では書き出し済みの本数を添える', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = await createSplitShell(t, {
    taskResults: [{ canceled: true }, gate, { error: '2 / 3 本目を書けませんでした。' }],
  });
  const { SigK } = shell;
  await useEach(shell);

  assert.deepEqual(plain(await SigK.toolsSplit.run()), { canceled: true });
  assert.equal(bannerText(shell), '分割を中止しました。');
  // 自分で止めたので、失敗の赤ではなく青で出す（決定49）。
  assert.equal(bannerTone(shell), 'info');

  // 走っている間に1本目だけ書き終えてから中止された。本数は進捗から取る
  // （出力先の有無で数えると、上書き前からあったファイルまで数える）。
  const running = SigK.toolsSplit.run();
  await shell.flush();
  shell.fireProgress({ taskId: shell.taskCalls[1].taskId, phase: 'write', label: 'x', step: 5, total: 5, done: 1, of: 3 });
  release({ canceled: true });
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(bannerText(shell), '分割を中止しましたが、1 ファイルは書き出し済みです。');

  const failed = await SigK.toolsSplit.run();
  assert.match(failed.error, /2 \/ 3/);
  assert.equal(bannerText(shell), failed.error);
});

test('同名の 3 択を出している間も実行中と数え、中止すれば下ろす（spec-5-1 確定事項12）', async (t) => {
  const shell = await createSplitShell(t, { existingPaths: [A_TARGETS[0]] });
  const { document: doc, SigK } = shell;
  await useEach(shell);

  const running = SigK.toolsSplit.run();
  await shell.flush();
  assert.equal(SigK.confirmReplace.isOpen(), true);
  assert.equal(SigK.toolsSplit.isRunning(), true);
  assert.equal(SigK.toolsSplit.canRun(), false);

  doc.getElementById('confirm-replace-cancel').click();
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(SigK.toolsSplit.isRunning(), false);
  assert.equal(SigK.toolsSplit.canRun(), true);
});

test('実行中は入力と実行ボタンが押せず、進捗は本数で出る', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = await createSplitShell(t, { taskResults: [gate] });
  const { document: doc, SigK } = shell;
  await useEach(shell);

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

test('useFromLaunch はツールモードへ切り替えて分割を選び、名前の順で先頭の1本を対象にする（spec-5-1 確定事項20）', async (t) => {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) } });
  t.after(() => shell.cleanup());
  await shell.flush();
  const { SigK, document: doc } = shell;
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'view');

  assert.equal(await SigK.toolsSplit.useFromLaunch([B, A]), true);
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(SigK.tools.selected(), 'split');
  assert.equal(SigK.toolsSplit.source().path, A);
  assert.equal(bannerText(shell), SigK.toolsSplit.NOTE_FIRST_ONLY);
  // 右クリックから届いたときの注記も黄色の帯で出す（決定49）。
  assert.equal(bannerTone(shell), 'warn');
});

test('右クリックの束では、後から届いたパスが名前の順で前なら対象を差し替え、帯は束につき 1 回（spec-5-1 確定事項20）', async (t) => {
  const C = 'C:\\work\\c.pdf';
  const shell = await createShell({ files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }), [C]: makeSource({ path: C }) } });
  t.after(() => shell.cleanup());
  await shell.flush();
  const { SigK, document: doc } = shell;

  // シェルは 1 ファイル 1 本で起こすので、分割にも 1 本ずつ届く（子の Single は効かない。事前調査 A2）。
  await SigK.toolsSplit.useFromLaunch([B], { batch: { id: 1, first: true } });
  assert.equal(SigK.toolsSplit.source().path, B);
  assert.notEqual(bannerText(shell), SigK.toolsSplit.NOTE_FIRST_ONLY, '1 本だけなら帯は出さない');

  await SigK.toolsSplit.useFromLaunch([A], { batch: { id: 1, first: false } });
  assert.equal(SigK.toolsSplit.source().path, A, '名前の順で前なので差し替える');
  assert.equal(bannerText(shell), SigK.toolsSplit.NOTE_FIRST_ONLY);

  SigK.viewBanner.show('ほかの知らせ');
  SigK.shell.setMode(doc, 'view');
  await SigK.toolsSplit.useFromLaunch([C], { batch: { id: 1, first: false } });
  assert.equal(SigK.toolsSplit.source().path, A, '名前の順で後ろなので差し替えない');
  assert.equal(bannerText(shell), 'ほかの知らせ', '帯は束につき 1 回');
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'view', '束の 2 件目以降は画面を切り替えない');

  // 次の束は、今の対象に関わらずその束の先頭で決め直す。
  await SigK.toolsSplit.useFromLaunch([C], { batch: { id: 2, first: true } });
  assert.equal(SigK.toolsSplit.source().path, C);
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'tools');
});
