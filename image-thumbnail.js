'use strict';

// 画像→PDF の「変換する画像」の帯のサムネイル（spec-2-5 確定事項H5）。
//
// レンダラーは sandbox: true でファイルに触れないので、メインが Electron の nativeImage.createThumbnailFromPath（Windows の
// エクスプローラーと同じ縮小。TIFF・BMP・GIF も出る）で作り、data URL で返す。受けるのは画像の拡張子の絶対パスだけ（画面から
// ほかのファイルを読ませない）。大きさは画像の上限（image-io.js の MAX_IMAGE_BYTES）まで。作れない形式もあるので、作れなかった
// ことは記録に書かない（画面は形式の名前を書いた紙にする）。
//   成功 { ok: true, url, width, height } / 失敗 { error }

const fs = require('node:fs');
const path = require('node:path');

const { MAX_IMAGE_BYTES } = require('./image-io.js');

// 帯の画像の枠は 96px 四方。画素比 2 まで細かく作る。
const THUMB_PX = 192;
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tif', '.tiff']);
const FAILED = 'サムネイルを作れませんでした。';

// テストは ubuntu でも回るので、Windows のパスも絶対パスとして読む。
function isThumbnailPath(filePath) {
  if (typeof filePath !== 'string' || filePath === '')
    return false;
  const absolute = path.isAbsolute(filePath) || path.win32.isAbsolute(filePath);
  return absolute && EXTENSIONS.has(path.win32.extname(filePath).toLowerCase());
}

async function createThumbnail(filePath, { nativeImageLike, fsLike = fs, maxBytes = MAX_IMAGE_BYTES, size = THUMB_PX }) {
  if (!isThumbnailPath(filePath))
    return { error: '画像のパスではありません。' };
  try {
    const stat = await fsLike.promises.stat(filePath);
    if (!stat.isFile() || stat.size > maxBytes)
      return { error: FAILED };
    const image = await nativeImageLike.createThumbnailFromPath(filePath, { width: size, height: size });
    if (image.isEmpty())
      return { error: FAILED };
    const { width, height } = image.getSize();
    return { ok: true, url: image.toDataURL(), width, height };
  } catch {
    return { error: FAILED };
  }
}

module.exports = { THUMB_PX, isThumbnailPath, createThumbnail };
