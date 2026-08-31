'use strict';

// PDF をディスクから読む経路。レンダラーは sandbox: true でファイルに触れないため、
// 読み込みはすべてここを通る（docs/02 第6章）。
//
// Electron の dialog は引数で受け取る。このファイルが electron を require すると
// node --test から読めなくなるためで、security-policy.js と同じ作法である。
//
// 戻り値の形は docs/02 第5章に揃える。
//   成功     { ok: true, path, name, size, bytes }
//   取り消し { canceled: true }
//   失敗     { error: '人が読める文言' }
// レンダラー側で例外を投げない。

const fs = require('node:fs');
const path = require('node:path');

// docs/01 第2章の想定上限。超えるものは読まずに断る（spec-1-1 確定事項14）。
// 黙って数十秒固まるより、理由を出して断るほうがよい。
const MAX_PDF_BYTES = 200 * 1024 * 1024;

const PDF_FILTERS = [{ name: 'PDF ファイル', extensions: ['pdf'] }];

function isPdfPath(filePath) {
  return typeof filePath === 'string' && path.extname(filePath).toLowerCase() === '.pdf';
}

function describeReadFailure(error) {
  switch (error?.code) {
    case 'ENOENT':
      return 'ファイルが見つかりません。';
    case 'EACCES':
    case 'EPERM':
      return 'ファイルを読む権限がありません。';
    case 'EBUSY':
      return 'ファイルが他のプログラムで使われています。';
    case 'EISDIR':
      return 'フォルダーは開けません。';
    default:
      return 'ファイルを読めませんでした。';
  }
}

// Buffer は小さいときプールを共有する。そのまま view を作ると隣の内容まで
// 見せかねないので、専有しているときだけ複製を省く。
function toBytes(buffer) {
  if (buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength)
    return new Uint8Array(buffer.buffer);
  return new Uint8Array(buffer);
}

async function readPdf(filePath, { fsLike = fs, maxBytes = MAX_PDF_BYTES, onError = () => {} } = {}) {
  if (!isPdfPath(filePath))
    return { error: 'PDF ファイルではありません。' };

  try {
    const stat = await fsLike.promises.stat(filePath);
    if (!stat.isFile())
      return { error: 'ファイルではありません。' };
    if (stat.size > maxBytes)
      return { error: `ファイルが大きすぎます。${Math.floor(maxBytes / 1024 / 1024)}MB までに対応しています。` };

    const buffer = await fsLike.promises.readFile(filePath);
    return { ok: true, path: filePath, name: path.basename(filePath), size: stat.size, bytes: toBytes(buffer) };
  } catch (error) {
    onError({ message: 'PDF を読めませんでした', stack: error?.stack, context: { path: filePath, code: error?.code } });
    return { error: describeReadFailure(error) };
  }
}

async function pickPdf({ dialogLike, parentWindow = null, defaultPath = undefined }) {
  const options = {
    title: 'PDF を開く',
    properties: ['openFile'],
    filters: PDF_FILTERS,
    defaultPath,
  };
  // showOpenDialog(options) と showOpenDialog(window, options) は別の呼び出しである。
  // 親が無いのに undefined を渡すと、options を親として解釈されてしまう。
  const result = parentWindow === null
    ? await dialogLike.showOpenDialog(options)
    : await dialogLike.showOpenDialog(parentWindow, options);

  if (result?.canceled === true || !Array.isArray(result?.filePaths) || result.filePaths.length === 0)
    return { canceled: true };
  return { path: result.filePaths[0] };
}

function createFileIo({ dialog, onError = () => {} }) {
  return {
    MAX_PDF_BYTES,
    read: (filePath) => readPdf(filePath, { onError }),
    async open(parentWindow = null) {
      const picked = await pickPdf({ dialogLike: dialog, parentWindow });
      if (picked.canceled === true)
        return picked;
      return readPdf(picked.path, { onError });
    },
  };
}

module.exports = { MAX_PDF_BYTES, PDF_FILTERS, isPdfPath, describeReadFailure, toBytes, readPdf, pickPdf, createFileIo };
