'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readClipboardImage, clipboardFor, createClipboardImageReader } = require('../clipboard-image.js');
const { runImageOpen } = require('../worker/image-open-task.js');
const { runTask } = require('../worker/pdf-task.js');
const { makePng } = require('./fixtures/images.js');

// クリップボードの画像を開く口（spec-7-8 確定事項NT6〜NT8・NT12）。クリップボードは clipboardLike の代わりを渡し、ユーザーの
// クリップボードを読まない（NT12）。ワーカーは、組み立てを確かめる試験だけ本物（runImageOpen）を回す。

// electron の NativeImage の代わり。bytes が空なら画像の無いクリップボード。
function clipboardWith(bytes) {
  return { readImage: () => ({ isEmpty: () => bytes.length === 0, toPNG: () => Buffer.from(bytes) }) };
}

const BUILT = { ok: true, bytes: new Uint8Array([0x25, 0x50]), kind: 'png', frames: [{ width: 4, height: 3 }] };

test('クリップボードの PNG をワーカーへバイト列で渡し、画像を開く口と同じ形（path・name・mtimeMs は null）で返す', async () => {
  const png = makePng({ width: 4, height: 3 });
  const specs = [];
  const result = await readClipboardImage({ clipboardLike: clipboardWith(png), run: async (spec) => { specs.push(spec); return BUILT; } });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].kind, 'image-open');
  assert.equal(specs[0].path, undefined, 'パスは渡さない');
  assert.ok(specs[0].bytes instanceof Uint8Array);
  assert.deepEqual([...specs[0].bytes], [...png]);
  assert.deepEqual(result, {
    ok: true, path: null, name: null, size: png.length, mtimeMs: null, bytes: BUILT.bytes,
    image: { kind: 'png', frames: [{ width: 4, height: 3 }] },
  });
});

test('クリップボードに画像が無ければ { empty: true } を返し、ワーカーを回さない（NT7）', async () => {
  let runs = 0;
  const run = async () => { runs += 1; return BUILT; };
  assert.deepEqual(await readClipboardImage({ clipboardLike: clipboardWith([]), run }), { empty: true });
  assert.deepEqual(await readClipboardImage({ clipboardLike: { readImage: () => null }, run }), { empty: true });
  assert.deepEqual(await readClipboardImage({ clipboardLike: { readImage: () => ({ isEmpty: () => false, toPNG: () => Buffer.alloc(0) }) }, run }), { empty: true });
  assert.equal(runs, 0);
});

test('大きすぎる画像・読めない・ワーカーが断った・ワーカーが落ちた、はそれぞれ理由を返す', async () => {
  const png = makePng({ width: 4, height: 3 });
  const errors = [];
  const onError = (entry) => errors.push(entry);
  assert.match((await readClipboardImage({ clipboardLike: clipboardWith(png), run: async () => BUILT, maxBytes: 10 })).error, /画像が大きすぎます/);
  const broken = { readImage: () => { throw new Error('busy'); } };
  assert.equal((await readClipboardImage({ clipboardLike: broken, run: async () => BUILT, onError })).error, 'クリップボードの画像を開けませんでした。');
  assert.equal((await readClipboardImage({ clipboardLike: clipboardWith(png), run: async () => ({ error: '壊れています。' }) })).error, '壊れています。');
  const crashed = await readClipboardImage({ clipboardLike: clipboardWith(png), run: async () => { throw new Error('worker'); }, onError });
  assert.equal(crashed.error, 'クリップボードの画像を開けませんでした。');
  assert.deepEqual(errors.map((entry) => [entry.message, entry.context.where]), [
    ['クリップボードの画像を読み込めませんでした', 'clipboard:readImage'], ['クリップボードの画像を開けませんでした', 'clipboard:readImage'],
  ]);
});

test('createClipboardImageReader の read は、渡したクリップボードとワーカーで読む', async () => {
  const reader = createClipboardImageReader({ clipboardLike: clipboardWith(makePng()), run: async () => BUILT });
  assert.equal((await reader.read()).ok, true);
});

test('ワーカーはバイト列の画像も PDF に組み立てる。ファイルが無いので読む前の印を添えない（spec.bytes）', async () => {
  const built = await runImageOpen({ bytes: new Uint8Array(makePng({ width: 30, height: 20 })) });
  assert.equal(built.ok, true);
  assert.equal(built.kind, 'png');
  assert.deepEqual(built.frames, [{ width: 30, height: 20 }]);
  assert.equal('signature' in built, false);
  assert.equal('original' in built, false);
  assert.equal((await runImageOpen({ bytes: new Uint8Array(0) })).error, '開く画像が指定されていません。');
  assert.equal(typeof (await runImageOpen({ bytes: new Uint8Array([1, 2, 3]) })).error, 'string', '画像でないものは断る');
  const viaTask = await runTask({ kind: 'image-open', bytes: new Uint8Array(makePng()) });
  assert.equal(viaTask.ok, true, 'ワーカーの入口も振り分ける');
});

test('ワーカーが組み立てた本物の PDF を、そのまま返す（ワーカーの入口から通す）', async () => {
  const png = makePng({ width: 6, height: 5 });
  const result = await readClipboardImage({ clipboardLike: clipboardWith(png), run: (spec) => runTask(spec) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.image, { kind: 'png', frames: [{ width: 6, height: 5 }] });
  assert.equal(Buffer.from(result.bytes.subarray(0, 5)).toString('latin1'), '%PDF-');
});

// 起動確認（NT12）。SIGK_SMOKE=1 で SIGK_SMOKE_CLIPBOARD を付けたときだけ、ユーザーのクリップボードの代わりを使う。
test('clipboardFor は起動確認の時だけ、SIGK_SMOKE_CLIPBOARD の画像（PNG のパスか empty）をクリップボードの代わりにする', (t) => {
  const real = { readImage: () => 'real' };
  assert.equal(clipboardFor({}, real), real);
  assert.equal(clipboardFor({ SIGK_SMOKE_CLIPBOARD: 'empty' }, real), real, 'SIGK_SMOKE=1 でなければ使わない');
  assert.equal(clipboardFor({ SIGK_SMOKE: '1' }, real), real);
  assert.equal(clipboardFor({ SIGK_SMOKE: '1', SIGK_SMOKE_CLIPBOARD: '' }, real), real);

  assert.equal(clipboardFor({ SIGK_SMOKE: '1', SIGK_SMOKE_CLIPBOARD: 'empty' }, real).readImage().isEmpty(), true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-clipboard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'shot.png');
  const png = makePng({ width: 4, height: 3 });
  fs.writeFileSync(file, png);
  const image = clipboardFor({ SIGK_SMOKE: '1', SIGK_SMOKE_CLIPBOARD: file }, real).readImage();
  assert.equal(image.isEmpty(), false);
  assert.deepEqual([...image.toPNG()], [...png]);
});
