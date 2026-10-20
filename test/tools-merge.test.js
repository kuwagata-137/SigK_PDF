'use strict';

// 結合（spec-2-1 確定事項21〜28・35〜40、spec-2-5 確定事項E1・E2・E7。見本 screenshots/strips2-merge.png）。
//
// 結合する PDF は帯（＝タブ）で、順番はタブの並び。右の欄の行でチェックと範囲を決める。実際に書くのはワーカーで、その中身は
// test/op-merge.test.js が見ている。ここは「どの帯を、どの順で、どの範囲でワーカーへ渡し、終わったら何をするか」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const C = 'C:\\work\\c.pdf';
const OUT = 'C:\\work\\a_結合.pdf';

async function createMergeShell(t, { open = [A, B], files = {}, ...options } = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }), [C]: makeSource({ path: C }), [OUT]: makeSource({ path: OUT }), ...files },
    ...options,
  });
  t.after(() => shell.cleanup());
  // 前回の見た目の復元（restoreUi）は IPC の往復のあとに届く。先に切り替えると閲覧へ戻されるので、届くのを待ってから入る。
  await shell.flush();
  for (const filePath of open)
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('merge');
  return shell;
}

// jsdom の realm で作られた配列は Node の Array と参照が違うので、比べる前に写す。
const plain = (value) => structuredClone(value);
const rowNodes = (shell) => [...shell.document.querySelectorAll('#merge-list .merge-pick')];
const names = (shell) => plain(shell.SigK.toolsMerge.rows().map((row) => row.name));
const checked = (shell) => plain(shell.SigK.toolsMerge.rows().map((row) => row.checked));
const text = (shell, id) => shell.document.getElementById(id).textContent;
const runButton = (shell) => shell.document.getElementById('merge-run');
const bannerText = (shell) => shell.document.getElementById('view-banner').textContent;
const bannerTone = (shell) => shell.document.getElementById('view-banner').getAttribute('data-tone');
const idOf = (shell, index) => shell.SigK.tabs.list()[index].id;

function check(shell, index, on) {
  const box = rowNodes(shell)[index].querySelector('.cbox');
  box.checked = on;
  box.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
}

function type(shell, index, value) {
  const range = rowNodes(shell)[index].querySelector('input.rng');
  range.focus();
  range.value = value;
  range.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  return range;
}

// ---- 行と右の欄 ----

test('帯が無ければ行も無く、実行は押せない', async (t) => {
  const shell = await createMergeShell(t, { open: [] });
  assert.equal(rowNodes(shell).length, 0);
  assert.equal(text(shell, 'merge-count'), '0 / 0');
  assert.equal(shell.document.getElementById('merge-empty').hidden, false);
  assert.equal(text(shell, 'merge-summary'), '');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(shell.document.getElementById('tool-pane').hidden, false);
  assert.equal(shell.document.getElementById('strips-screen').hidden, false);
});

test('開いている帯が帯の順に行になり、既定でチェックが入る。ページ数はファイルの中身', async (t) => {
  const shell = await createMergeShell(t, { open: [A, B, C] });
  assert.deepEqual(names(shell), ['a.pdf', 'b.pdf', 'c.pdf']);
  assert.deepEqual(checked(shell), [true, true, true]);
  const [first] = rowNodes(shell);
  assert.equal(first.querySelector('.strip-no').textContent, '1');
  assert.equal(first.querySelector('.p').textContent, '3 p');
  assert.equal(text(shell, 'merge-count'), '3 / 3');
  assert.equal(text(shell, 'merge-summary'), '3 個のファイル・合計 9 ページ');
  assert.equal(runButton(shell).hasAttribute('aria-disabled'), false);
  assert.equal(shell.document.getElementById('merge-empty').hidden, true);
});

test('チェックを外すと範囲の欄が打てなくなり、数と要約が変わる。全部外すと実行できない', async (t) => {
  const shell = await createMergeShell(t);
  check(shell, 1, false);
  assert.deepEqual(checked(shell), [true, false]);
  assert.equal(rowNodes(shell)[1].classList.contains('off'), true);
  assert.equal(rowNodes(shell)[1].querySelector('input.rng').disabled, true);
  assert.equal(text(shell, 'merge-count'), '1 / 2');
  assert.equal(text(shell, 'merge-summary'), '1 個のファイル・合計 3 ページ');
  check(shell, 0, false);
  assert.equal(text(shell, 'merge-summary'), '');
  assert.equal(shell.SigK.toolsMerge.canRun(), false);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
});

test('範囲を書くと要約のページ数に映り、誤りは赤くして実行を止める。打っている欄には書き戻さない', async (t) => {
  const shell = await createMergeShell(t);
  const range = type(shell, 1, '2-3');
  assert.equal(text(shell, 'merge-summary'), '2 個のファイル・合計 5 ページ');
  type(shell, 1, '9');
  assert.equal(range.classList.contains('invalid'), true);
  assert.equal(rowNodes(shell)[1].querySelector('.err').hidden, false);
  assert.equal(shell.SigK.toolsMerge.canRun(), false);
  // 帯を描き直しても（タブの合図）、フォーカスのある欄の文字は動かさない。
  range.value = '1-';
  shell.SigK.tabs.render();
  assert.equal(range.value, '1-');
  type(shell, 1, '');
  assert.equal(shell.SigK.toolsMerge.canRun(), true);
});

test('帯の並びを替えると行の順も変わり、閉じた帯の行は消える', async (t) => {
  const shell = await createMergeShell(t, { open: [A, B, C] });
  const [a, b, c] = [0, 1, 2].map((index) => idOf(shell, index));
  check(shell, 0, false);
  shell.SigK.tabs.reorder([c, a, b]);
  assert.deepEqual(names(shell), ['c.pdf', 'a.pdf', 'b.pdf']);
  assert.deepEqual(checked(shell), [true, false, true], 'チェックは帯についていく');
  assert.deepEqual(rowNodes(shell).map((node) => node.querySelector('.fname').textContent), ['c.pdf', 'a.pdf', 'b.pdf']);
  shell.SigK.tabs.forceCloseTab(a);
  assert.deepEqual(names(shell), ['c.pdf', 'b.pdf']);
  await shell.SigK.tabs.openPath(A);
  assert.deepEqual(checked(shell), [true, true, true], '開き直した帯はまた既定でチェックが入る');
});

test('開けなかった帯とパスワード付きの帯は、理由を赤で出し、チェックを入れられない', async (t) => {
  const error = Object.assign(new Error('broken'), { name: 'InvalidPDFException' });
  const shell = await createMergeShell(t, { open: [A], pdfjs: createPdfjsStub({ openError: error }) });
  const [row] = rowNodes(shell);
  assert.equal(row.classList.contains('blocked'), true);
  assert.equal(row.querySelector('.cbox').disabled, true);
  assert.equal(row.querySelector('.cbox').checked, false);
  assert.equal(row.querySelector('.rng.note').textContent, '開けなかったので、結合に使えません');
  assert.equal(shell.SigK.toolsMerge.canRun(), false);

  // パスワード付き（開けたが保存も結合もできない）。
  const peek = shell.SigK.tabs.peek;
  shell.window.SigK.tabs.peek = (id) => ({ ...peek(id), doc: {}, basePages: [{}, {}], file: { encrypted: true } });
  shell.SigK.toolsMergeList.render();
  assert.equal(rowNodes(shell)[0].querySelector('.rng.note').textContent, 'パスワード付きなので、結合に使えません');
});

// ---- 実行（spec-2-1 確定事項21〜25・35〜38） ----

test('実行はチェックした帯を帯の順に範囲つきでワーカーへ渡し、できた PDF を新しい帯として足して選ぶ（チェックも入る）', async (t) => {
  const shell = await createMergeShell(t, {
    open: [A, B, C],
    savePathResults: [{ path: OUT }],
    taskResults: [{ ok: true, path: OUT, pages: 5, inputs: 2, bytes: 100 }],
  });
  const { SigK, document: doc } = shell;
  check(shell, 1, false);
  type(shell, 2, '2-3');

  const result = await SigK.toolsMerge.run();
  assert.equal(result.ok, true);
  assert.deepEqual(plain(shell.savePathCalls[0]), { defaultPath: OUT, title: '結合した PDF を保存' });
  assert.deepEqual(plain(shell.taskCalls[0].spec), {
    kind: 'merge',
    // expect はタブで開いたときの印。ワーカーが読む前に照らす（決定81 ⑫。spec-6-1 確定事項C-9）。
    inputs: [{ path: A, name: 'a.pdf', pages: null, expect: { size: 2048, mtimeMs: 1 } }, { path: C, name: 'c.pdf', pages: [1, 2], expect: { size: 2048, mtimeMs: 1 } }],
    target: OUT,
  });
  assert.equal(SigK.tabs.count(), 4);
  assert.equal(SigK.tabs.list()[3].path, OUT);
  assert.equal(SigK.tabs.activeId(), SigK.tabs.list()[3].id);
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(bannerText(shell), '2 ファイルを結合しました（5 ページ）');
  assert.equal(bannerTone(shell), 'info');
  assert.deepEqual(checked(shell), [true, false, true, true], 'できた PDF の帯にも既定でチェック（PR-2 の起草者の判断）');
});

test('保存先を取り消せば何もしない', async (t) => {
  const shell = await createMergeShell(t, { savePathResults: [{ canceled: true }] });
  assert.deepEqual(plain(await shell.SigK.toolsMerge.run()), { canceled: true });
  assert.equal(shell.taskCalls.length, 0);
});

test('出力先が入力の 1 つと同じなら断り、タブで開いているほかのファイルなら確定事項45 の文で断る', async (t) => {
  const shell = await createMergeShell(t, { open: [A, B, C], savePathResults: [{ path: 'C:/work/A.PDF' }, { path: 'c:/work/C.PDF' }] });
  check(shell, 2, false);
  const same = await shell.SigK.toolsMerge.run();
  assert.equal(same.error, '出力先に入力ファイルと同じファイルは選べません。');
  assert.equal(bannerText(shell), same.error);
  const open = await shell.SigK.toolsMerge.run();
  assert.equal(open.error, '出力先のファイルはタブで開いているので、タブを閉じるか、別の名前を選んでください。');
  assert.equal(shell.taskCalls.length, 0, 'ワーカーへ渡さない');
});

test('実行中は行の操作と実行ボタンが押せず、進捗はファイル単位で出る', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = await createMergeShell(t, { savePathResults: [{ path: OUT }], taskResults: [gate] });
  const { SigK, document: doc } = shell;
  const running = SigK.toolsMerge.run();
  await shell.flush();
  assert.equal(SigK.toolsMerge.isRunning(), true);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(rowNodes(shell)[0].querySelector('.cbox').disabled, true);
  assert.equal(rowNodes(shell)[0].querySelector('input.rng').disabled, true);

  shell.fireProgress({ taskId: shell.taskCalls[0].taskId, phase: 'apply', label: 'x', step: 3, total: 5, done: 1, of: 3 });
  assert.match(bannerText(shell), /結合しています（1 \/ 3 ファイル）/);
  assert.equal(SigK.shell.setMode(doc, 'view'), true, 'モードの切り替えは許す（確定事項25）');

  release({ ok: true, path: OUT, pages: 3 });
  await running;
  assert.equal(SigK.toolsMerge.isRunning(), false);
});

test('保存ダイアログを開いている間も実行中と数え、やめれば下ろす（spec-5-1 確定事項12）', async (t) => {
  let answer;
  const dialog = new Promise((resolve) => { answer = resolve; });
  const shell = await createMergeShell(t, { savePathResults: [dialog] });
  const { SigK } = shell;
  const running = SigK.toolsMerge.run();
  await shell.flush();
  assert.equal(SigK.toolsMerge.isRunning(), true);
  assert.equal(SigK.toolsMerge.canRun(), false);
  answer({ canceled: true });
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(SigK.toolsMerge.canRun(), true);
});

test('中止と失敗は通知バーで伝え、新しい帯は足さない', async (t) => {
  const shell = await createMergeShell(t, {
    savePathResults: [{ path: OUT }, { path: OUT }],
    taskResults: [{ canceled: true }, { error: '「b.pdf」この PDF は内容が壊れているため保存できません。' }],
  });
  const { SigK } = shell;
  assert.deepEqual(plain(await SigK.toolsMerge.run()), { canceled: true });
  assert.equal(bannerText(shell), '結合を中止しました。');
  assert.equal(bannerTone(shell), 'info');
  const failed = await SigK.toolsMerge.run();
  assert.match(failed.error, /b\.pdf/);
  assert.equal(bannerText(shell), failed.error);
  assert.equal(SigK.tabs.count(), 2);
});

test('タブが上限なら開かずに通知バーで伝え、最近使ったファイルへ足す', async (t) => {
  const files = {};
  const paths = [];
  for (let index = 0; index < 20; index += 1) {
    const filePath = `C:\\work\\t${index}.pdf`;
    files[filePath] = makeSource({ path: filePath });
    paths.push(filePath);
  }
  const shell = await createMergeShell(t, { open: paths, files, savePathResults: [{ path: OUT }], taskResults: [{ ok: true, path: OUT, pages: 3 }] });
  const { SigK } = shell;
  assert.equal(SigK.tabs.count(), 20);
  await SigK.toolsMerge.run();
  assert.equal(SigK.tabs.count(), 20);
  assert.equal(bannerText(shell), '結合しましたが、タブが多すぎるため開いていません。');
  assert.equal(bannerTone(shell), 'info');
  assert.equal(shell.recentList()[0].path, OUT);
});

// ---- 同名確認の経路（spec-2-1 確定事項26〜28。分割が使う） ----

test('resolveTarget は同名があれば3択を出し、答えに応じて返す', async (t) => {
  const shell = await createMergeShell(t, { existingPaths: [OUT], savePathResults: [{ path: 'C:\\work\\other.pdf' }] });
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

  pending = SigK.toolsMerge.resolveTarget(OUT);
  await shell.flush();
  doc.getElementById('confirm-replace-rename').click();
  assert.deepEqual(plain(await pending), { path: 'C:\\work\\other.pdf' });
  assert.equal(shell.savePathCalls.at(-1).defaultPath, OUT);
});

// ---- 起動からの結合（spec-5-1 確定事項9・16、spec-2-5 確定事項E7。決定80 ㉛） ----

const first = (id) => ({ batch: { id, first: true } });
const next = (id) => ({ batch: { id, first: false } });
const openWith = (shell) => async (paths) => {
  for (const filePath of paths)
    await shell.SigK.toolHandoff.openOne(filePath);
};

test('起動からの結合は、選んだ PDF だけにチェックを入れ、前から開いていた帯のチェックを外し、束の中はファイル名の順', async (t) => {
  const shell = await createMergeShell(t, { open: [B] });
  const { SigK, document: doc } = shell;
  SigK.shell.setMode(doc, 'view');

  await SigK.toolsMerge.addFromLaunch([C], { ...first(1), open: openWith(shell) });
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(SigK.tools.selected(), 'merge');
  assert.deepEqual(names(shell), ['b.pdf', 'c.pdf']);
  assert.deepEqual(checked(shell), [false, true]);
  assert.equal(doc.getElementById('merge-note').hidden, true, '1 つだけなら注記は出さない');

  await SigK.toolsMerge.addFromLaunch([A], { ...next(1), open: openWith(shell) });
  assert.deepEqual(names(shell), ['b.pdf', 'a.pdf', 'c.pdf'], '束の帯がいる位置の中で名前の順');
  assert.deepEqual(checked(shell), [false, true, true]);
  assert.equal(doc.getElementById('merge-note').hidden, false);
  assert.equal(text(shell, 'merge-note'), 'ファイル名の順に並べたので、エクスプローラーの並びと違うときは、帯の ↑↓ で入れ替えてください。');

  // 次の束では、前の束の帯のチェックも外す。すでに開いている PDF を選べば、その帯にチェックが入る。
  await SigK.toolsMerge.addFromLaunch([B], { ...first(2), open: openWith(shell) });
  assert.deepEqual(names(shell), ['b.pdf', 'a.pdf', 'c.pdf']);
  assert.deepEqual(checked(shell), [true, false, false]);
  assert.equal(doc.getElementById('merge-note').hidden, true);
});
