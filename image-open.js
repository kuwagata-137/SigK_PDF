'use strict';

// 画像を開く口（spec-7-1 確定事項A4）。メインの「パスで読む口」（pdf:read）と「開く窓」（pdf:open）が、拡張子が画像のときに通す。
//
// 画面（pdf.js）が開けるのは PDF だけなので、ワーカー（worker/image-open-task.js）に 1 画素＝1pt の PDF を組み立てさせ、PDF を読んだときと
// 同じ形 { ok, path, name, size, mtimeMs, bytes } に image: { kind, frames, original? } を添えて返す。こうすると、画面の開く経路
// （Ctrl+O・ドロップ・最近使ったファイル・起動の引数・保存のあとの開き直し）を分けずに画像を通せる。
//
// ワーカーを回す関数は引数で受け取る（main.js が taskRunner.run を渡す）。node --test から electron 抜きで読めるようにするためである。
// 断るときの形も file-io.js の readPdf と同じ { error, code }（code は、最近使ったファイルから消すかを画面が見分けるのに使う）。

const fs = require('node:fs');
const path = require('node:path');

const { describeReadFailure, isImagePath } = require('./file-io.js');

// 画像ファイルの上限（image-io.js の MAX_IMAGE_BYTES と同じ。ワーカーも同じ値で断る）。
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

async function readImageDocument(filePath, { run, fsLike = fs, maxBytes = MAX_IMAGE_BYTES, onError = () => {} }) {
  if (!isImagePath(filePath))
    return { error: '画像ファイルではありません。' };
  try {
    const stat = await fsLike.promises.stat(filePath);
    if (!stat.isFile())
      return { error: 'ファイルではありません。' };
    if (stat.size > maxBytes)
      return { error: `${Math.floor(maxBytes / 1024 / 1024)}MB までに対応していますが、画像が大きすぎます。` };
  } catch (error) {
    return { error: describeReadFailure(error), code: error?.code ?? null };
  }

  let result;
  try {
    result = await run({ kind: 'image-open', path: filePath });
  } catch (error) {
    onError({ message: '画像を開けませんでした', stack: error?.stack, context: { path: filePath } });
    return { error: '画像を開けませんでした。' };
  }
  if (result?.ok !== true || !(result.bytes instanceof Uint8Array))
    return { error: result?.error ?? '画像を開けませんでした。' };

  return {
    ok: true,
    path: filePath,
    name: path.basename(filePath),
    // 大きさと更新時刻は、ワーカーが読む前に取った印（上書き保存のときに照らす。spec-7-1 確定事項B1）。
    size: result.signature?.size ?? result.bytes.length,
    mtimeMs: result.signature?.mtimeMs ?? null,
    bytes: result.bytes,
    image: {
      kind: result.kind,
      frames: result.frames,
      ...(result.original instanceof Uint8Array ? { original: result.original } : {}),
    },
  };
}

// run(spec) は spec をワーカーで回して結果を返す関数。
function createImageOpener({ run, onError = () => {} }) {
  return {
    read: (filePath) => readImageDocument(filePath, { run, onError }),
  };
}

module.exports = { MAX_IMAGE_BYTES, readImageDocument, createImageOpener };
