'use strict';

// クリップボードの画像を開く口（spec-7-8 確定事項NT6〜NT8・NT12）。空のタブで Ctrl+V を押したときに、画面が clipboard:readImage で呼ぶ。
//
// clipboard.readImage() の画像を PNG のバイト列にし、画像を開く口（image-open.js）と同じく、ワーカー（worker/image-open-task.js）で
// 1 画素＝1pt の PDF に組み立てる。戻り値も image-open.js と同じ形 { ok, path, name, size, mtimeMs, bytes, image } で、ファイルが無いので
// path・name・mtimeMs は null（タブ名「新しい画像 N」は画面が付ける。new-tab.js）。画像が無ければ { empty: true }、大きすぎる・
// 組み立てられなければ { error }。
//
// クリップボードとワーカーを回す関数は引数で受け取る（main.js が electron の clipboard と taskRunner.run を渡す）。node --test から
// electron 抜きで読めるようにするためと、試験と起動確認でユーザーのクリップボードを読まないため（NT12。clipboardFor）。

const fs = require('node:fs');
const path = require('node:path');

const { MAX_IMAGE_BYTES } = require('./image-open.js');

const FAILED = 'クリップボードの画像を開けませんでした。';

// clipboardLike.readImage() の画像を PNG のバイト列にする。画像が無ければ null。
function readPng(clipboardLike) {
  const image = clipboardLike.readImage();
  if (image === null || image === undefined || image.isEmpty())
    return null;
  const png = image.toPNG();
  if (png === null || png === undefined || png.length === 0)
    return null;
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

function report(onError, message, error) {
  onError({ message, stack: error?.stack, context: { where: 'clipboard:readImage' } });
}

async function readClipboardImage({ clipboardLike, run, maxBytes = MAX_IMAGE_BYTES, onError = () => {} }) {
  let png;
  try {
    png = readPng(clipboardLike);
  } catch (error) {
    report(onError, 'クリップボードの画像を読み込めませんでした', error);
    return { error: FAILED };
  }
  if (png === null)
    return { empty: true };
  if (png.length > maxBytes)
    return { error: `${Math.floor(maxBytes / 1024 / 1024)}MB までに対応していますが、画像が大きすぎます。` };

  let result;
  try {
    result = await run({ kind: 'image-open', bytes: png });
  } catch (error) {
    report(onError, 'クリップボードの画像を開けませんでした', error);
    return { error: FAILED };
  }
  if (result?.ok !== true || !(result.bytes instanceof Uint8Array))
    return { error: result?.error ?? FAILED };

  return {
    ok: true,
    path: null,
    name: null,
    // 大きさは PNG のバイト数（状態の欄に表示する。保存するまでファイルは無い）。
    size: png.length,
    mtimeMs: null,
    bytes: result.bytes,
    image: {
      kind: result.kind,
      frames: result.frames,
      ...(result.original instanceof Uint8Array ? { original: result.original } : {}),
    },
  };
}

// 起動確認のクリップボード（NT12）。SIGK_SMOKE=1 で SIGK_SMOKE_CLIPBOARD があれば、ユーザーのクリップボードを読まずに、値が empty なら
// 画像の無いクリップボード、それ以外はそのパスの画像ファイルを画像として持つクリップボードを返す。無ければ clipboard（electron のもの）。
function clipboardFor(env, clipboard, { fsLike = fs } = {}) {
  const value = env?.SIGK_SMOKE === '1' ? env.SIGK_SMOKE_CLIPBOARD : undefined;
  if (typeof value !== 'string' || value === '')
    return clipboard;
  if (value === 'empty')
    return { readImage: () => ({ isEmpty: () => true, toPNG: () => new Uint8Array(0) }) };
  const file = path.resolve(value);
  return {
    readImage: () => {
      const bytes = fsLike.readFileSync(file);
      return { isEmpty: () => bytes.length === 0, toPNG: () => bytes };
    },
  };
}

// run(spec) は spec をワーカーで回して結果を返す関数。
function createClipboardImageReader({ clipboardLike, run, onError = () => {} }) {
  return {
    read: () => readClipboardImage({ clipboardLike, run, onError }),
  };
}

module.exports = { readClipboardImage, clipboardFor, createClipboardImageReader };
