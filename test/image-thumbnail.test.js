'use strict';

// 「変換する画像」の帯のサムネイルを作るメイン側の口（spec-2-5 確定事項H5）。Electron の nativeImage は偽物を渡す。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { THUMB_PX, MAX_THUMB_PX, thumbSize, isThumbnailPath, createThumbnail } = require('../image-thumbnail.js');

const PNG = path.join(__dirname, 'fixtures', 'image-small.png');

function fakeNativeImage({ empty = false, size = { width: 192, height: 128 }, fail = null } = {}) {
  const calls = [];
  return {
    calls,
    createThumbnailFromPath: async (filePath, wanted) => {
      calls.push({ filePath, wanted });
      if (fail !== null)
        throw fail;
      return { isEmpty: () => empty, getSize: () => size, toDataURL: () => 'data:image/png;base64,AAAA' };
    },
  };
}

test('受けるのは画像の拡張子の絶対パスだけ（Windows のパスも）', () => {
  assert.equal(isThumbnailPath(PNG), true);
  assert.equal(isThumbnailPath(String.raw`C:\photo\IMG_2401.JPG`), true);
  assert.equal(isThumbnailPath(String.raw`C:\photo\a.tiff`), true);
  assert.equal(isThumbnailPath(String.raw`C:\work\a.pdf`), false);
  assert.equal(isThumbnailPath('a.png'), false, '相対パス');
  assert.equal(isThumbnailPath(null), false);
});

test('画像の縮小を data URL で返す。頼む大きさは 208px 四方（枠の幅 104px の 2 倍）', async () => {
  const nativeImageLike = fakeNativeImage();
  assert.deepEqual(await createThumbnail(PNG, { nativeImageLike }), { ok: true, url: 'data:image/png;base64,AAAA', width: 192, height: 128 });
  assert.deepEqual(nativeImageLike.calls, [{ filePath: PNG, wanted: { width: THUMB_PX, height: THUMB_PX } }]);
  assert.equal(THUMB_PX, 208);
});

// ツールモードの紙の倍率（50〜300%。docs/07 決定83）で枠が大きくなるので、画面は大きい縮小を頼める。画面から届いた値は 208px 刻み・
// 上限 624px（300%・画素比 2）に収める。数でないもの・208 以下は 208。
test('頼まれた大きさは 208px 刻みに切り上げ、624px で止める', async () => {
  assert.equal(MAX_THUMB_PX, 624);
  assert.deepEqual([undefined, null, 'abc', -1, 100, 208, 209, 416, 500, 624, 1000, Infinity].map(thumbSize),
    [208, 208, 208, 208, 208, 208, 416, 416, 624, 624, 624, 208]);
  const nativeImageLike = fakeNativeImage();
  await createThumbnail(PNG, { nativeImageLike, size: thumbSize(416) });
  assert.deepEqual(nativeImageLike.calls, [{ filePath: PNG, wanted: { width: 416, height: 416 } }]);
});

test('画像でないパス・大きすぎるファイルは、作らずに断る', async () => {
  const nativeImageLike = fakeNativeImage();
  assert.deepEqual(await createThumbnail('a.png', { nativeImageLike }), { error: '画像のパスではありません。' });
  assert.deepEqual(await createThumbnail(PNG, { nativeImageLike, maxBytes: 10 }), { error: 'サムネイルを作れませんでした。' });
  assert.equal(nativeImageLike.calls.length, 0);
});

test('作れなかった（空の画像・例外・無いファイル）ときは誤りを返す（画面は形式の名前を書いた紙にする）', async () => {
  assert.deepEqual(await createThumbnail(PNG, { nativeImageLike: fakeNativeImage({ empty: true }) }), { error: 'サムネイルを作れませんでした。' });
  assert.deepEqual(await createThumbnail(PNG, { nativeImageLike: fakeNativeImage({ fail: new Error('no handler') }) }), { error: 'サムネイルを作れませんでした。' });
  const missing = path.join(__dirname, 'fixtures', 'no-such-image.png');
  assert.deepEqual(await createThumbnail(missing, { nativeImageLike: fakeNativeImage() }), { error: 'サムネイルを作れませんでした。' });
});
