'use strict';

// 起動要求の受け口のテスト（spec-1-6 確定事項77・spec-5-1 確定事項8〜13）。
//
// 引数の解釈そのものは test/launch-args.test.js、束の印は test/launch-batch.test.js が見ている。
// ここは「届いた要求で画面がどうなるか」「取りこぼさない順番か」「手が空くまで預かるか」を見る。
// 束の中の並びと一覧の置き換えは、受け取る画面のテスト（tools-merge・tools-convert・tools-split）が見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// jsdom 側で作られた配列は Node 側の配列と realm が違う。素の値へ写して比べる。
const plain = (value) => structuredClone(value);

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const OUT = 'C:\\work\\a_結合.pdf';
const IMG = 'C:\\photo\\a.png';

async function withShell(t, { files = {}, ...options } = {}) {
  const shell = await createShell({
    files: {
      [A]: makeSource({ path: A, name: 'a.pdf' }),
      [B]: makeSource({ path: B, name: 'b.pdf' }),
      ...files,
    },
    imageInfos: { [IMG]: { kind: 'png', width: 120, height: 80 } },
    ...options,
  });
  t.after(() => shell.cleanup());
  // 前回の見た目の復元（restoreUi）が返るのを待ってから始める。
  await shell.flush();
  return shell;
}

const mode = (shell) => shell.document.documentElement.getAttribute('data-mode');
const mergeNames = (shell) => plain(shell.SigK.toolsMerge.rows().map((row) => row.name));
const tabPaths = (shell) => plain(shell.SigK.tabs.list().map((tab) => tab.path));
const request = (intent, paths, id = 1, first = true) => ({ intent, paths, batch: { id, first } });

test('購読を始めてから ready を送る', async (t) => {
  const shell = await withShell(t);

  // 逆にすると取りこぼす（実測で7通中5通が消えた）。順番そのものが仕様である。
  assert.deepEqual(shell.shellCalls, ['onLaunch', 'ready']);
});

test('open の要求でタブが開く', async (t) => {
  const shell = await withShell(t);

  const opened = await shell.SigK.launch.handle({ intent: 'open', paths: [A, B] });

  assert.equal(opened, 2);
  assert.equal(shell.SigK.tabs.count(), 2);
  assert.deepEqual(tabPaths(shell), [A, B]);
});

test('同じファイルが2回来ても、タブは1枚のままである', async (t) => {
  const shell = await withShell(t);

  await shell.SigK.launch.handle({ intent: 'open', paths: [A, A] });

  assert.equal(shell.SigK.tabs.count(), 1);
});

test('結合・画像→PDF・分割の要求は、それぞれの画面へ渡し、PDF はタブでも開く（spec-5-1 確定事項8・決定80）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;

  await SigK.launch.handle(request('merge', [B], 1));
  assert.equal(mode(shell), 'tools');
  assert.equal(SigK.tools.selected(), 'merge');
  assert.deepEqual(mergeNames(shell), ['b.pdf']);
  assert.deepEqual(tabPaths(shell), [B]);

  await SigK.launch.handle(request('toPdf', [IMG], 2));
  assert.equal(SigK.tools.selected(), 'convert');
  assert.deepEqual(plain(SigK.toolsConvert.rows().map((row) => row.path)), [IMG]);
  assert.deepEqual(tabPaths(shell), [B], '画像はタブにしない');

  await SigK.launch.handle(request('split', [A], 3));
  assert.equal(SigK.tools.selected(), 'split');
  assert.equal(SigK.toolsSplit.source().path, A);
  assert.deepEqual(tabPaths(shell), [B, A]);
  assert.equal(mode(shell), 'tools');
});

test('【要】結合の束を 3 本受けても、名前の順の注記はタブを開くときに消えない', async (t) => {
  const C = 'C:\\work\\c.pdf';
  const shell = await withShell(t, { files: { [C]: makeSource({ path: C, name: 'c.pdf' }) } });
  const { SigK } = shell;

  await SigK.launch.handle(request('merge', [C], 7));
  await SigK.launch.handle(request('merge', [A], 7, false));
  await SigK.launch.handle(request('merge', [B], 7, false));

  assert.deepEqual(mergeNames(shell), ['a.pdf', 'b.pdf', 'c.pdf']);
  assert.deepEqual(tabPaths(shell), [C, A, B], 'タブは届いた順');
  assert.equal(SigK.viewBanner.text(), 'ファイル名の順に並べたので、エクスプローラーの並びと違うときは、ドラッグで入れ替えてください。');
});

test('知らない操作・パスの無い要求は何もしない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;

  assert.equal(await SigK.launch.handle(null), 0);
  assert.equal(await SigK.launch.handle({ intent: 'open' }), 0);
  assert.equal(await SigK.launch.handle({ intent: 'open', paths: [] }), 0);
  assert.equal(await SigK.launch.handle({ intent: 'print', paths: [A] }), 0);
  assert.equal(SigK.tabs.count(), 0);
  assert.deepEqual(mergeNames(shell), []);
  assert.equal(mode(shell), 'view');
});

test('open の要求では、どのモードでもモードを変えない（決定80。spec-5-1 確定事項9 を改めた）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document: doc } = shell;

  SigK.shell.setMode(doc, 'tools');
  await SigK.launch.handle(request('open', [A], 1));
  assert.equal(mode(shell), 'tools', '閲覧モードへ移らない');

  SigK.shell.setMode(doc, 'annot');
  await SigK.launch.handle(request('open', [B], 2));
  assert.equal(mode(shell), 'annot');
  assert.deepEqual(tabPaths(shell), [A, B]);
});

test('ツールモードで open の要求が来たら、タブで開き、選んでいるツールにも渡す（決定80）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document: doc } = shell;
  SigK.shell.setMode(doc, 'tools');

  await SigK.launch.handle(request('open', [B], 1));
  await SigK.launch.handle(request('open', [A], 1, false));

  assert.deepEqual(tabPaths(shell), [B, A]);
  assert.deepEqual(mergeNames(shell), ['b.pdf', 'a.pdf'], '結合は届いた順に末尾へ');
  assert.equal(mode(shell), 'tools');
});

test('ツールモードで open の束が来たら、対象が 1 本のツールは束の最初の 1 本だけを対象にする', async (t) => {
  const shell = await withShell(t);
  const { SigK, document: doc } = shell;
  SigK.shell.setMode(doc, 'tools');
  SigK.tools.select('split');

  await SigK.launch.handle(request('open', [B], 4));
  await SigK.launch.handle(request('open', [A], 4, false));

  assert.deepEqual(tabPaths(shell), [B, A]);
  assert.equal(SigK.toolsSplit.source().path, B, '後から届いた 1 本で差し替えない');

  // 次の束では、その最初の 1 本で差し替える。
  await SigK.launch.handle(request('open', [A], 5));
  assert.equal(SigK.toolsSplit.source().path, A);
});

test('閲覧モードで open の要求が来ても、ツールには渡さない', async (t) => {
  const shell = await withShell(t);

  await shell.SigK.launch.handle(request('open', [A], 1));

  assert.deepEqual(tabPaths(shell), [A]);
  assert.deepEqual(mergeNames(shell), []);
});

test('タブが上限なら開かず、帯を束につき 1 回出す（spec-5-1 確定事項13）', async (t) => {
  const files = {};
  const paths = [];
  for (let index = 0; index < 22; index += 1) {
    const filePath = `C:\\work\\t${index}.pdf`;
    files[filePath] = makeSource({ path: filePath });
    paths.push(filePath);
  }
  const shell = await withShell(t, { files });
  const { SigK } = shell;
  for (const filePath of paths.slice(0, 20))
    await SigK.tabs.openPath(filePath);

  assert.equal(await SigK.launch.handle(request('open', [paths[20]], 5)), 0);
  assert.equal(SigK.viewBanner.text(), '20 個まで開けますが、タブが多すぎるので、使わないタブを閉じてください。');
  SigK.viewBanner.show('ほかの知らせ');
  assert.equal(await SigK.launch.handle(request('open', [paths[21]], 5, false)), 0);
  assert.equal(SigK.viewBanner.text(), 'ほかの知らせ', '帯は束につき 1 回');

  // 開いているファイルなら、上限でも前へ出せる。
  assert.equal(await SigK.launch.handle(request('open', [paths[3]], 6)), 1);
  assert.equal(SigK.tabs.count(), 20);
});

test('届いた順に 1 件ずつ当てる', async (t) => {
  const shell = await withShell(t);

  await Promise.all([
    ...shell.fireLaunch(request('open', [B], 1)),
    ...shell.fireLaunch(request('open', [A], 1, false)),
  ]);

  assert.deepEqual(tabPaths(shell), [B, A]);
});

test('【要】結合の保存ダイアログの間に届いた束は預かり、出力に混ぜない。手が空いたら当てる（論点4）', async (t) => {
  let answer;
  const dialog = new Promise((resolve) => { answer = resolve; });
  const shell = await withShell(t, {
    files: { [OUT]: makeSource({ path: OUT }) },
    savePathResults: [dialog],
    taskResults: [{ ok: true, path: OUT, pages: 3 }],
  });
  const { SigK } = shell;
  await SigK.launch.handle(request('merge', [A], 1));

  const running = SigK.toolsMerge.run();
  await shell.flush();
  const held = SigK.launch.handle(request('merge', [B], 2));
  await shell.flush();
  assert.deepEqual(mergeNames(shell), ['a.pdf'], '保存ダイアログの間は一覧に入れない');
  assert.equal(SigK.launch.pending(), 1);

  answer({ path: OUT });
  assert.equal((await running).ok, true);
  assert.deepEqual(plain(shell.taskCalls[0].spec.inputs.map((input) => input.path)), [A], '出力には入らない');

  await held;
  assert.equal(SigK.launch.pending(), 0);
  assert.deepEqual(mergeNames(shell), ['b.pdf'], '実行し終えた一覧は、預かっていた束で置き換える');
  assert.equal(mode(shell), 'tools');
});

test('画面のダイアログが開いている間は預かる', async (t) => {
  const shell = await withShell(t);
  const { SigK, document: doc } = shell;

  const asking = SigK.confirmReplace.ask({ name: 'x.pdf' });
  await shell.flush();
  const held = SigK.launch.handle(request('open', [A], 1));
  await shell.flush();
  assert.equal(SigK.tabs.count(), 0);
  assert.equal(SigK.launch.pending(), 1);

  doc.getElementById('confirm-replace-cancel').click();
  await asking;
  assert.equal(await held, 1);
  assert.equal(SigK.tabs.count(), 1);
});

test('保存やツールの処理の途中（save.isBusy）は預かる', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = await withShell(t, { taskResults: [gate] });
  const { SigK } = shell;

  const task = SigK.save.runTask({ kind: 'merge', label: '結合', inputs: [], target: OUT });
  await shell.flush();
  assert.equal(SigK.save.isBusy(), true);
  const held = SigK.launch.handle(request('open', [A], 1));
  await shell.flush();
  assert.equal(SigK.tabs.count(), 0);

  release({ canceled: true });
  await task;
  assert.equal(await held, 1);
});

// ---- 起動直後の競合（spec-5-1 確定事項14） ----
//
// メインは ready を受けたときに、準備前に溜めていた要求を流す。受け口が前回の見た目の
// 復元（restoreUi）より先に結線されていると、要求で切り替えたモードを、後から返る復元が
// 保存されたモードへ戻してしまう。

async function withReadyLaunch(t, { ui, requests }) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
    ui: { mode: ui, pageLayout: 'single', sidePanel: { open: true, width: 240 } },
    launchOnReady: requests,
  });
  t.after(() => shell.cleanup());
  await shell.launchSettled();
  await shell.flush();
  return shell;
}

test('【要】前回を閲覧モードで閉じていても、右クリックの「結合」から起きればツールモードのまま', async (t) => {
  const shell = await withReadyLaunch(t, { ui: 'view', requests: [request('merge', [A], 1)] });

  assert.equal(mode(shell), 'tools');
  assert.equal(shell.SigK.tools.selected(), 'merge');
  assert.deepEqual(mergeNames(shell), ['a.pdf']);
});

test('【要】前回をツールモードで閉じていて「SigK PDF で開く」から起きると、ツールモードのままタブで開く（決定80）', async (t) => {
  const shell = await withReadyLaunch(t, { ui: 'tools', requests: [request('open', [A], 1)] });

  assert.equal(mode(shell), 'tools', '前回のモードのまま');
  assert.deepEqual(tabPaths(shell), [A]);
  assert.deepEqual(mergeNames(shell), ['a.pdf'], '選んでいるツール（起動直後は結合）にも渡す');
  // 閲覧モードへ移れば、ページが見える。
  shell.SigK.shell.setMode(shell.document, 'view');
  assert.equal(shell.SigK.viewer.getState().file.path, A);
});

test('メインから届いた要求でも開く', async (t) => {
  const shell = await withShell(t);

  await Promise.all(shell.fireLaunch({ intent: 'open', paths: [A] }));

  assert.equal(shell.SigK.tabs.count(), 1);
  assert.equal(shell.SigK.viewer.getState().file.path, A);
});
