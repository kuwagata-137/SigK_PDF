'use strict';

// 開いたあとでほかのアプリが元のファイルを書き換えたときの、画面側の保存・名前を付けて保存・抽出・写す（spec-6-1 タスク C。決定81 ①）。
//
// ワーカーの中身は test/source-changed-worker.test.js が見る。ここは「何を照らさせ、書き換えられていたら何を聞き、何を渡してやり直すか」を見る。
//   - 行き先の照合（expect）は、行き先が元のファイルと同じときだけ（C-1。穴①）。
//   - 開いたときの元の印（expectSource）は、パスのある文書ならいつも渡す（C-2）。
//   - sourceChanged・changed が返ったら、pdf.js の getData() のバイト列を鍵 'opened' の写しで渡してやり直す（C-3）。聞くのは行き先が元と同じときだけ（C-4）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const OUT = 'C:\\work\\a_抽出.pdf';
const OPENED = { size: 1024, mtimeMs: 1000 };
// harness.js の makeSource が持たせるバイト列（開いたときの中身）。
const OPENED_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d];
const UNREADABLE = '開いたあとで元のファイルがほかのアプリで書き換えられていて、開いたときの中身も読み出せなかったので、保存できませんでした。元のファイルは変更していません。';

const plain = (value) => structuredClone(value);
const okResult = (over = {}) => ({ ok: true, path: A, backup: null, signature: { size: 2048, mtimeMs: 2000 }, ...over });

async function withOpenDocument(t, options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A, name: 'a.pdf', size: OPENED.size, mtimeMs: OPENED.mtimeMs }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  return shell;
}

function edit(SigK) {
  SigK.viewer.applyPlan(SigK.pagePlan.movePages(SigK.viewer.getPlan(), [0], 2).plan);
}

// やり直しで渡した開いたときの中身。
function openedOf(spec) {
  return { sourceCopy: spec.sourceCopy, bytes: Array.from(spec.copies?.opened ?? []), expect: spec.expect, expectSource: spec.expectSource };
}

test('上書き保存は、モザイクが無くても開いたときの元の印を渡し、行き先の照合もする', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult()] });
  edit(shell.SigK);
  await shell.SigK.save.saveActive();
  const { spec } = shell.taskCalls[0];
  assert.deepEqual(plain(spec.expectSource), OPENED);
  assert.deepEqual(plain(spec.expect), OPENED);
  assert.equal(spec.sourceCopy, null, 'ふだんはバイト列を送らない');
});

test('名前を付けて保存で既にある別のファイルを選ぶと、行き先の照合はしない（穴①）。元の印は渡す', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult({ path: B })], savePathResults: [{ path: B }] });
  await shell.SigK.save.saveAsActive();
  const { spec } = shell.taskCalls[0];
  assert.equal(spec.expect, null);
  assert.deepEqual(plain(spec.expectSource), OPENED);
});

test('名前を付けて保存で元のファイル自身（区切りの字と大文字が違う書き方）を選ぶと、上書きと同じく行き先も照らす', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [okResult()], savePathResults: [{ path: 'c:/WORK/a.pdf' }] });
  await shell.SigK.save.saveAsActive();
  assert.deepEqual(plain(shell.taskCalls[0].spec.expect), OPENED);
});

test('上書き保存で元が書き換えられていたら確認の窓を出し、［上書き］なら開いたときの中身でやり直す', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [{ sourceChanged: true }, okResult()] });
  edit(shell.SigK);
  const pages = plain(shell.SigK.viewer.getPlan());
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  assert.equal(shell.SigK.confirmOverwrite.isOpen(), true);
  shell.document.getElementById('confirm-overwrite-ok').click();
  assert.equal((await saving).ok, true);
  assert.equal(shell.taskCalls.length, 2);
  const second = shell.taskCalls[1].spec;
  assert.deepEqual(openedOf(second), { sourceCopy: 'opened', bytes: OPENED_BYTES, expect: null, expectSource: null });
  assert.equal(second.source, A, 'パスはそのまま（控えの扱いと開き直しに使う）');
  assert.deepEqual(second.pages, pages, '並びは開いたときの中身に当てる');
  assert.equal(second.makeBackup, true, '書き換えられた中身は控え（.bak）に残る');
});

test('上書き保存で元が書き換えられていて［取りやめ］なら、やり直さない', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [{ sourceChanged: true }] });
  edit(shell.SigK);
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  shell.document.getElementById('confirm-overwrite-cancel').click();
  assert.deepEqual(plain(await saving), { canceled: true });
  assert.equal(shell.taskCalls.length, 1);
  assert.equal(shell.SigK.viewBanner.text(), '保存を取りやめました。');
  assert.equal(shell.SigK.viewer.isDirty(), true);
});

test('書く直前に行き先（元）が書き換えられた（changed）ときも、［上書き］なら開いたときの中身でやり直す', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [{ changed: true, current: { size: 9, mtimeMs: 9 } }, okResult()] });
  edit(shell.SigK);
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  shell.document.getElementById('confirm-overwrite-ok').click();
  assert.equal((await saving).ok, true);
  assert.deepEqual(openedOf(shell.taskCalls[1].spec), { sourceCopy: 'opened', bytes: OPENED_BYTES, expect: null, expectSource: null });
});

test('名前を付けて保存（別のファイル）で元が書き換えられていたら、聞かずに開いたときの中身でやり直し、タブは新しいファイルへ移る', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [{ sourceChanged: true }, okResult({ path: B })], savePathResults: [{ path: B }] });
  edit(shell.SigK);
  const result = await shell.SigK.save.saveAsActive();
  await shell.flush();
  assert.equal(result.ok, true);
  assert.equal(shell.SigK.confirmOverwrite.isOpen(), false);
  assert.deepEqual(openedOf(shell.taskCalls[1].spec), { sourceCopy: 'opened', bytes: OPENED_BYTES, expect: null, expectSource: null });
  assert.equal(shell.SigK.tabs.list().find((info) => info.active).path, B);
  assert.equal(shell.SigK.viewBanner.text(), '保存しました。');
});

test('開いたときの中身を読み出せなければ、やり直さずに止めて知らせる', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [{ sourceChanged: true }], savePathResults: [{ path: B }] });
  shell.SigK.viewer.peek().doc.getData = async () => { throw new Error('読めない'); };
  const result = await shell.SigK.save.saveAsActive();
  assert.equal(result.error, UNREADABLE);
  assert.equal(shell.taskCalls.length, 1);
  assert.equal(shell.SigK.viewBanner.text(), UNREADABLE);
});

test('確認の窓の間に別のタブへ移っても、保存したタブの開いたときの中身でやり直す', async (t) => {
  const shell = await withOpenDocument(t, {
    files: {
      [A]: makeSource({ path: A, name: 'a.pdf', size: OPENED.size, mtimeMs: OPENED.mtimeMs }),
      [B]: makeSource({ path: B, name: 'b.pdf', size: 4096, mtimeMs: 4000 }),
    },
    taskResults: [{ sourceChanged: true }, okResult()],
  });
  const { SigK } = shell;
  const tabA = SigK.tabs.activeId();
  edit(SigK);
  const docA = SigK.viewer.peek().doc;
  docA.getData = async () => new Uint8Array([1, 2, 3]);
  const saving = SigK.save.saveActive();
  await shell.flush();
  await SigK.tabs.openPath(B);
  await shell.flush();
  assert.notEqual(SigK.tabs.activeId(), tabA);
  shell.document.getElementById('confirm-overwrite-ok').click();
  assert.equal((await saving).ok, true);
  assert.deepEqual(Array.from(shell.taskCalls[1].spec.copies.opened), [1, 2, 3]);
});

test('抽出は開いたときの元の印をいつも渡し、書き換えられていたら聞かずに開いたときの中身でやり直す', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [{ sourceChanged: true }, { ok: true, path: OUT, pages: 1 }], savePathResults: [{ path: OUT }] });
  shell.SigK.pageGrid.setSelection([1]);
  const running = shell.SigK.extract.run();
  await shell.flush();
  shell.document.getElementById('confirm-extract-ok').click();
  assert.equal((await running).ok, true);
  assert.deepEqual(plain(shell.taskCalls[0].spec.expectSource), OPENED);
  assert.equal(shell.taskCalls[0].spec.expect, null);
  assert.deepEqual(openedOf(shell.taskCalls[1].spec), { sourceCopy: 'opened', bytes: OPENED_BYTES, expect: null, expectSource: null });
  assert.equal(shell.SigK.viewBanner.text(), '1 ページを抽出しました。');
});

test('帯のページを写すときも、開いたときの元の印を渡し、書き換えられていたら開いたときの中身でやり直す', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [{ sourceChanged: true }, { ok: true, bytes: new Uint8Array([9]), pages: 1, sizes: [{ width: 595, height: 842 }] }] });
  const built = await shell.SigK.pageCopyBuild.build([0], { open: false });
  assert.equal(built.ok, true, built.error);
  assert.deepEqual(plain(shell.taskCalls[0].spec.expectSource), OPENED);
  assert.deepEqual(openedOf(shell.taskCalls[1].spec), { sourceCopy: 'opened', bytes: OPENED_BYTES, expect: null, expectSource: null });
});
