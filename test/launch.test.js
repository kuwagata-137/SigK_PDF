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

test('結合・画像→PDF・分割の要求は、それぞれの画面へ渡す（spec-5-1 確定事項8）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;

  await SigK.launch.handle(request('merge', [B], 1));
  assert.equal(mode(shell), 'tools');
  assert.equal(SigK.tools.selected(), 'merge');
  assert.deepEqual(mergeNames(shell), ['b.pdf']);

  await SigK.launch.handle(request('toPdf', [IMG], 2));
  assert.equal(SigK.tools.selected(), 'convert');
  assert.deepEqual(plain(SigK.toolsConvert.rows().map((row) => row.path)), [IMG]);

  await SigK.launch.handle(request('split', [A], 3));
  assert.equal(SigK.tools.selected(), 'split');
  assert.equal(SigK.toolsSplit.source().path, A);
  assert.equal(SigK.tabs.count(), 0, 'タブは開かない');
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

test('open の束の最初で、ツールモードなら閲覧モードへ移る。ページ・注釈モードはそのまま（spec-5-1 確定事項9）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document: doc } = shell;

  SigK.shell.setMode(doc, 'tools');
  await SigK.launch.handle(request('open', [A], 1));
  assert.equal(mode(shell), 'view');

  SigK.shell.setMode(doc, 'annot');
  await SigK.launch.handle(request('open', [B], 2));
  assert.equal(mode(shell), 'annot', '文書が見えているモードはそのまま');

  // 束の 2 件目以降では切り替えない（届いている間にユーザーが移っても引き戻さない）。
  SigK.shell.setMode(doc, 'tools');
  await SigK.launch.handle(request('open', [A], 2, false));
  assert.equal(mode(shell), 'tools');
  assert.deepEqual(tabPaths(shell), [A, B]);
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
  assert.equal(SigK.viewBanner.text(), 'タブが多すぎます。20 個まで開けます。使わないタブを閉じてください。');
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

test('メインから届いた要求でも開く', async (t) => {
  const shell = await withShell(t);

  await Promise.all(shell.fireLaunch({ intent: 'open', paths: [A] }));

  assert.equal(shell.SigK.tabs.count(), 1);
  assert.equal(shell.SigK.viewer.getState().file.path, A);
});
