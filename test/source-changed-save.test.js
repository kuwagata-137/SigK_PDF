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
  // 「書き換え」にそろえた文（確定事項C-10）。
  assert.equal(shell.document.getElementById('confirm-overwrite-text').textContent,
    'a.pdf は、開いたあとでほかのアプリで書き換えられているので、上書きすると、書き換えられた内容は失われます。');
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

// 差し込み（確定事項C-8）。下見の結果の印を控えて保存のときに渡し、書き換えられていたら下見の文書のバイト列を写しにしてやり直す。
const INS = 'C:\\work\\ins.pdf';
const inserted = (over = {}) => ({ ok: true, bytes: new Uint8Array([7, 7, 7]), pages: [{ width: 595, height: 842 }], kind: 'pdf', signature: { size: 50, mtimeMs: 500 }, ...over });

test('差し込んだファイルの印を控えて保存のときに渡し、書き換えられていたら、上書きでも聞かずに差し込んだときの中身でやり直す', async (t) => {
  const shell = await withOpenDocument(t, { insertSourceResults: [{ path: INS }], taskResults: [inserted(), { insertChanged: true }, okResult()] });
  assert.equal((await shell.SigK.insert.run()).ok, true);
  await shell.flush();
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  assert.equal(shell.SigK.confirmOverwrite.isOpen(), false, '元のファイルへの書き換えではないので聞かない');
  assert.equal((await saving).ok, true);
  assert.deepEqual(plain(shell.taskCalls[1].spec.inserts[0].expect), { size: 50, mtimeMs: 500 });
  const second = shell.taskCalls[2].spec;
  const insert = second.inserts[0];
  assert.equal(insert.path, undefined, 'ディスクから読み直さない');
  assert.equal(insert.page, 0);
  assert.deepEqual(Array.from(second.copies[insert.copy]), [7, 7, 7]);
  assert.equal(second.sourceCopy, 'opened', '元も開いたときの中身から作る（中身は同じ）');
});

test('差し込みと元の両方が書き換えられていて上書きなら、確認の窓を 1 回だけ出してから、両方を控えた中身でやり直す', async (t) => {
  const shell = await withOpenDocument(t, { insertSourceResults: [{ path: INS }], taskResults: [inserted(), { sourceChanged: true }, okResult()] });
  await shell.SigK.insert.run();
  await shell.flush();
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  assert.equal(shell.SigK.confirmOverwrite.isOpen(), true);
  shell.document.getElementById('confirm-overwrite-ok').click();
  assert.equal((await saving).ok, true);
  assert.equal(shell.taskCalls.length, 3);
  const second = shell.taskCalls[2].spec;
  assert.deepEqual(Array.from(second.copies[second.inserts[0].copy]), [7, 7, 7]);
  assert.deepEqual(Array.from(second.copies.opened), OPENED_BYTES);
});

// ---- 点検の直し（2026-10-20。I-1・M-1〜M-3 と足りなかったテスト） ----

test('抽出は、保存の窓を開いている間も保存の枠を押さえる（エクスプローラーから開いたファイルを待たせる。I-1）', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [{ ok: true, path: OUT, pages: 1 }] });
  let busyDuringDialog = null;
  shell.window.pdfAPI.pickSavePath = async () => { busyDuringDialog = shell.SigK.save.isBusy(); return { path: OUT }; };
  shell.SigK.pageGrid.setSelection([1]);
  const running = shell.SigK.extract.run();
  await shell.flush();
  shell.document.getElementById('confirm-extract-ok').click();
  assert.equal((await running).ok, true);
  assert.equal(busyDuringDialog, true);
  assert.equal(shell.SigK.save.isBusy(), false, '終わったら放す');
});

test('抽出の保存の窓の間に映しているタブが替わったら、ワーカーへ渡さずに取りやめる（I-1）', async (t) => {
  const shell = await withOpenDocument(t, { files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }), [B]: makeSource({ path: B, name: 'b.pdf' }) } });
  shell.window.pdfAPI.pickSavePath = async () => { await shell.SigK.tabs.openPath(B); return { path: OUT }; };
  shell.SigK.pageGrid.setSelection([1]);
  const running = shell.SigK.extract.run();
  await shell.flush();
  shell.document.getElementById('confirm-extract-ok').click();
  const result = await running;
  assert.equal(result.changed, true);
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(shell.SigK.viewBanner.text(), '抽出の確認や画像にしている間に、ページかタブが変わったので、抽出を取りやめました。もう一度抽出してください。');
});

test('1 回目とやり直しの間（開いたときの中身を読む間）も保存の枠を押さえる（M-1）', async (t) => {
  const shell = await withOpenDocument(t, { taskResults: [{ sourceChanged: true }, { ok: true, bytes: new Uint8Array([9]), pages: 1, sizes: [{ width: 595, height: 842 }] }] });
  let busyWhileReading = null;
  shell.SigK.viewer.peek().doc.getData = async () => { busyWhileReading = shell.SigK.save.isBusy(); return new Uint8Array([1]); };
  assert.equal((await shell.SigK.pageCopyBuild.build([0], { open: false })).ok, true);
  assert.equal(busyWhileReading, true);
  assert.equal(shell.SigK.save.isBusy(), false);
});

test('差し込みだけが書き換えられていたやり直しは行き先の照合を残し、やり直しで元が書き換えられていたら、そこで確認の窓を出す（M-2）', async (t) => {
  const shell = await withOpenDocument(t, { insertSourceResults: [{ path: INS }], taskResults: [inserted(), { insertChanged: true }, { changed: true, current: { size: 9, mtimeMs: 9 } }, okResult()] });
  await shell.SigK.insert.run();
  await shell.flush();
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  assert.equal(shell.SigK.confirmOverwrite.isOpen(), true);
  assert.deepEqual(plain(shell.taskCalls[2].spec.expect), OPENED, '聞いていないので、行き先の照合は外さない');
  shell.document.getElementById('confirm-overwrite-ok').click();
  assert.equal((await saving).ok, true);
  assert.equal(shell.taskCalls.length, 4);
  assert.equal(shell.taskCalls[3].spec.expect, null);
  assert.equal(shell.taskCalls[3].spec.inserts[0].copy, shell.taskCalls[2].spec.inserts[0].copy);
});

test('読み出せなかったときの文は、読み出せなかった方で選ぶ（M-3）', async (t) => {
  const shell = await withOpenDocument(t, { insertSourceResults: [{ path: INS }], taskResults: [inserted(), { insertChanged: true }, { insertChanged: true }] });
  await shell.SigK.insert.run();
  await shell.flush();
  // 差し込みだけが書き換えられていて、元の文書を読み出せない → 元の文。
  shell.SigK.viewer.peek().doc.getData = async () => { throw new Error('読めない'); };
  assert.equal((await shell.SigK.save.saveActive()).error, UNREADABLE);
  // 差し込みの下見の文書を読み出せない → 差し込みの文。
  shell.SigK.viewer.peek().doc.getData = async () => new Uint8Array([1]);
  shell.SigK.viewer.peek().inserts[0].doc.getData = async () => { throw new Error('読めない'); };
  assert.equal((await shell.SigK.save.saveActive()).error,
    '差し込んだあとで差し込んだファイルがほかのアプリで書き換えられていて、差し込んだときの中身も読み出せなかったので、保存できませんでした。元のファイルは変更していません。');
});

test('写し（copy）と、同じ下見の文書の 2 ページと、並びに無い差し込みが混ざっていても、写しにするのは並びにあるファイルの差し込みだけで、下見の文書は 1 回だけ読む', async (t) => {
  const two = inserted({ pages: [{ width: 595, height: 842 }, { width: 595, height: 842 }] });
  const shell = await withOpenDocument(t, { insertSourceResults: [{ path: INS }, { path: 'C:\\work\\gone.pdf' }], taskResults: [two, inserted({ bytes: new Uint8Array([8]) }), { insertChanged: true }, okResult()] });
  const { SigK } = shell;
  await SigK.insert.run();
  await shell.flush();
  await SigK.insert.run();
  await shell.flush();
  // 2 回目に差し込んだページ（並びの末尾）を並びから外す（控えには残る）。
  SigK.viewer.applyPlan(SigK.viewer.getPlan().filter((page) => page.insert !== 2));
  const copyNumber = SigK.viewer.addInserts([{ path: null, copy: 'copy-1', bytes: new Uint8Array([5]), page: 0, size: { width: 595, height: 842 }, doc: SigK.viewer.peek().inserts[0].doc }])[0];
  SigK.viewer.applyPlan([...SigK.viewer.getPlan(), { insert: copyNumber, rotate: 0 }]);
  let reads = 0;
  const shared = SigK.viewer.peek().inserts[0].doc;
  const original = shared.getData.bind(shared);
  shared.getData = async () => { reads += 1; return original(); };
  assert.equal((await SigK.save.saveActive()).ok, true);
  const second = shell.taskCalls.at(-1).spec;
  assert.equal(reads, 1, '同じ下見の文書は 1 回だけ読む');
  assert.equal(second.inserts[0].copy, second.inserts[1].copy, '同じ下見の 2 ページは同じ鍵');
  assert.equal(second.inserts[2].path, 'C:\\work\\gone.pdf', '並びに無い差し込みは写しにしない');
  assert.deepEqual(plain(second.inserts[3]), { copy: 'copy-1', page: 0, size: { width: 595, height: 842 } }, '写しはそのまま');
  assert.deepEqual(Array.from(second.copies['copy-1']), [5]);
});

test('名前の無い帯で差し込みだけが書き換えられていたら、元の写しの鍵はそのままで、差し込みだけを写しにする', async (t) => {
  const shell = await withOpenDocument(t, { insertSourceResults: [{ path: INS }], savePathResults: [{ path: B }], taskResults: [inserted(), { insertChanged: true }, okResult({ path: B })] });
  await shell.SigK.tabs.openSource({ ok: true, path: null, name: '新しい PDF 1', bytes: new Uint8Array(OPENED_BYTES), copy: 'c1', untitled: true, folder: 'C:\\work' });
  await shell.flush();
  await shell.SigK.insert.run();
  await shell.flush();
  assert.equal((await shell.SigK.save.saveActive()).ok, true);
  const second = shell.taskCalls.at(-1).spec;
  assert.equal(second.sourceCopy, 'c1');
  assert.equal(second.copies.opened, undefined);
  assert.equal(typeof second.inserts[0].copy, 'string');
});
