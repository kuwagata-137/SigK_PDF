'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 画像のタブの［上書き保存］と［名前を付けて保存］（spec-7-1 確定事項B1〜B6）。jsdom には 2D コンテキストが無いので、描く部品
// （pageImage.renderToCanvas・toBytes）を差し替えて、確認の窓・imageAPI.write に届いた引数・保存の窓・通知バーを見る。描いた画素は
// 起動確認（smoke-image-edit.js）が見る。

const PNG = 'C:\\work\\shot.png';
const JPG = 'C:\\work\\photo.jpg';
const BMP = 'C:\\work\\scan.bmp';
const SIZE = { width: 300, height: 200 };

function imageSource(filePath, kind, { frames = [SIZE], mtimeMs = 1000 } = {}) {
  return { ...makeSource({ path: filePath, size: 789, mtimeMs }), image: { kind, frames } };
}

async function withImage(t, filePath, kind, options = {}) {
  const { frames = [SIZE], files = {}, ...rest } = options;
  const shell = await createShell({
    files: { [filePath]: imageSource(filePath, kind, { frames }), ...files },
    pdfjs: createPdfjsStub({ sizes: frames }),
    ...rest,
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(filePath);
  await shell.flush();
  return shell;
}

// 変更あり（右へ 90 度）にする。
function rotate(shell) {
  const { SigK } = shell;
  SigK.pageEdit.commit(SigK.pagePlan.editPages(SigK.viewer.getPlan(), new Map([[0, (entry) => ({ ...entry, rotate: 90 })]])));
}

// 描く部品の代わり。renderToCanvas に届いた引数を残し、toBytes は形式ごとに長さの違うバイト列を返す。
function stubImages(t, shell) {
  const images = shell.SigK.pageImage;
  const original = { renderToCanvas: images.renderToCanvas, toBytes: images.toBytes };
  const calls = [];
  images.renderToCanvas = async (_doc, _page, options) => {
    calls.push({ ...options, bytesType: null });
    return { canvas: { width: 300, height: 200, getContext: () => null }, width: 300, height: 200 };
  };
  images.toBytes = async (_canvas, { type, quality }) => {
    calls.at(-1).bytesType = type;
    calls.at(-1).quality = quality;
    return new Uint8Array(type === images.PNG ? 5 : 3).fill(1);
  };
  t.after(() => Object.assign(images, original));
  return calls;
}

const byId = (shell, id) => shell.document.getElementById(id);

test('PNG の上書き保存: 確認の窓を出し、了承すると同じ形式・倍率 1・背景を塗らずに描いて、控えと照合を付けて書く', async (t) => {
  const shell = await withImage(t, PNG, 'png');
  const calls = stubImages(t, shell);
  rotate(shell);
  const saving = shell.SigK.save.saveActive();
  await shell.flush();

  assert.equal(shell.SigK.confirmImageSave.isOpen(), true);
  assert.equal(byId(shell, 'confirm-image-save-text').textContent, '書き込みを「shot.png」の画像に焼き込んで、上書き保存します。');
  assert.equal(byId(shell, 'confirm-image-save-loss').textContent, '保存したあとは、書き込みを動かしたり直したりできません。書き込みの下にあった元の画像も元に戻せません。');
  assert.equal(byId(shell, 'confirm-image-save-backup').hidden, false);
  assert.equal(byId(shell, 'confirm-image-save-backup').textContent, '元の画像は、控えのファイル（shot.png.bak）に残します。');
  assert.equal(shell.document.activeElement?.id, 'confirm-image-save-cancel', '既定のフォーカスはキャンセル');
  assert.equal(byId(shell, 'confirm-image-save-ok').classList.contains('danger'), true);
  byId(shell, 'confirm-image-save-ok').click();
  const result = await saving;

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scale, 1);
  assert.equal(calls[0].rotation, 90);
  assert.equal(calls[0].background, 'rgba(0,0,0,0)', '透明を残す');
  assert.equal(calls[0].mosaic, undefined, 'モザイクは pdf.js の絵と比べずに overlay の中で塗る');
  assert.equal(typeof calls[0].overlay, 'function');
  assert.equal(calls[0].bytesType, 'image/png');
  assert.equal(shell.imageWrites.length, 1);
  assert.equal(shell.imageWrites[0].target, PNG);
  assert.equal(shell.imageWrites[0].bytes.length, 5);
  assert.deepEqual(shell.imageWrites[0].options, { makeBackup: true, expect: { size: 789, mtimeMs: 1000 } });
  assert.equal(shell.SigK.viewBanner.text(), '保存しました。');
  assert.equal(shell.SigK.viewer.isDirty(), false, '開き直して、変更なしに戻る');
  assert.equal(shell.SigK.viewer.getState().file.image.kind, 'png', '開き直しても画像のタブのまま');
});

test('キャンセルすると描かずに書かず、変更は残る', async (t) => {
  const shell = await withImage(t, PNG, 'png');
  const calls = stubImages(t, shell);
  rotate(shell);
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  byId(shell, 'confirm-image-save-cancel').click();
  assert.equal((await saving).canceled, true);
  assert.equal(calls.length, 0);
  assert.equal(shell.imageWrites.length, 0);
  assert.equal(shell.SigK.viewBanner.text(), '保存を取りやめました。');
  assert.equal(shell.SigK.viewer.isDirty(), true);
});

test('変更が無ければ、確認の窓も出さずに何もしない', async (t) => {
  const shell = await withImage(t, PNG, 'png');
  const result = await shell.SigK.save.saveActive();
  assert.equal(result.unchanged, true);
  assert.equal(shell.SigK.confirmImageSave.isOpen(), false);
  assert.equal(shell.imageWrites.length, 0);
});

test('JPEG は白を敷いて品質 0.95 で書く。控えを作らない設定なら、控えの文を出さず makeBackup も偽', async (t) => {
  const shell = await withImage(t, JPG, 'jpeg', { preferences: { makeBackup: false } });
  const calls = stubImages(t, shell);
  rotate(shell);
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  assert.equal(byId(shell, 'confirm-image-save-backup').hidden, true);
  byId(shell, 'confirm-image-save-ok').click();
  await saving;
  assert.equal(calls[0].background, '#ffffff');
  assert.equal(calls[0].bytesType, 'image/jpeg');
  assert.equal(calls[0].quality, 0.95);
  assert.equal(shell.imageWrites[0].options.makeBackup, false);
});

test('開いたあとでほかのアプリが書き換えていたら、上書きの確認を出し、了承すると照合を外して書き直す', async (t) => {
  const shell = await withImage(t, PNG, 'png', { imageWriteResults: [{ changed: true }] });
  stubImages(t, shell);
  rotate(shell);
  const saving = shell.SigK.save.saveActive();
  await shell.flush();
  byId(shell, 'confirm-image-save-ok').click();
  await shell.flush();
  assert.equal(shell.SigK.confirmOverwrite.isOpen(), true);
  assert.match(byId(shell, 'confirm-overwrite-text').textContent, /shot\.png は、開いたあとでほかのアプリで書き換えられているので/);
  byId(shell, 'confirm-overwrite-ok').click();
  const result = await saving;
  assert.equal(result.ok, true);
  assert.equal(shell.imageWrites.length, 2);
  assert.deepEqual(shell.imageWrites.map((write) => write.options.expect), [{ size: 789, mtimeMs: 1000 }, null]);
});

test('BMP の上書き保存は、PNG を既定にした名前を付けて保存の窓を出す（PNG・JPEG・PDF）', async (t) => {
  const shell = await withImage(t, BMP, 'bmp');
  rotate(shell);
  const result = await shell.SigK.save.saveActive();
  assert.equal(result.canceled, true, '窓を取り消した');
  assert.equal(shell.SigK.confirmImageSave.isOpen(), false);
  assert.equal(shell.savePathCalls.length, 1);
  assert.deepEqual(shell.savePathCalls[0].formats, ['png', 'jpeg', 'pdf']);
  assert.equal(shell.savePathCalls[0].defaultPath, 'C:\\work\\scan.png');
});

test('名前を付けて保存で別の PNG を選ぶと、確認の窓を出さずに控えも照合も無しで書き、タブはその画像へ移る', async (t) => {
  const OUT = 'C:\\work\\shot-2.png';
  const shell = await withImage(t, PNG, 'png', {
    savePathResults: [{ path: OUT, format: 'png' }],
    files: { [OUT]: imageSource(OUT, 'png') },
  });
  stubImages(t, shell);
  const result = await shell.SigK.save.saveAsActive();
  assert.equal(result.ok, true);
  assert.deepEqual(shell.savePathCalls[0].formats, ['png', 'jpeg', 'pdf']);
  assert.equal(shell.SigK.confirmImageSave.isOpen(), false);
  assert.deepEqual(shell.imageWrites.map((write) => [write.target, write.options]), [[OUT, { makeBackup: false, expect: null }]]);
  assert.deepEqual(structuredClone(shell.SigK.tabs.list().map((tab) => tab.path)), [OUT]);
});

test('名前を付けて保存で開いている画像そのものを選ぶと、上書き保存と同じく確認の窓と控えを出す', async (t) => {
  const shell = await withImage(t, JPG, 'jpeg', { savePathResults: [{ path: JPG, format: 'jpeg' }] });
  stubImages(t, shell);
  const saving = shell.SigK.save.saveAsActive();
  await shell.flush();
  assert.equal(shell.SigK.confirmImageSave.isOpen(), true);
  byId(shell, 'confirm-image-save-ok').click();
  await saving;
  assert.deepEqual(shell.imageWrites[0].options, { makeBackup: true, expect: { size: 789, mtimeMs: 1000 } });
});

test('名前を付けて保存で PDF を選ぶと、組み立てた PDF の写しから書き込みを注釈のまま保存する', async (t) => {
  const OUT = 'C:\\work\\shot.pdf';
  const shell = await withImage(t, PNG, 'png', {
    savePathResults: [{ path: OUT, format: 'pdf' }],
    taskResults: [{ ok: true, signature: { size: 2048, mtimeMs: 2000 } }],
    files: { [OUT]: makeSource({ path: OUT }) },
  });
  const result = await shell.SigK.save.saveAsActive();
  assert.equal(result.ok, true);
  assert.equal(shell.imageWrites.length, 0);
  const sent = shell.taskCalls.at(-1).spec;
  assert.equal(sent.kind, 'save');
  assert.equal(sent.target, OUT);
  assert.equal(sent.sourceCopy, 'image');
  assert.ok(sent.copies.image instanceof Uint8Array, '写しのバイト列を渡す');
  assert.equal(sent.makeBackup, false);
  assert.equal(shell.SigK.viewer.getState().file.image, undefined, 'PDF として開き直す');
});

test('ページが 2 枚ある画像（複数ページの TIFF）は、PDF だけを選べる保存の窓を出して知らせる', async (t) => {
  const TIF = 'C:\\work\\fax.tif';
  const shell = await withImage(t, TIF, 'tiff', { frames: [SIZE, SIZE] });
  rotate(shell);
  await shell.SigK.save.saveActive();
  assert.deepEqual(shell.savePathCalls[0].formats, ['pdf']);
  assert.equal(shell.savePathCalls[0].defaultPath, 'C:\\work\\fax.pdf');
  assert.equal(shell.SigK.viewBanner.text(), 'ページが 2 ページ以上あるので、PDF で保存します。');
});
