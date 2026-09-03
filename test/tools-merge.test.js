'use strict';

// 結合画面（spec-2-1 確定事項8〜25・35〜40）。
//
// 実際に書くのはワーカーで、その中身は test/op-merge.test.js が見ている。
// ここは「何を足し、どう並べ、何を検証し、何をワーカーへ渡し、終わったら何をするか」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, makeDroppedFile, makeDataTransfer } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const C = 'C:\\work\\c.pdf';
const OUT = 'C:\\work\\a_結合.pdf';

async function createMergeShell(t, options = {}) {
  const shell = await createShell({
    files: {
      [A]: makeSource({ path: A }),
      [B]: makeSource({ path: B }),
      [C]: makeSource({ path: C }),
    },
    ...options,
  });
  t.after(() => shell.cleanup());
  // 前回の見た目の復元（restoreUi）は IPC の往復のあとに届く。先に切り替えると
  // 復元で閲覧へ戻されるので、届くのを待ってからツールモードへ入る。
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  return shell;
}

// jsdom の realm で作られた配列は Node の Array と参照が違うので、比べる前に写す。
const plain = (value) => structuredClone(value);
const rowNodes = (shell) => [...shell.document.querySelectorAll('#merge-list .merge-row')];
const names = (shell) => plain(shell.SigK.toolsMerge.rows().map((row) => row.name));
const rows = (shell) => plain(shell.SigK.toolsMerge.rows());
const runButton = (shell) => shell.document.getElementById('merge-run');
const bannerText = (shell) => shell.document.getElementById('view-banner').textContent;

// ---- 足す ----

test('初期状態は空で、実行は押せない', async (t) => {
  const shell = await createMergeShell(t);
  assert.deepEqual(rows(shell), []);
  assert.equal(shell.document.getElementById('merge-empty').hidden, false);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(shell.SigK.toolsMerge.canRun(), false);
});

test('「ファイルを選ぶ」は複数選択で、選んだ順に末尾へ足す。ページ数も読む', async (t) => {
  const shell = await createMergeShell(t, { mergeSourceResults: [{ paths: [B, A] }] });
  await shell.SigK.toolsMerge.pickFiles();
  assert.deepEqual(names(shell), ['b.pdf', 'a.pdf']);
  assert.deepEqual(rows(shell).map((row) => row.pageCount), [3, 3]);
  assert.equal(rowNodes(shell).length, 2);
  assert.equal(rowNodes(shell)[0].querySelector('.pages').textContent, '3');
  assert.equal(shell.document.getElementById('merge-empty').hidden, true);
  assert.equal(runButton(shell).hasAttribute('aria-disabled'), false);
  assert.equal(shell.document.getElementById('merge-summary').textContent, '2 ファイル ・ 出力は 6 ページ');
  // 読んだ文書は手放す。
  assert.ok(shell.pdfjs.documents.every((doc) => doc.destroyed));
});

test('取り消したら何も足さない', async (t) => {
  const shell = await createMergeShell(t, { mergeSourceResults: [{ canceled: true }] });
  assert.deepEqual(plain(await shell.SigK.toolsMerge.pickFiles()), []);
  assert.deepEqual(names(shell), []);
});

test('「開いているファイルを追加」はタブの並びで未追加のものだけ足し、未保存には注意を出す', async (t) => {
  const shell = await createMergeShell(t);
  const { SigK } = shell;
  await SigK.tabs.openPath(A);
  await SigK.tabs.openPath(B);
  await shell.flush();
  // b.pdf を編集して未保存にする。
  SigK.pageEdit.commit([{ src: 2, rotate: 0 }, { src: 0, rotate: 0 }, { src: 1, rotate: 0 }]);
  assert.equal(SigK.viewer.isDirty(), true);

  await SigK.toolsMerge.addPaths([A]);
  await SigK.toolsMerge.addOpenTabs();
  assert.deepEqual(names(shell), ['a.pdf', 'b.pdf']);
  const rows = SigK.toolsMerge.rows();
  assert.equal(rows[0].note, null);
  assert.equal(rows[1].note, '未保存の編集は反映されません');
  assert.equal(rowNodes(shell)[1].querySelector('.note').textContent, '未保存の編集は反映されません');
  assert.match(bannerText(shell), /未保存の編集は結合に反映されません/);

  // すべて入っていれば帯で伝える。
  await SigK.toolsMerge.addOpenTabs();
  assert.deepEqual(names(shell), ['a.pdf', 'b.pdf']);
  assert.match(bannerText(shell), /すべて一覧に入っています/);
});

test('開いているファイルが無ければ帯で伝える', async (t) => {
  const shell = await createMergeShell(t);
  assert.deepEqual(plain(await shell.SigK.toolsMerge.addOpenTabs()), []);
  assert.match(bannerText(shell), /開いているファイルがありません/);
});

test('同じファイルを2回足せる', async (t) => {
  const shell = await createMergeShell(t);
  await shell.SigK.toolsMerge.addPaths([A, A]);
  assert.deepEqual(names(shell), ['a.pdf', 'a.pdf']);
});

test('ツールモードでは PDF のドロップが一覧へ足される', async (t) => {
  const shell = await createMergeShell(t);
  const { SigK, window } = shell;
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  event.dataTransfer = makeDataTransfer([makeDroppedFile('b.pdf', B), makeDroppedFile('x.txt', 'C:\\work\\x.txt')]);
  await SigK.fileDrop.handleDrop(event);
  assert.deepEqual(names(shell), ['b.pdf']);
  assert.equal(SigK.tabs.count(), 0, 'タブには開かない');

  const bad = new window.Event('drop', { bubbles: true, cancelable: true });
  bad.dataTransfer = makeDataTransfer([makeDroppedFile('x.txt', 'C:\\work\\x.txt')]);
  await SigK.fileDrop.handleDrop(bad);
  assert.match(bannerText(shell), /PDF ファイルではありません/);
});

test('上限は 100 ファイルで、超えたぶんは帯で断る', async (t) => {
  const shell = await createMergeShell(t);
  const many = Array.from({ length: 101 }, () => A);
  const ids = await shell.SigK.toolsMerge.addPaths(many);
  assert.equal(ids.length, 100);
  assert.equal(shell.SigK.toolsMerge.rows().length, 100);
  assert.match(bannerText(shell), /100 ファイルまで/);
  assert.deepEqual(plain(await shell.SigK.toolsMerge.addPaths([B])), []);
});

// ---- 読めない入力（確定事項14・31） ----

test('壊れた PDF は行に印が付き、実行できない', async (t) => {
  const shell = await createMergeShell(t, { pdfjs: createPdfjsStub({ openError: new Error('broken') }) });
  await shell.SigK.toolsMerge.addPaths([A]);
  const row = shell.SigK.toolsMerge.rows()[0];
  assert.equal(row.pageCount, null);
  assert.match(row.blocked, /開けません/);
  assert.equal(rowNodes(shell)[0].classList.contains('blocked'), true);
  assert.equal(rowNodes(shell)[0].querySelector('.range').disabled, true);
  assert.equal(shell.SigK.toolsMerge.canRun(), false);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
});

test('暗号化 PDF はパスワードを聞かずに断る', async (t) => {
  const shell = await createMergeShell(t, { pdfjs: createPdfjsStub({ password: 'secret' }) });
  await shell.SigK.toolsMerge.addPaths([A]);
  const row = shell.SigK.toolsMerge.rows()[0];
  assert.match(row.blocked, /パスワード付き/);
  assert.equal(shell.SigK.passwordPrompt.isOpen?.() ?? false, false);
  assert.equal(shell.SigK.toolsMerge.canRun(), false);
});

// ---- 並べ替え（確定事項15） ----

test('上へ／下へで並べ替えられ、端では押せない', async (t) => {
  const shell = await createMergeShell(t);
  const { SigK } = shell;
  await SigK.toolsMerge.addPaths([A, B, C]);
  const [a, b, c] = SigK.toolsMerge.rows().map((row) => row.id);

  assert.equal(rowNodes(shell)[0].querySelector('[title="上へ"]').getAttribute('aria-disabled'), 'true');
  assert.equal(rowNodes(shell)[2].querySelector('[title="下へ"]').getAttribute('aria-disabled'), 'true');

  rowNodes(shell)[2].querySelector('[title="上へ"]').click();
  assert.deepEqual(names(shell), ['a.pdf', 'c.pdf', 'b.pdf']);
  assert.equal(SigK.toolsMerge.move(a, 1), true);
  assert.deepEqual(names(shell), ['c.pdf', 'a.pdf', 'b.pdf']);
  assert.equal(SigK.toolsMerge.move(c, -1), false);
  assert.equal(SigK.toolsMerge.move(b, 1), false);

  assert.equal(SigK.toolsMerge.moveTo(b, 0), true);
  assert.deepEqual(names(shell), ['b.pdf', 'c.pdf', 'a.pdf']);
  assert.equal(SigK.toolsMerge.moveTo(b, 3), true);
  assert.deepEqual(names(shell), ['c.pdf', 'a.pdf', 'b.pdf']);
});

test('行をドラッグして落とすと並びが変わり、Esc で取り消せる', async (t) => {
  const shell = await createMergeShell(t);
  const { SigK, document: doc } = shell;
  await SigK.toolsMerge.addPaths([A, B, C]);
  const list = doc.getElementById('merge-list');
  const grip = rowNodes(shell)[0].querySelector('.grip');

  // jsdom では rect がすべて 0 なので、y > 0 で落とすと末尾になる。
  shell.firePointer(grip, 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  assert.equal(SigK.toolsMergeList.isDragging(), true);
  assert.equal(rowNodes(shell)[0].classList.contains('dragging'), true);
  assert.notEqual(list.querySelector('.drop-line'), null);
  shell.firePointer(list, 'pointerup', { x: 5, y: 40 });
  assert.deepEqual(names(shell), ['b.pdf', 'c.pdf', 'a.pdf']);
  assert.equal(list.querySelector('.drop-line'), null);

  // Esc で取り消す。
  shell.firePointer(rowNodes(shell)[0].querySelector('.grip'), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  doc.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(SigK.toolsMergeList.isDragging(), false);
  shell.firePointer(list, 'pointerup', { x: 5, y: 40 });
  assert.deepEqual(names(shell), ['b.pdf', 'c.pdf', 'a.pdf']);

  // 範囲欄の上で押しても掴まない。
  shell.firePointer(rowNodes(shell)[0].querySelector('.range'), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  assert.equal(SigK.toolsMergeList.isDragging(), false);
});

test('外す・すべて外す', async (t) => {
  const shell = await createMergeShell(t);
  const { SigK } = shell;
  await SigK.toolsMerge.addPaths([A, B]);
  rowNodes(shell)[0].querySelector('[title="外す"]').click();
  assert.deepEqual(names(shell), ['b.pdf']);
  shell.document.getElementById('merge-clear').click();
  assert.deepEqual(names(shell), []);
  assert.equal(shell.document.getElementById('merge-empty').hidden, false);
});

// ---- ページ範囲（確定事項18〜20） ----

test('範囲を書くと出力ページ数に映り、誤りは赤くして実行を止める', async (t) => {
  const shell = await createMergeShell(t);
  const { SigK } = shell;
  await SigK.toolsMerge.addPaths([A, B]);
  const input = rowNodes(shell)[0].querySelector('.range');

  input.value = '1, 3';
  input.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  assert.deepEqual(rows(shell)[0].pages, [0, 2]);
  assert.equal(SigK.toolsMerge.outputPages(), 5);
  assert.equal(shell.document.getElementById('merge-summary').textContent, '2 ファイル ・ 出力は 5 ページ');
  assert.equal(SigK.toolsMerge.canRun(), true);

  input.value = '2, 12';
  input.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  assert.equal(SigK.toolsMerge.rows()[0].error, '3ページまでです');
  assert.equal(rowNodes(shell)[0].classList.contains('invalid'), true);
  assert.equal(rowNodes(shell)[0].querySelector('.note').textContent, '3ページまでです');
  assert.equal(SigK.toolsMerge.canRun(), false);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  // 入力欄は描き直されず、フォーカスが飛ばない。
  assert.equal(rowNodes(shell)[0].querySelector('.range'), input);

  input.value = '';
  input.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  assert.equal(SigK.toolsMerge.rows()[0].error, null);
  assert.equal(SigK.toolsMerge.rows()[0].pages, null, '空欄は全ページ（null で渡す）');
  assert.equal(SigK.toolsMerge.canRun(), true);
});

// ---- 実行（確定事項21〜25・35〜38） ----

test('実行は保存先を聞き、ワーカーへ inputs と target を渡し、終わると新しいタブで開いて閲覧へ移る', async (t) => {
  const shell = await createMergeShell(t, {
    savePathResults: [{ path: OUT }],
    taskResults: [{ ok: true, path: OUT, pages: 5, inputs: 2, bytes: 100 }],
    files: {
      [A]: makeSource({ path: A }),
      [B]: makeSource({ path: B }),
      [OUT]: makeSource({ path: OUT, name: 'a_結合.pdf' }),
    },
  });
  const { SigK, document: doc } = shell;
  await SigK.toolsMerge.addPaths([A, B]);
  SigK.toolsMerge.setRange(SigK.toolsMerge.rows()[1].id, '2-3');

  const result = await SigK.toolsMerge.run();
  assert.equal(result.ok, true);
  assert.deepEqual(shell.savePathCalls[0], { defaultPath: OUT, title: '結合した PDF を保存' });
  assert.equal(shell.taskCalls.length, 1);
  assert.deepEqual(shell.taskCalls[0].spec, {
    kind: 'merge',
    inputs: [{ path: A, name: 'a.pdf', pages: null }, { path: B, name: 'b.pdf', pages: [1, 2] }],
    target: OUT,
  });

  // 新しいタブで開き、閲覧モードへ移る（確定事項35）。一覧は消さない（確定事項37）。
  assert.equal(SigK.tabs.count(), 1);
  assert.equal(SigK.tabs.list()[0].path, OUT);
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'view');
  assert.equal(bannerText(shell), '2 ファイルを結合しました（5 ページ）');
  assert.deepEqual(names(shell), ['a.pdf', 'b.pdf']);
  // 最近使ったファイルには openPath が足す（確定事項38）。
  assert.equal(shell.recentCalls.some((call) => call.kind === 'add' && call.entry.path === OUT), true);
});

test('保存先を取り消せば何もしない', async (t) => {
  const shell = await createMergeShell(t, { savePathResults: [{ canceled: true }] });
  await shell.SigK.toolsMerge.addPaths([A]);
  assert.deepEqual(plain(await shell.SigK.toolsMerge.run()), { canceled: true });
  assert.equal(shell.taskCalls.length, 0);
});

test('出力先が入力の1つと同じなら断る', async (t) => {
  const shell = await createMergeShell(t, { savePathResults: [{ path: 'C:/work/A.PDF' }] });
  await shell.SigK.toolsMerge.addPaths([A, B]);
  const result = await shell.SigK.toolsMerge.run();
  assert.equal(result.error, '出力先に入力ファイルと同じファイルは選べません。');
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(bannerText(shell), '出力先に入力ファイルと同じファイルは選べません。');
});

test('実行中は一覧の操作と実行ボタンが押せず、進捗はファイル単位で出る', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = await createMergeShell(t, {
    savePathResults: [{ path: OUT }],
    taskResults: [gate],
    files: { [A]: makeSource({ path: A }), [OUT]: makeSource({ path: OUT }) },
  });
  const { SigK, document: doc } = shell;
  await SigK.toolsMerge.addPaths([A]);

  const running = SigK.toolsMerge.run();
  await shell.flush();
  assert.equal(SigK.toolsMerge.isRunning(), true);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('merge-add-open').getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('merge-pick').getAttribute('aria-disabled'), 'true');
  assert.equal(rowNodes(shell)[0].querySelector('.range').disabled, true);
  assert.equal(rowNodes(shell)[0].querySelector('[title="外す"]').getAttribute('aria-disabled'), 'true');

  shell.fireProgress({ taskId: shell.taskCalls[0].taskId, phase: 'apply', label: 'x', step: 3, total: 5, done: 1, of: 3 });
  assert.match(bannerText(shell), /結合しています（1 \/ 3 ファイル）/);
  // モードの切り替えは許す（確定事項25）。
  assert.equal(SigK.shell.setMode(doc, 'view'), true);

  release({ ok: true, path: OUT, pages: 3 });
  await running;
  assert.equal(SigK.toolsMerge.isRunning(), false);
  assert.equal(runButton(shell).hasAttribute('aria-disabled'), false);
});

test('中止と失敗は帯で伝え、タブは開かない', async (t) => {
  const shell = await createMergeShell(t, {
    savePathResults: [{ path: OUT }, { path: OUT }],
    taskResults: [{ canceled: true }, { error: '「b.pdf」この PDF は内容が壊れているため保存できません。' }],
  });
  const { SigK } = shell;
  await SigK.toolsMerge.addPaths([A]);
  assert.deepEqual(plain(await SigK.toolsMerge.run()), { canceled: true });
  assert.equal(bannerText(shell), '結合を中止しました。');
  const failed = await SigK.toolsMerge.run();
  assert.match(failed.error, /b\.pdf/);
  assert.equal(bannerText(shell), failed.error);
  assert.equal(SigK.tabs.count(), 0);
  assert.equal(shell.document.documentElement.getAttribute('data-mode'), 'tools');
});

test('タブが上限なら開かずに帯で伝え、最近使ったファイルへ足す', async (t) => {
  const files = {};
  const paths = [];
  for (let index = 0; index < 20; index += 1) {
    const filePath = `C:\\work\\t${index}.pdf`;
    files[filePath] = makeSource({ path: filePath });
    paths.push(filePath);
  }
  const shell = await createMergeShell(t, {
    files: { ...files, [A]: makeSource({ path: A }) },
    savePathResults: [{ path: OUT }],
    taskResults: [{ ok: true, path: OUT, pages: 3 }],
  });
  const { SigK } = shell;
  for (const filePath of paths)
    await SigK.tabs.openPath(filePath);
  assert.equal(SigK.tabs.count(), 20);
  SigK.shell.setMode(shell.document, 'tools');

  await SigK.toolsMerge.addPaths([A]);
  await SigK.toolsMerge.run();
  assert.equal(SigK.tabs.count(), 20);
  assert.equal(bannerText(shell), '結合しました。タブが多すぎるため開いていません。');
  assert.equal(shell.document.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(shell.recentList()[0].path, OUT);
});

// ---- 同名確認の経路（確定事項26〜28） ----

test('resolveTarget は同名があれば3択を出し、答えに応じて返す', async (t) => {
  const shell = await createMergeShell(t, {
    existingPaths: [OUT],
    savePathResults: [{ path: 'C:\\work\\other.pdf' }],
  });
  const { SigK, document: doc } = shell;

  const NEW = 'C:\\work\\new.pdf';
  assert.deepEqual(plain(await SigK.toolsMerge.resolveTarget(NEW)), { path: NEW }, '無ければ聞かない');

  let pending = SigK.toolsMerge.resolveTarget(OUT);
  await shell.flush();
  assert.equal(SigK.confirmReplace.isOpen(), true);
  doc.getElementById('confirm-replace-ok').click();
  assert.deepEqual(plain(await pending), { path: OUT });

  pending = SigK.toolsMerge.resolveTarget(OUT);
  await shell.flush();
  doc.getElementById('confirm-replace-cancel').click();
  assert.deepEqual(plain(await pending), { canceled: true });

  // 別名で保存は、同じ既定名で保存ダイアログを開き直す。
  pending = SigK.toolsMerge.resolveTarget(OUT);
  await shell.flush();
  doc.getElementById('confirm-replace-rename').click();
  assert.deepEqual(plain(await pending), { path: 'C:\\work\\other.pdf' });
  assert.equal(shell.savePathCalls.at(-1).defaultPath, OUT);
});

// ---- --merge への備え（確定事項39・40） ----

test('addFromLaunch はツールモードへ切り替えて結合を選び、末尾へ足す', async (t) => {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) } });
  t.after(() => shell.cleanup());
  await shell.flush();
  const { SigK, document: doc } = shell;
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'view');

  await SigK.toolsMerge.addFromLaunch([A, B]);
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(SigK.tools.selected(), 'merge');
  assert.deepEqual(names(shell), ['a.pdf', 'b.pdf']);
  assert.equal(SigK.toolsMerge.canRun(), true);
});
