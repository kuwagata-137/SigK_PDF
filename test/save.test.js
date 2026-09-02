'use strict';

// 保存の指揮の層のテスト（spec-1-6 確定事項6〜9・21・23〜30）。
//
// 実際に書くのはワーカーで、その中身は test/pdf-task.test.js が見ている。
// ここは「何を、どこへ、どう頼むか」と「終わったあとの画面」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

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

// 並べ替えて未保存にする。
function edit(SigK) {
  const original = SigK.viewer.getPlan();
  SigK.viewer.applyPlan(SigK.pagePlan.movePages(original, [0], 2).plan);
  return original;
}

// レンダラー（jsdom）側で作られた値は、Node 側のオブジェクトとは realm が違う。
// deepEqual は「構造は同じだが同一の型ではない」と言って落ちるので、
// 素の値へ写してから比べる。
const plain = (value) => structuredClone(value);

const okResult = (over = {}) => ({ ok: true, path: A, backup: `${A}.bak`, signature: { size: 2048, mtimeMs: 2000 }, ...over });

test('保存ボタンは文書が無ければ押せない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());

  assert.equal(shell.document.getElementById('btn-save').getAttribute('aria-disabled'), 'true');
});

test('文書を開くと保存ボタンが押せるようになる', async (t) => {
  const shell = await withOpenDocument(t);

  assert.equal(shell.document.getElementById('btn-save').getAttribute('aria-disabled'), 'false');
});

test('上書き保存は、いまの並びと元のパスをワーカーへ渡す', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult()] });
  edit(shell.SigK);

  const result = await shell.SigK.save.saveActive();
  assert.equal(result.ok, true);

  assert.equal(shell.taskCalls.length, 1);
  const { spec } = shell.taskCalls[0];
  assert.equal(spec.source, A);
  assert.equal(spec.target, A, '上書きなので行き先は同じ');
  // 上書きのときだけ .bak を作る（確定事項18・20）。
  assert.equal(spec.makeBackup, true);
  // 開いたときのサイズと更新時刻を控えて渡す（確定事項21）。
  assert.deepEqual(spec.expect, { size: 1024, mtimeMs: 1000 });
  assert.deepEqual(spec.pages, plain(shell.SigK.viewer.getPlan()));
  assert.deepEqual(spec.ops, [], '塊⑤ では ops は常に空である');
});

test('保存に成功すると未保存でなくなる', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult()] });
  edit(shell.SigK);
  assert.equal(shell.SigK.viewer.isDirty(), true);

  await shell.SigK.save.saveActive();

  assert.equal(shell.SigK.viewer.isDirty(), false);
  assert.match(shell.SigK.viewBanner.text(), /保存しました/);
});

test('編集していなければ、上書き保存は何もしない', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult()] });

  const result = await shell.SigK.save.saveActive();
  assert.deepEqual(plain(result), { ok: true, unchanged: true });
  assert.equal(shell.taskCalls.length, 0, 'ワーカーを起こさない');
});

test('文書を開いていなければ保存しない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());

  assert.match((await shell.SigK.save.saveActive()).error, /開かれていません/);
  assert.match((await shell.SigK.save.saveAsActive()).error, /開かれていません/);
});

test('名前を付けて保存は行き先を選ばせ、.bak を作らない', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [okResult({ path: B })],
    savePathResults: [{ path: B }],
  });

  const result = await shell.SigK.save.saveAsActive();
  assert.equal(result.ok, true);

  assert.deepEqual(shell.savePathCalls[0], { defaultPath: A }, '元の場所を既定にする');
  const { spec } = shell.taskCalls[0];
  assert.equal(spec.source, A, '読むのは元のファイル');
  assert.equal(spec.target, B);
  // 元ファイルを触らないので退避は要らない（確定事項18）。
  assert.equal(spec.makeBackup, false);
});

test('名前を付けて保存すると、タブが新しいファイルへ移る', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [okResult({ path: B })],
    savePathResults: [{ path: B }],
  });

  await shell.SigK.save.saveAsActive();
  await shell.flush();

  const tab = shell.SigK.tabs.list().find((info) => info.active);
  assert.equal(tab.path, B, '以後の上書き保存は新しいほうへ行く（確定事項26）');
  assert.equal(tab.name, 'b.pdf');
  assert.equal(shell.SigK.viewer.getState().file.path, B);
  // 最近使ったファイルにも新しいほうを載せる。
  assert.ok(shell.recentCalls.some((call) => call.kind === 'add' && call.entry.path === B));
});

test('保存先を選ばなければ何も起きない', async (t) => {
  const shell = await withOpenDocument(t, { savePathResults: [{ canceled: true }] });

  assert.deepEqual(plain(await shell.SigK.save.saveAsActive()), { canceled: true });
  assert.equal(shell.taskCalls.length, 0);
});

test('進捗は帯に段の番号つきで出て、中止ボタンが付く', async (t) => {
  // 進捗を見るあいだ run を待たせる。
  let release = null;
  const shell = await withOpenDocument(t);
  shell.window.taskAPI.run = (taskId, spec) => {
    shell.taskCalls.push({ taskId, spec });
    return new Promise((resolve) => { release = () => resolve(okResult()); });
  };
  edit(shell.SigK);

  const promise = shell.SigK.save.saveActive();
  await shell.flush();

  assert.match(shell.SigK.viewBanner.text(), /保存しています/);
  const taskId = shell.taskCalls[0].taskId;
  shell.fireProgress({ taskId, phase: 'save', label: '書き出しています', step: 4, total: 5 });
  assert.match(shell.SigK.viewBanner.text(), /4\/5/);

  const cancel = shell.SigK.viewBanner.action();
  assert.notEqual(cancel, null, '中止を押す場所が要る（確定事項8）');
  cancel.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(shell.taskCancels, [taskId]);

  release();
  await promise;
});

test('別のタスクの進捗は混ざらない', async (t) => {
  const shell = await withOpenDocument(t);

  shell.fireProgress({ taskId: 'よそのタスク', phase: 'save', step: 4, total: 5 });
  assert.equal(shell.SigK.viewBanner.isVisible(), false);
});

test('保存中は保存ボタンを押せない', async (t) => {
  let release = null;
  const shell = await withOpenDocument(t);
  shell.window.taskAPI.run = () => new Promise((resolve) => { release = () => resolve(okResult()); });
  edit(shell.SigK);

  const promise = shell.SigK.save.saveActive();
  await shell.flush();
  assert.equal(shell.SigK.save.isBusy(), true);
  assert.equal(shell.document.getElementById('btn-save').getAttribute('aria-disabled'), 'true');
  assert.match((await shell.SigK.save.saveActive()).error, /いま保存しています/);

  release();
  await promise;
  assert.equal(shell.SigK.save.isBusy(), false);
  assert.equal(shell.document.getElementById('btn-save').getAttribute('aria-disabled'), 'false');
});

test('中止したら、そのことを帯に出す', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [{ canceled: true }] });
  edit(shell.SigK);

  assert.deepEqual(await shell.SigK.save.saveActive(), { canceled: true });
  assert.match(shell.SigK.viewBanner.text(), /中止しました/);
  assert.match(shell.SigK.viewBanner.text(), /元のファイルは変更していません/);
  assert.equal(shell.SigK.viewer.isDirty(), true, '書いていないので未保存のままである');
});

test('失敗したら、ワーカーの文言をそのまま帯に出す', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [{ error: 'パスワードで保護された PDF は保存できません。' }],
  });
  edit(shell.SigK);

  const result = await shell.SigK.save.saveActive();
  assert.match(result.error, /パスワードで保護された/);
  assert.match(shell.SigK.viewBanner.text(), /パスワードで保護された/);
  assert.equal(shell.SigK.viewer.isDirty(), true);
});

test('外から書き換えられていたら聞き、了承すれば照合を外してもう一度書く', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [{ changed: true, current: { size: 9, mtimeMs: 9 } }, okResult()],
  });
  edit(shell.SigK);

  const promise = shell.SigK.save.saveActive();
  await shell.flush();

  assert.equal(shell.SigK.confirmOverwrite.isOpen(), true);
  assert.match(shell.document.getElementById('confirm-overwrite-text').textContent, /a\.pdf/);
  shell.document.getElementById('confirm-overwrite-ok').click();

  assert.equal((await promise).ok, true);
  assert.equal(shell.taskCalls.length, 2);
  assert.deepEqual(shell.taskCalls[0].spec.expect, { size: 1024, mtimeMs: 1000 });
  assert.equal(shell.taskCalls[1].spec.expect, null, '了承されたので照合を外す');
});

test('外から書き換えられていて、取りやめたら書かない', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [{ changed: true, current: { size: 9, mtimeMs: 9 } }],
  });
  edit(shell.SigK);

  const promise = shell.SigK.save.saveActive();
  await shell.flush();
  shell.document.getElementById('confirm-overwrite-cancel').click();

  assert.deepEqual(plain(await promise), { canceled: true });
  assert.equal(shell.taskCalls.length, 1);
  assert.equal(shell.SigK.viewer.isDirty(), true);
});

test('メニューの合図から保存できる', async (t) => {
  const shell = await withOpenDocument(t, {
    taskResults: [okResult(), okResult({ path: B })],
    savePathResults: [{ path: B }],
  });
  edit(shell.SigK);

  shell.fireSaveRequest('save');
  await shell.flush();
  assert.equal(shell.taskCalls[0].spec.target, A);

  edit(shell.SigK);
  shell.fireSaveRequest('saveAs');
  await shell.flush();
  assert.equal(shell.taskCalls[1].spec.target, B);
});

test('保存したあと、2回目の上書きは新しい署名で照合する', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult(), okResult()] });
  edit(shell.SigK);
  await shell.SigK.save.saveActive();

  // もう一度編集して保存する。
  shell.SigK.viewer.applyPlan(shell.SigK.pagePlan.rotatePages(shell.SigK.viewer.getPlan(), [0], 90));
  await shell.SigK.save.saveActive();

  assert.deepEqual(shell.taskCalls[1].spec.expect, { size: 2048, mtimeMs: 2000 }, '書いた直後の署名で照合する');
});
