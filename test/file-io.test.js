'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_PDF_BYTES,
  isPdfPath,
  describeReadFailure,
  withPdfExtension,
  readPdf,
  pickPdf,
  pickSavePath,
  createFileIo,
} = require('../file-io.js');
const { fixturePath } = require('./fixtures/build.js');

const THREE_PAGES = fixturePath('three-pages.pdf');

test('isPdfPath は拡張子だけを見る', () => {
  assert.equal(isPdfPath('C:\\x\\a.pdf'), true);
  assert.equal(isPdfPath('C:\\x\\a.PDF'), true);
  assert.equal(isPdfPath('C:\\x\\a.pdf.txt'), false);
  assert.equal(isPdfPath('C:\\x\\a'), false);
  assert.equal(isPdfPath(null), false);
  assert.equal(isPdfPath(42), false);
});

test('readPdf は中身とファイル名とサイズを返す', async () => {
  const result = await readPdf(THREE_PAGES);
  const actual = fs.statSync(THREE_PAGES).size;

  assert.equal(result.ok, true);
  assert.equal(result.name, 'three-pages.pdf');
  assert.equal(result.path, THREE_PAGES);
  assert.equal(result.size, actual);
  assert.equal(result.bytes.byteLength, actual);
  assert.ok(result.bytes instanceof Uint8Array);
  // 先頭は必ず PDF の署名である。
  assert.equal(Buffer.from(result.bytes.slice(0, 5)).toString('latin1'), '%PDF-');
});

test('readPdf は PDF でないものを読まない', async () => {
  const result = await readPdf(path.join(__dirname, 'harness.js'));

  assert.equal(result.ok, undefined);
  assert.match(result.error, /PDF ファイルではありません/);
});

test('readPdf は無いファイルで例外を投げず error を返す', async () => {
  const logged = [];
  const result = await readPdf(path.join(__dirname, 'fixtures', 'そんなファイルはない.pdf'), {
    onError: (entry) => logged.push(entry),
  });

  assert.match(result.error, /見つかりません/);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].context.code, 'ENOENT');
});

// 黙って数十秒固まるより、理由を出して断る（spec-1-1 確定事項14）。
test('readPdf は上限を超えるファイルを読まない', async () => {
  const result = await readPdf(THREE_PAGES, { maxBytes: 10 });

  assert.match(result.error, /大きすぎます/);
  assert.equal(MAX_PDF_BYTES, 200 * 1024 * 1024);
});

test('readPdf はフォルダーを断る', async () => {
  const dir = path.join(__dirname, 'fixtures');
  // 拡張子だけ .pdf のフォルダーを作って確かめる。
  const fake = path.join(dir, 'folder.pdf');
  fs.mkdirSync(fake, { recursive: true });
  try {
    const result = await readPdf(fake);
    assert.ok(result.error, 'フォルダーを読んではいけない');
  } finally {
    fs.rmSync(fake, { recursive: true, force: true });
  }
});

test('describeReadFailure はよくある失敗を日本語にする', () => {
  assert.match(describeReadFailure({ code: 'EACCES' }), /権限/);
  assert.match(describeReadFailure({ code: 'EBUSY' }), /使われています/);
  assert.match(describeReadFailure({ code: 'なんだこれ' }), /読めませんでした/);
});

test('pickPdf は取り消しを canceled として返す', async () => {
  const dialogLike = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };

  assert.deepEqual(await pickPdf({ dialogLike }), { canceled: true });
});

test('pickPdf は空の選択も取り消しとして扱う', async () => {
  const dialogLike = { showOpenDialog: async () => ({ canceled: false, filePaths: [] }) };

  assert.deepEqual(await pickPdf({ dialogLike }), { canceled: true });
});

// showOpenDialog(options) と showOpenDialog(window, options) は別の呼び出しである。
// 親が無いのに undefined を渡すと options を親と解釈されてしまう。
test('pickPdf は親ウィンドウの有無で引数の形を変える', async () => {
  const calls = [];
  const dialogLike = {
    showOpenDialog: async (...args) => {
      calls.push(args);
      return { canceled: true, filePaths: [] };
    },
  };

  await pickPdf({ dialogLike });
  await pickPdf({ dialogLike, parentWindow: { id: 1 } });

  assert.equal(calls[0].length, 1);
  assert.equal(calls[0][0].properties[0], 'openFile');
  assert.equal(calls[1].length, 2);
  assert.deepEqual(calls[1][0], { id: 1 });
});

test('createFileIo の open は選ばれたファイルをそのまま読む', async () => {
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [THREE_PAGES] }) };
  const fileIo = createFileIo({ dialog });

  const result = await fileIo.open();

  assert.equal(result.ok, true);
  assert.equal(result.name, 'three-pages.pdf');
});

test('createFileIo の open は取り消しをそのまま返す', async () => {
  const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };

  assert.deepEqual(await createFileIo({ dialog }).open(), { canceled: true });
});

// ---- 保存先を選ばせる（spec-1-6 確定事項25・49） ----
//
// パスの区切りは / で書く。path.extname はどちらでも同じに働き、
// テストの中で \ を重ねる必要がなくなる。

test('拡張子が無ければ .pdf を足す', () => {
  assert.equal(withPdfExtension('C:/x/a'), 'C:/x/a.pdf');
  assert.equal(withPdfExtension('C:/x/a.pdf'), 'C:/x/a.pdf');
  assert.equal(withPdfExtension('C:/x/a.PDF'), 'C:/x/a.PDF', '大文字でも二重に足さない');
  assert.equal(withPdfExtension('C:/x/a.txt'), 'C:/x/a.txt.pdf');
});

test('pickSavePath は選ばれたパスを返す', async () => {
  const calls = [];
  const dialogLike = {
    showSaveDialog: async (options) => { calls.push(options); return { canceled: false, filePath: 'C:/out/b' }; },
  };

  const result = await pickSavePath({ dialogLike, defaultPath: 'C:/out/a.pdf' });
  assert.deepEqual(result, { path: 'C:/out/b.pdf' }, '拡張子を補って返す');
  assert.equal(calls[0].defaultPath, 'C:/out/a.pdf');
  // 同名の確認は OS のダイアログに委ねる（確定事項22）。
  assert.ok(calls[0].properties.includes('showOverwriteConfirmation'));
});

test('pickSavePath を取り消せる', async () => {
  const dialogLike = { showSaveDialog: async () => ({ canceled: true }) };
  assert.deepEqual(await pickSavePath({ dialogLike }), { canceled: true });
});

test('pickSavePath はパスが空でも取り消し扱いにする', async () => {
  const dialogLike = { showSaveDialog: async () => ({ canceled: false, filePath: '' }) };
  assert.deepEqual(await pickSavePath({ dialogLike }), { canceled: true });
});

test('親ウィンドウの有無で showSaveDialog の呼び分けを変える', async () => {
  const seen = [];
  const dialogLike = {
    showSaveDialog: async (...args) => { seen.push(args.length); return { canceled: true }; },
  };

  await pickSavePath({ dialogLike });
  await pickSavePath({ dialogLike, parentWindow: { fake: true } });
  // 親が無いのに undefined を渡すと、options を親として解釈されてしまう。
  assert.deepEqual(seen, [1, 2]);
});

test('createFileIo は保存ダイアログも出せる', async () => {
  const io = createFileIo({
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: 'C:/out/c.pdf' }) },
  });
  assert.deepEqual(await io.pickSavePath(null, { defaultPath: 'C:/out/c.pdf' }), { path: 'C:/out/c.pdf' });
});
