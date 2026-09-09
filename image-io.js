'use strict';

// 画像を覗く・選ぶ経路（spec-3-1 確定事項2・4）。レンダラーは sandbox: true でファイルに
// 触れないため、変換画面が要る「画素数と形式」はここが先頭バイトを読んで返す。
//
// file-io.js の readPdf は `.pdf` 以外を断るうえ、全体を読んでしまう。画面に要るのは
// 寸法だけで、本体はワーカーが改めて読む（worker/op-convert.js）。だから先頭 64KB だけを
// 読み、寸法が見つからなければ全体を読み直す（事前調査 C）。
//
// Electron の dialog は引数で受け取る（file-io.js と同じ作法。node --test から読める）。
// 戻り値の形も file-io.js に揃える。
//   成功     { ok: true, path, name, size, kind, width, height }
//   取り消し { canceled: true }
//   失敗     { error: '人が読める文言' }

const fs = require('node:fs');
const path = require('node:path');

const { inspectImageBytes } = require('./worker/image-format.js');
const { toBytes, describeReadFailure } = require('./file-io.js');

// 画像ファイルの上限（確定事項4）。PDF の 200MB より小さくてよい。
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

// 先頭だけ読む量。PNG の IHDR は 24 バイト、JPEG の SOF は EXIF のサムネイルの後ろでも
// たいてい 64KB に収まる。
const HEAD_BYTES = 64 * 1024;

// **このフィルターは目安でしかない。**受け付けるかどうかは先頭バイトで判定する。
const IMAGE_FILTERS = [{ name: '画像ファイル', extensions: ['png', 'jpg', 'jpeg'] }];

async function readHead(filePath, size, fsLike) {
  const length = Math.min(size, HEAD_BYTES);
  const handle = await fsLike.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return toBytes(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function inspectImage(filePath, { fsLike = fs, maxBytes = MAX_IMAGE_BYTES, onError = () => {} } = {}) {
  if (typeof filePath !== 'string' || filePath === '')
    return { error: 'ファイルが指定されていません。' };
  try {
    const stat = await fsLike.promises.stat(filePath);
    if (!stat.isFile())
      return { error: 'ファイルではありません。' };
    if (stat.size > maxBytes)
      return { error: `ファイルが大きすぎます。${Math.floor(maxBytes / 1024 / 1024)}MB までに対応しています。` };

    let inspected = inspectImageBytes(await readHead(filePath, stat.size, fsLike));
    // 先頭だけでは寸法に届かなかった（SOF が 64KB より後ろ）。全体を読み直す。
    if (inspected.incomplete === true && stat.size > HEAD_BYTES)
      inspected = inspectImageBytes(toBytes(await fsLike.promises.readFile(filePath)));
    if (inspected.ok !== true)
      return { error: inspected.error, kind: inspected.kind ?? null };

    return {
      ok: true,
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      kind: inspected.kind,
      width: inspected.width,
      height: inspected.height,
    };
  } catch (error) {
    onError({ message: '画像を読めませんでした', stack: error?.stack, context: { path: filePath, code: error?.code } });
    return { error: describeReadFailure(error) };
  }
}

// 変換する画像をまとめて選ばせる。選んだ順が戻り値の順である。
async function pickImageSources({ dialogLike, parentWindow = null, defaultPath = undefined }) {
  const options = {
    title: '変換する画像を選ぶ',
    properties: ['openFile', 'multiSelections'],
    filters: IMAGE_FILTERS,
    defaultPath,
  };
  // showOpenDialog(options) と showOpenDialog(window, options) は別の呼び出しである
  // （file-io.js と同じ事情）。親が無いのに undefined を渡さない。
  const result = parentWindow === null
    ? await dialogLike.showOpenDialog(options)
    : await dialogLike.showOpenDialog(parentWindow, options);

  if (result?.canceled === true || !Array.isArray(result?.filePaths) || result.filePaths.length === 0)
    return { canceled: true };
  return { paths: result.filePaths.filter((entry) => typeof entry === 'string' && entry.length > 0) };
}

function createImageIo({ dialog, onError = () => {} }) {
  return {
    MAX_IMAGE_BYTES,
    inspect: (filePath) => inspectImage(filePath, { onError }),
    pickSources: (parentWindow = null, { defaultPath } = {}) =>
      pickImageSources({ dialogLike: dialog, parentWindow, defaultPath }),
  };
}

module.exports = { MAX_IMAGE_BYTES, HEAD_BYTES, IMAGE_FILTERS, inspectImage, pickImageSources, createImageIo };
