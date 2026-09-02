'use strict';

// 挿入の画面側のテスト（spec-1-6 確定事項53〜65・93〜95）。
//
// 実際にページを組み立てるのはワーカーで、その中身は test/op-insert.test.js が
// 見ている。ここは「どこへ、何を控え、画面がどう変わるか」を見る。
//
// いちばん確かめたいのは**差し込んだページが別の文書から引かれる**ことである
// （確定事項93）。plan の { insert } を写像し損なうと、差し込んだところに
// 元ファイルの1ページ目が出る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, A4 } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const PHOTO = 'C:\\work\\photo.jpg';

const plain = (value) => structuredClone(value);

// ワーカーが返す「組み立てたページ」。bytes の中身はスタブに読まれないので、
// PDF の署名だけ入れておく。
const preview = (pages) => ({
  ok: true,
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
  pages,
  kind: 'jpeg',
});

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

// 1枚の写真を差し込む一式を仕込む。
function withPhoto(pages = [{ width: A4.width, height: A4.height }]) {
  return {
    insertSourceResults: [{ path: PHOTO }],
    taskResults: [preview(pages)],
  };
}

test('文書が開いていれば、選択が無くても挿入できる', async (t) => {
  const shell = await withOpenDocument(t);

  // 抽出と違い、選択は要らない。無ければ末尾へ差し込む（確定事項64）。
  assert.equal(shell.SigK.insert.canInsert(), true);
  assert.equal(shell.document.getElementById('act-insert').hasAttribute('aria-disabled'), false);
});

test('文書を開いていなければ挿入しない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());

  assert.equal(shell.SigK.insert.canInsert(), false);
  assert.match((await shell.SigK.insert.run()).error, /開かれていません/);
});

test('保存中は挿入できない', async (t) => {
  let release = null;
  const shell = await withOpenDocument(t);
  shell.window.taskAPI.run = () => new Promise((resolve) => { release = () => resolve({ ok: true }); });
  shell.SigK.viewer.applyPlan(shell.SigK.pagePlan.rotatePages(shell.SigK.viewer.getPlan(), [0], 90));

  const saving = shell.SigK.save.saveActive();
  await shell.flush();

  assert.equal(shell.SigK.insert.canInsert(), false);
  assert.match((await shell.SigK.insert.run()).error, /いま保存しています/);

  release();
  await saving;
  assert.equal(shell.SigK.insert.canInsert(), true);
});

test('選択が無ければ末尾、あればその直前へ差し込む', async (t) => {
  const shell = await withOpenDocument(t);

  assert.equal(shell.SigK.insert.insertAt(), 3, '3ページの末尾');
  shell.SigK.pageGrid.setSelection([2, 1]);
  assert.equal(shell.SigK.insert.insertAt(), 1, '選んだうち最も前のページの直前');
});

test('紙の大きさは直前のページに合わせる。先頭なら直後', async (t) => {
  const shell = await withOpenDocument(t);
  // 2ページ目を90度回すと、そのページの見えている寸法は幅と高さが入れ替わる。
  shell.SigK.viewer.applyPlan(shell.SigK.pagePlan.rotatePages(shell.SigK.viewer.getPlan(), [1], 90));

  assert.deepEqual(plain(shell.SigK.insert.baseSizeAt(2)),
    { width: A4.height, height: A4.width }, '回っているページが基準なら入れ替わる');
  assert.deepEqual(plain(shell.SigK.insert.baseSizeAt(0)),
    { width: A4.width, height: A4.height }, '先頭へ挿すときは直後のページ');
});

test('選んだファイルと基準の大きさをワーカーへ渡す', async (t) => {
  const shell = await withOpenDocument(t, withPhoto());
  shell.SigK.pageGrid.setSelection([1]);

  assert.equal((await shell.SigK.insert.run()).ok, true);

  const { spec } = shell.taskCalls[0];
  assert.equal(spec.kind, 'insert-preview');
  assert.equal(spec.path, PHOTO);
  assert.deepEqual(spec.base, { width: A4.width, height: A4.height });
});

test('差し込むと plan にその位置の要素が増える', async (t) => {
  const shell = await withOpenDocument(t, withPhoto());
  shell.SigK.pageGrid.setSelection([1]);

  const result = await shell.SigK.insert.run();
  assert.equal(result.pages, 1);
  await shell.flush();

  const plan = shell.SigK.viewer.getPlan();
  assert.equal(plan.length, 4);
  assert.deepEqual(plain(plan), [
    { src: 0, rotate: 0 },
    { insert: 0, rotate: 0 },
    { src: 1, rotate: 0 },
    { src: 2, rotate: 0 },
  ]);
  assert.equal(shell.SigK.viewer.getState().pageCount, 4);
  assert.equal(shell.SigK.viewer.isDirty(), true);
  assert.match(shell.SigK.viewBanner.text(), /1 ページを差し込みました/);
});

test('差し込んだページは、別の文書から引かれる', async (t) => {
  const shell = await withOpenDocument(t, withPhoto());

  await shell.SigK.insert.run();
  await shell.flush();

  // 元の文書は1つ目、組み立てたページは2つ目である（確定事項93）。
  const original = await shell.SigK.viewer.getPage(1);
  const inserted = await shell.SigK.viewer.getPage(4);
  assert.equal(original.docId, 0);
  assert.equal(inserted.docId, 1, '差し込んだページは組み立てた文書から来る');
  assert.equal(inserted.pageNumber, 1);
});

test('1つの PDF から複数ページ差し込める', async (t) => {
  const shell = await withOpenDocument(t, {
    insertSourceResults: [{ path: 'C:\\work\\b.pdf' }],
    taskResults: [preview([{ width: 100, height: 200 }, { width: 100, height: 200 }])],
  });
  shell.SigK.pageGrid.setSelection([0]);

  assert.equal((await shell.SigK.insert.run()).pages, 2);
  await shell.flush();

  assert.deepEqual(plain(shell.SigK.viewer.getPlan()).slice(0, 2),
    [{ insert: 0, rotate: 0 }, { insert: 1, rotate: 0 }]);
  // 控えは1ページに1つ。文書は共有する。
  assert.deepEqual(plain(shell.SigK.viewer.getInserts()), [
    { path: 'C:\\work\\b.pdf', page: 0, size: { width: 100, height: 200 } },
    { path: 'C:\\work\\b.pdf', page: 1, size: { width: 100, height: 200 } },
  ]);
  assert.equal((await shell.SigK.viewer.getPage(2)).pageNumber, 2, '2枚目は同じ文書の2ページ目');
});

test('差し込んだページの寸法が、画面の寸法になる', async (t) => {
  const shell = await withOpenDocument(t, withPhoto([{ width: 100, height: 200 }]));

  await shell.SigK.insert.run();
  await shell.flush();

  assert.deepEqual(plain(shell.SigK.viewer.getSizes().at(-1)), { width: 100, height: 200 });
});

test('Ctrl+Z で差し込みを取り消せる', async (t) => {
  const shell = await withOpenDocument(t, withPhoto());

  await shell.SigK.insert.run();
  await shell.flush();
  assert.equal(shell.SigK.viewer.getState().pageCount, 4);

  shell.SigK.pageEdit.undo();
  assert.equal(shell.SigK.viewer.getState().pageCount, 3);
  assert.equal(shell.SigK.viewer.isDirty(), false);

  // やり直すと戻る。控えは消していないので番号がずれない。
  shell.SigK.pageEdit.redo();
  assert.deepEqual(plain(shell.SigK.viewer.getPlan().at(-1)), { insert: 0, rotate: 0 });
});

test('保存では、控えも一緒にワーカーへ渡す', async (t) => {
  const shell = await withOpenDocument(t, {
    insertSourceResults: [{ path: PHOTO }],
    taskResults: [preview([{ width: 100, height: 200 }]), { ok: true, path: A, backup: `${A}.bak` }],
  });

  await shell.SigK.insert.run();
  await shell.flush();
  await shell.SigK.save.saveActive();

  const { spec } = shell.taskCalls[1];
  assert.equal(spec.kind, 'save');
  assert.deepEqual(spec.pages.at(-1), { insert: 0, rotate: 0 });
  // 紙の大きさは挿入した時点で決まっている（確定事項95）。
  assert.deepEqual(spec.inserts, [{ path: PHOTO, page: 0, size: { width: 100, height: 200 } }]);
});

test('ファイルを選ばなければ何も起きない', async (t) => {
  const shell = await withOpenDocument(t, { insertSourceResults: [{ canceled: true }] });

  assert.deepEqual(plain(await shell.SigK.insert.run()), { canceled: true });
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(shell.SigK.viewer.getState().pageCount, 3);
});

test('断られたら、ワーカーの文言をそのまま帯に出す', async (t) => {
  const shell = await withOpenDocument(t, {
    insertSourceResults: [{ path: 'C:\\work\\a.gif' }],
    taskResults: [{ error: 'GIF は挿入できません。PNG・JPEG・PDF を選んでください。' }],
  });

  const result = await shell.SigK.insert.run();

  assert.match(result.error, /GIF は挿入できません/);
  assert.match(shell.SigK.viewBanner.text(), /GIF は挿入できません/);
  assert.equal(shell.SigK.viewer.getState().pageCount, 3, '並びは変わらない');
});

test('組み立てたページを開けなければ、並びを変えない', async (t) => {
  const shell = await withOpenDocument(t, withPhoto());
  shell.window.SigK.pdfjs.getDocument = () => ({ promise: Promise.reject(new Error('壊れている')) });

  const result = await shell.SigK.insert.run();

  assert.match(result.error, /表示できませんでした/);
  assert.equal(shell.SigK.viewer.getState().pageCount, 3);
  assert.deepEqual(plain(shell.SigK.viewer.getInserts()), [], '控えも増やさない');
});

test('タブを移っても、差し込んだページは残る', async (t) => {
  const B = 'C:\\work\\b.pdf';
  const shell = await withOpenDocument(t, {
    ...withPhoto(),
    files: {
      [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }),
      [B]: makeSource({ path: B, name: 'b.pdf', size: 2048, mtimeMs: 2000 }),
    },
  });

  await shell.SigK.insert.run();
  await shell.flush();
  const before = plain(shell.SigK.viewer.getPlan());

  await shell.SigK.tabs.openPath(B);
  await shell.flush();
  assert.equal(shell.SigK.viewer.getState().pageCount, 3, '別のタブには差し込みが無い');

  const first = shell.SigK.tabs.list().find((info) => info.path === A);
  await shell.SigK.tabs.activate(first.id);
  await shell.flush();

  assert.deepEqual(plain(shell.SigK.viewer.getPlan()), before);
  assert.equal((await shell.SigK.viewer.getPage(4)).docId, 1, '写像も戻っている');
});
