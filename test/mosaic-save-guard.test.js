'use strict';

// 保存・抽出の前にモザイクのページを画像にする間の守り（mosaic-save.js・save.js・extract.js。spec-4b-6b 確定事項19。コードの点検で直した）。
//   - 確認の間・画像にしている間に、ページの編集かタブの切り替えがあれば、何も書かずに取りやめる（描いた画像と並びが食い違うと、
//     モザイクのページが元の中身のまま書かれるため）
//   - 最後のページを描いている間の［中止］も効く
//   - 名前を付けて保存で開いているファイル自身を選んだら、上書き保存と同じ確認と控えの扱いにする
//   - モザイクがあれば、開いたときの元のファイルの印をワーカーへ渡す（外で書き換わっていれば、ワーカーが断る）
//   - 細長い紙は 1 辺の画素も上限に収める

const test = require('node:test');
const assert = require('node:assert/strict');

const { A, B, withMosaic, placeMosaic, stubImages, byId, spec, okResult, makeSource } = require('./fixtures/mosaic-shell.js');

const CHANGED = /ページかタブが変わったので、保存を取りやめました。元のファイルは変更していません。もう一度保存してください。/;

function rotateSecond(shell) {
  const { SigK } = shell;
  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [1], 90));
}

async function confirmAndWait(shell, saving) {
  await shell.flush();
  byId(shell, 'confirm-mosaic-ok').click();
  return saving;
}

test('最後のページを描いている間に［中止］を押しても、何も書かない（モザイクが 1 ページだけでも）', async (t) => {
  const shell = await withMosaic(t, { taskResults: [okResult()] });
  stubImages(t, shell, { onRender: () => shell.SigK.viewBanner.action()?.click() });
  const result = await confirmAndWait(shell, shell.SigK.save.saveActive());
  assert.equal(result.canceled, true);
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(shell.SigK.viewBanner.text(), '保存を中止しました。元のファイルは変更していません。');
});

test('画像にしている間に別のページへモザイクを置くと、取りやめて何も書かない（置いたモザイクは残る）', async (t) => {
  const shell = await withMosaic(t, { taskResults: [okResult()] });
  stubImages(t, shell, { onRender: () => placeMosaic(shell, [1]) });
  const result = await confirmAndWait(shell, shell.SigK.save.saveActive());
  assert.equal(result.changed, true);
  assert.equal(shell.taskCalls.length, 0);
  assert.match(shell.SigK.viewBanner.text(), CHANGED);
  assert.equal(byId(shell, 'view-banner').getAttribute('data-tone'), 'warn');
  assert.equal(shell.SigK.viewer.getPlan()[1].mosaic.length, 1);
});

test('画像にしている間に別のタブへ切り替えると、そのタブのページは描かずに取りやめる', async (t) => {
  const shell = await withMosaic(t, { taskResults: [okResult()], files: { [B]: makeSource({ path: B, name: 'b.pdf' }) } }, [0, 1]);
  const calls = stubImages(t, shell, { onRender: async (count) => {
    if (count === 1)
      await shell.SigK.tabs.openPath(B);
  } });
  const result = await confirmAndWait(shell, shell.SigK.save.saveActive());
  assert.equal(result.changed, true);
  assert.equal(calls.length, 1, '2 ページ目（b.pdf のページ）は描かない');
  assert.equal(shell.taskCalls.length, 0);
});

test('保存の確認を出している間にページを回すと、了承しても描かずに取りやめる', async (t) => {
  const shell = await withMosaic(t, { taskResults: [okResult()] });
  const calls = stubImages(t, shell);
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  rotateSecond(shell);
  byId(shell, 'confirm-mosaic-ok').click();
  assert.equal((await saving).changed, true);
  assert.equal(calls.length, 0);
  assert.equal(shell.taskCalls.length, 0);
});

test('抽出の確認を出している間にページを回すと、取りやめて何も書かない', async (t) => {
  const shell = await withMosaic(t, { taskResults: [{ ok: true, pages: 2 }], savePathResults: [{ path: 'C:\\work\\out.pdf' }] });
  stubImages(t, shell);
  shell.SigK.pageGrid.setSelection([0, 1]);
  const running = shell.SigK.extract.run();
  await shell.flush();
  rotateSecond(shell);
  byId(shell, 'confirm-extract-ok').click();
  assert.equal((await running).changed, true);
  assert.equal(shell.taskCalls.length, 0);
  assert.match(shell.SigK.viewBanner.text(), /ページかタブが変わったので、抽出を取りやめました。/);
});

test('名前を付けて保存で開いているファイル自身を選ぶと、上書き保存の確認を出し、前の控えを消すよう渡す', async (t) => {
  const shell = await withMosaic(t, { taskResults: [okResult()], savePathResults: [{ path: 'c:/work/A.PDF' }] });
  stubImages(t, shell);
  const saving = shell.SigK.save.saveAsActive();
  await shell.flush();
  assert.equal(byId(shell, 'confirm-mosaic-text').textContent, 'モザイクを入れた 1 ページ（1 ページ目）を、丸ごと画像に置き換えて「A.PDF」に上書き保存します。');
  assert.equal(byId(shell, 'confirm-mosaic-backup').hidden, false);
  byId(shell, 'confirm-mosaic-ok').click();
  assert.equal((await saving).ok, true);
  assert.equal(spec(shell).makeBackup, false);
  assert.equal(spec(shell).dropBackup, true);
});

test('モザイクがあれば開いたときの元のファイルの印を渡し、無ければ渡さない', async (t) => {
  const shell = await withMosaic(t, { taskResults: [okResult(), okResult()] });
  stubImages(t, shell);
  await confirmAndWait(shell, shell.SigK.save.saveActive());
  assert.deepEqual({ ...spec(shell).expectSource }, { size: 1024, mtimeMs: 1000 });
  const { SigK } = shell;
  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));
  await SigK.save.saveActive();
  assert.equal(spec(shell).expectSource, null);
});

test('scaleFor は細長い紙の 1 辺も 16,384 画素に収める', async (t) => {
  const shell = await withMosaic(t);
  const { scaleFor, MAX_SIDE } = shell.SigK.mosaicSave;
  const strip = [0, 0, 14400, 100];
  assert.ok(14400 * scaleFor(strip) <= MAX_SIDE);
  assert.ok(14400 * scaleFor(strip) > MAX_SIDE * 0.99);
  assert.equal(scaleFor([0, 0, 595, 842]), 300 / 72, 'ふつうの紙は 300dpi のまま');
});
