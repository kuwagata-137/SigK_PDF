'use strict';

// 抽出の画面側のテスト（spec-1-6 確定事項47〜52）。
//
// 実際に書くのはワーカーで、その中身は test/op-extract.test.js が見ている。
// ここは「何を選び、何を聞き、どこへ書かせ、終わったあと画面をどうするか」を見る。
//
// いちばん確かめたいのは**終わったあと何もしない**ことである（確定事項50）。
// 抽出は「取り出して渡す」操作なので、タブも未保存の印も動いてはいけない。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const OUT = 'C:\\work\\a_抽出.pdf';

const plain = (value) => structuredClone(value);

const okResult = (over = {}) => ({ ok: true, path: OUT, backup: null, pages: 1, bytes: 900, ...over });

async function withOpenDocument(t, options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  return shell;
}

function extractButton(shell) {
  return shell.document.getElementById('act-extract');
}

// 確認ダイアログを了承して、抽出の1往復を終わらせる。
async function runAndAccept(shell) {
  const promise = shell.SigK.extract.run();
  await shell.flush();
  shell.document.getElementById('confirm-extract-ok').click();
  return promise;
}

test('選択が無ければ抽出ボタンは押せない', async (t) => {
  const shell = await withOpenDocument(t);

  assert.equal(extractButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(shell.SigK.extract.canExtract(), false);
});

test('ページを選ぶと押せるようになる', async (t) => {
  const shell = await withOpenDocument(t);

  shell.SigK.pageGrid.setSelection([0, 2]);

  // 操作列は「押せるときは属性ごと外す」作法である（page-edit.js の setEnabled）。
  assert.equal(extractButton(shell).hasAttribute('aria-disabled'), false);
  assert.equal(shell.SigK.extract.canExtract(), true);
});

test('文書を閉じると押せなくなる', async (t) => {
  const shell = await withOpenDocument(t);
  shell.SigK.pageGrid.setSelection([0]);

  await shell.SigK.viewer.close();
  await shell.flush();

  assert.equal(shell.SigK.extract.canExtract(), false);
});

test('保存中は抽出できない', async (t) => {
  let release = null;
  const shell = await withOpenDocument(t);
  shell.window.taskAPI.run = () => new Promise((resolve) => { release = () => resolve({ ok: true }); });
  shell.SigK.pageGrid.setSelection([0]);
  shell.SigK.viewer.applyPlan(shell.SigK.pagePlan.rotatePages(shell.SigK.viewer.getPlan(), [0], 90));

  const saving = shell.SigK.save.saveActive();
  await shell.flush();

  assert.equal(shell.SigK.extract.canExtract(), false);
  assert.equal(extractButton(shell).getAttribute('aria-disabled'), 'true');
  assert.match((await shell.SigK.extract.run()).error, /いま保存しています/);

  release();
  await saving;
  assert.equal(shell.SigK.extract.canExtract(), true);
});

test('抽出の前に、失うものを名指しして確認する', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [okResult()],
    savePathResults: [{ path: OUT }],
  });
  shell.SigK.pageGrid.setSelection([0, 2]);

  const promise = shell.SigK.extract.run();
  await shell.flush();

  assert.equal(shell.SigK.confirmExtract.isOpen(), true);
  const text = shell.document.getElementById('confirm-extract-text').textContent;
  assert.match(text, /2 ページ/, '何ページ取り出すのかを出す');
  assert.match(text, /しおり/);
  assert.match(text, /入力欄/);
  assert.match(text, /元のファイルは変更されません/);

  shell.document.getElementById('confirm-extract-ok').click();
  assert.equal((await promise).ok, true);
});

test('確認を取りやめたら、保存先も聞かない', async (t) => {
  const shell = await withOpenDocument(t);
  shell.SigK.pageGrid.setSelection([0]);

  const promise = shell.SigK.extract.run();
  await shell.flush();
  shell.document.getElementById('confirm-extract-cancel').click();

  assert.deepEqual(plain(await promise), { canceled: true });
  assert.equal(shell.savePathCalls.length, 0);
  assert.equal(shell.taskCalls.length, 0);
});

test('選んだページを、いまの並びの順でワーカーへ渡す', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [okResult({ pages: 2 })],
    savePathResults: [{ path: OUT }],
  });
  // 3ページ目を先頭へ動かしてから、1枚目と3枚目を選ぶ。
  shell.SigK.viewer.applyPlan(shell.SigK.pagePlan.movePages(shell.SigK.viewer.getPlan(), [2], 0).plan);
  shell.SigK.pageGrid.setSelection([0, 2]);

  assert.equal((await runAndAccept(shell)).ok, true);

  const { spec } = shell.taskCalls[0];
  assert.equal(spec.kind, 'extract');
  assert.equal(spec.source, A, '読むのは元のファイル');
  assert.equal(spec.target, OUT);
  // 元ファイルを触らないので、退避も外部変更の照合も要らない（確定事項18・21）。
  assert.equal(spec.makeBackup, false);
  assert.equal(spec.expect, null);
  // 画面の 1枚目（元の3ページ目）と 3枚目（元の2ページ目）。
  assert.deepEqual(spec.pages.map((entry) => entry.src), [2, 1]);
});

test('既定の出力名は「元の名前_抽出.pdf」である', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [okResult()],
    savePathResults: [{ path: OUT }],
  });
  shell.SigK.pageGrid.setSelection([1]);

  await runAndAccept(shell);

  assert.deepEqual(shell.savePathCalls[0], { defaultPath: 'C:\\work\\a_抽出.pdf', title: 'ページを抽出' });
});

test('拡張子が無い・大文字でも、_抽出 は名前の末尾に付く', async (t) => {
  const shell = await withOpenDocument(t);

  assert.equal(shell.SigK.extract.defaultTargetFor({ path: 'C:\\work\\A.PDF' }), 'C:\\work\\A_抽出.pdf');
  assert.equal(shell.SigK.extract.defaultTargetFor({ path: 'C:\\work\\帳票' }), 'C:\\work\\帳票_抽出.pdf');
  assert.equal(shell.SigK.extract.defaultTargetFor({}), undefined);
});

test('保存先を選ばなければ何も起きない', async (t) => {
  const shell = await withOpenDocument(t, { savePathResults: [{ canceled: true }] });
  shell.SigK.pageGrid.setSelection([0]);

  assert.deepEqual(plain(await runAndAccept(shell)), { canceled: true });
  assert.equal(shell.taskCalls.length, 0);
});

test('抽出しても、タブも未保存の印も動かない', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [okResult()],
    savePathResults: [{ path: OUT }],
  });
  // 未保存にしてから抽出する。抽出は保存ではないので、印は消えない。
  shell.SigK.viewer.applyPlan(shell.SigK.pagePlan.rotatePages(shell.SigK.viewer.getPlan(), [0], 90));
  shell.SigK.pageGrid.setSelection([0]);

  assert.equal((await runAndAccept(shell)).ok, true);
  await shell.flush();

  const tab = shell.SigK.tabs.list().find((info) => info.active);
  assert.equal(tab.path, A, 'タブは元のファイルのままである（確定事項50）');
  assert.equal(shell.SigK.viewer.getState().file.path, A);
  assert.equal(shell.SigK.viewer.isDirty(), true, '抽出は編集を保存しない');
  assert.equal(shell.recentCalls.some((call) => call.kind === 'add' && call.entry.path === OUT), false,
    '抽出したファイルは開かないので、最近使ったファイルにも載せない');
  assert.match(shell.SigK.viewBanner.text(), /抽出しました/);
});

test('失敗したら、ワーカーの文言をそのまま帯に出す', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [{ error: 'パスワードで保護された PDF は保存できません。' }],
    savePathResults: [{ path: OUT }],
  });
  shell.SigK.pageGrid.setSelection([0]);

  const result = await runAndAccept(shell);

  assert.match(result.error, /パスワードで保護された/);
  assert.match(shell.SigK.viewBanner.text(), /パスワードで保護された/);
});

test('中止したら、そのことを帯に出す', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [{ canceled: true }],
    savePathResults: [{ path: OUT }],
  });
  shell.SigK.pageGrid.setSelection([0]);

  assert.deepEqual(plain(await runAndAccept(shell)), { canceled: true });
  assert.match(shell.SigK.viewBanner.text(), /抽出を中止しました/);
});

test('文書を開いていなければ抽出しない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());

  assert.match((await shell.SigK.extract.run()).error, /開かれていません/);
});
