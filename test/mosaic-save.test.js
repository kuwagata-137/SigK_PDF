'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { A, B, PAPER, withMosaic, stubImages, byId, spec, okResult, makeSource } = require('./fixtures/mosaic-shell.js');

// 保存・抽出の前にモザイクのページを画像にする（spec-4b-6b 確定事項18・19・23〜25。決定64 ⑤⑧・決定66 ①②）。jsdom には 2D コンテキストが
// 無いので、描く部品を差し替えて（fixtures/mosaic-shell.js）、確認・ワーカーへ渡す spec・帯を見る。描いた画像に元の文字が残らないことは
// ワーカーのテスト（mosaic-save-worker.test.js）と起動確認が見る。画像にしている間の編集・中止・照合は mosaic-save-guard.test.js。

test('上書き保存: 確認でページ・保存先・控えを作らないことを名指しし、了承すると 300dpi・回転 0・紙全体・書き込みなしで描いて渡す', async (t) => {
  const shell = await withMosaic(t, { taskResults: [okResult()] }, [0, 2]);
  const calls = stubImages(t, shell);
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  assert.equal(shell.SigK.confirmMosaic.isOpen(), true);
  assert.equal(byId(shell, 'confirm-mosaic-text').textContent, 'モザイクを入れた 2 ページ（1・3 ページ目）を、丸ごと画像に置き換えて「a.pdf」に上書き保存します。');
  assert.match(byId(shell, 'confirm-mosaic-loss').textContent, /検索・選択・コピーできなくなり/);
  assert.equal(byId(shell, 'confirm-mosaic-backup').hidden, false);
  assert.match(byId(shell, 'confirm-mosaic-backup').textContent, /控えのファイル（\.bak）を作りません。前に作った控えがあれば消します。/);
  assert.equal(shell.document.activeElement?.id, 'confirm-mosaic-cancel');
  assert.equal(byId(shell, 'confirm-mosaic-ok').classList.contains('danger'), true);
  byId(shell, 'confirm-mosaic-ok').click();
  const result = await saving;
  assert.equal(result.ok, true);

  assert.deepEqual(calls.map((call) => call.page), [1, 3]);
  for (const call of calls) {
    assert.equal(call.scale, 300 / 72);
    assert.equal(call.rotation, 0);
    assert.deepEqual(call.box, PAPER);
    assert.equal(call.annotationMode, 0, 'DISABLE（書き込みを描かない）');
  }
  const sent = spec(shell);
  assert.equal(sent.makeBackup, false);
  assert.equal(sent.dropBackup, true);
  assert.deepEqual(sent.mosaics.map(({ src, kind, box, bytes }) => ({ src, kind, box, length: bytes.length })),
    [{ src: 0, kind: 'png', box: PAPER, length: 10 }, { src: 2, kind: 'png', box: PAPER, length: 10 }]);
  assert.equal(shell.SigK.viewBanner.text(), '保存しました。');
});

test('確認でキャンセルすると何も書かず、下見のモザイクは残る', async (t) => {
  const shell = await withMosaic(t);
  const calls = stubImages(t, shell);
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  byId(shell, 'confirm-mosaic-cancel').click();
  assert.equal((await saving).canceled, true);
  assert.equal(calls.length, 0);
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(shell.SigK.viewBanner.text(), '保存を取りやめました。');
  assert.equal(shell.SigK.viewer.getPlan()[0].mosaic.length, 1);
});

test('PNG が JPEG の 2 倍を超えるページ（写真）は JPEG で渡す', async (t) => {
  const shell = await withMosaic(t, { taskResults: [okResult()] });
  stubImages(t, shell, { png: 30, jpeg: 10 });
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  byId(shell, 'confirm-mosaic-ok').click();
  await saving;
  assert.equal(spec(shell).mosaics[0].kind, 'jpeg');
  assert.equal(spec(shell).mosaics[0].bytes.length, 10);
});

test('名前を付けて保存: 元のファイルは変わらないと伝え、控えには触れない', async (t) => {
  const shell = await withMosaic(t, { taskResults: [okResult()], savePathResults: [{ path: B }] });
  shell.files[B] = makeSource({ path: B, name: 'b.pdf' });
  stubImages(t, shell);
  const saving = shell.SigK.save.saveAsActive();
  await shell.flush();
  assert.equal(byId(shell, 'confirm-mosaic-text').textContent,
    'モザイクを入れた 1 ページ（1 ページ目）を、丸ごと画像に置き換えて「b.pdf」に保存します。元のファイル「a.pdf」は変わりません。');
  assert.equal(byId(shell, 'confirm-mosaic-backup').hidden, true);
  byId(shell, 'confirm-mosaic-ok').click();
  assert.equal((await saving).ok, true);
  assert.equal(spec(shell).target, B);
  assert.equal(spec(shell).makeBackup, false);
  assert.equal(spec(shell).dropBackup, false);
  assert.equal(spec(shell).mosaics.length, 1);
});

test('前の控えを消せなかったら、保存は成功のまま黄色の帯で知らせる', async (t) => {
  const shell = await withMosaic(t, { taskResults: [{ ...okResult(), backupLeft: true }] });
  stubImages(t, shell);
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  byId(shell, 'confirm-mosaic-ok').click();
  assert.equal((await saving).ok, true);
  assert.equal(shell.SigK.viewBanner.text(), '保存しました。控えのファイル（.bak）を消せませんでした。元の内容が残っているので、手で消してください。');
  assert.equal(byId(shell, 'view-banner').getAttribute('data-tone'), 'warn');
});

test('画像にしている途中で［中止］を押すと、何も書かずに止める', async (t) => {
  const shell = await withMosaic(t, {}, [0, 1]);
  stubImages(t, shell, { onRender: () => shell.SigK.viewBanner.action()?.click() });
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  byId(shell, 'confirm-mosaic-ok').click();
  assert.equal((await saving).canceled, true);
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(shell.SigK.viewBanner.text(), '保存を中止しました。元のファイルは変更していません。');
});

test('描けない環境（canvas が無い）では断って書かない', async (t) => {
  const shell = await withMosaic(t);
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  byId(shell, 'confirm-mosaic-ok').click();
  assert.ok((await saving).error);
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(shell.SigK.viewBanner.text(), 'この環境ではモザイクのページを画像にできません。');
});

test('モザイクが無ければ確認を出さず、今までどおり .bak を作って保存する', async (t) => {
  const shell = await withMosaic(t, { taskResults: [okResult()] }, []);
  shell.SigK.viewer.applyPlan(shell.SigK.pagePlan.rotatePages(shell.SigK.viewer.getPlan(), [0], 90));
  const result = await shell.SigK.save.saveActive();
  assert.equal(result.ok, true);
  assert.equal(shell.SigK.confirmMosaic.isOpen(), false);
  assert.equal(spec(shell).makeBackup, true);
  assert.equal(spec(shell).dropBackup, false);
  assert.deepEqual([...spec(shell).mosaics], []);
});

test('抽出: 抽出の確認に一文を足し、選んだページのうちモザイクのあるページだけを画像にして渡す', async (t) => {
  const OUT = 'C:\\work\\out.pdf';
  const shell = await withMosaic(t, { taskResults: [{ ok: true, pages: 2 }], savePathResults: [{ path: OUT }] });
  const calls = stubImages(t, shell);
  shell.SigK.pageGrid.setSelection([0, 1]);
  const running = shell.SigK.extract.run();
  await shell.flush();
  assert.match(byId(shell, 'confirm-extract-text').textContent, /モザイクを入れた 1 ページは、画像に置き換えて書き出します。$/);
  assert.equal(shell.SigK.confirmMosaic.isOpen(), false, '保存の確認は出さない');
  byId(shell, 'confirm-extract-ok').click();
  const result = await running;
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.page), [1]);
  assert.equal(spec(shell).kind, 'extract');
  assert.deepEqual(spec(shell).mosaics.map((item) => item.src), [0]);
});

test('scaleFor は 300dpi で 4,000 万画素を超える紙だけ細かさを下げる', async (t) => {
  const shell = await withMosaic(t);
  const { scaleFor, MAX_PIXELS } = shell.SigK.mosaicSave;
  assert.equal(scaleFor(PAPER), 300 / 72);
  const a1 = [0, 0, 1684, 2384];
  const scale = scaleFor(a1);
  assert.ok(scale < 300 / 72);
  assert.ok(1684 * 2384 * scale * scale <= MAX_PIXELS);
  assert.ok(1684 * 2384 * scale * scale > MAX_PIXELS * 0.99);
});
