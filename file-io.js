'use strict';

// PDF をディスクから読む経路。レンダラーは sandbox: true でファイルに触れないため、
// 読み込みはすべてここを通る（docs/02 第6章）。
//
// Electron の dialog は引数で受け取る。このファイルが electron を require すると
// node --test から読めなくなるためで、security-policy.js と同じ作法である。
//
// 戻り値の形は docs/02 第5章に揃える。
//   成功     { ok: true, path, name, size, mtimeMs, bytes }
//   取り消し { canceled: true }
//   失敗     { error: '人が読める文言' }
// レンダラー側で例外を投げない。

const fs = require('node:fs');
const path = require('node:path');

// docs/01 第2章の想定上限。超えるものは読まずに断る（spec-1-1 確定事項14）。
// 黙って数十秒固まるより、理由を出して断るほうがよい。
const MAX_PDF_BYTES = 200 * 1024 * 1024;

const PDF_FILTERS = [{ name: 'PDF ファイル', extensions: ['pdf'] }];

// 差し込めるもの（spec-1-6 確定事項53）。**このフィルターは目安でしかない。**
// 実際に受け付けるかどうかはワーカーが先頭バイトで判定し、既定拒否にする
// （拡張子は中身と食い違うことがある）。
const INSERT_FILTERS = [
  { name: '差し込めるファイル', extensions: ['pdf', 'png', 'jpg', 'jpeg'] },
  { name: 'PDF ファイル', extensions: ['pdf'] },
  { name: '画像ファイル', extensions: ['png', 'jpg', 'jpeg'] },
];

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
    // mtimeMs は、保存の直前に「開いたあとで外から書き換えられていないか」を
    // 見るのに使う（spec-1-6 確定事項21）。stat はもう取っているので只である。
    return {
      ok: true,
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
      bytes: toBytes(buffer),
    };
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

// 差し込む1ファイルを選ばせる（確定事項53）。pickPdf と同じ作法で、
// 親の有無で呼び分ける。
async function pickInsertSource({ dialogLike, parentWindow = null, defaultPath = undefined }) {
  const options = {
    title: '差し込むファイルを選ぶ',
    properties: ['openFile'],
    filters: INSERT_FILTERS,
    defaultPath,
  };
  const result = parentWindow === null
    ? await dialogLike.showOpenDialog(options)
    : await dialogLike.showOpenDialog(parentWindow, options);

  if (result?.canceled === true || !Array.isArray(result?.filePaths) || result.filePaths.length === 0)
    return { canceled: true };
  return { path: result.filePaths[0] };
}

// 結合する PDF をまとめて選ばせる（spec-2-1 確定事項9）。pickPdf は1本しか
// 返さないので、複数選択の口を別に持つ。選んだ順が戻り値の順である。
async function pickMergeSources({ dialogLike, parentWindow = null, defaultPath = undefined }) {
  const options = {
    title: '結合する PDF を選ぶ',
    properties: ['openFile', 'multiSelections'],
    filters: PDF_FILTERS,
    defaultPath,
  };
  const result = parentWindow === null
    ? await dialogLike.showOpenDialog(options)
    : await dialogLike.showOpenDialog(parentWindow, options);

  if (result?.canceled === true || !Array.isArray(result?.filePaths) || result.filePaths.length === 0)
    return { canceled: true };
  return { paths: result.filePaths.filter((entry) => typeof entry === 'string' && entry.length > 0) };
}

// 出力先に同名があるか（spec-2-1 確定事項28）。3択を出すかどうかを
// レンダラーが実行前に決めるための口で、ワーカーの write は黙って置き換える。
async function exists(filePath, { fsLike = fs } = {}) {
  if (typeof filePath !== 'string' || filePath.length === 0)
    return { ok: true, exists: false };
  try {
    await fsLike.promises.access(filePath);
    return { ok: true, exists: true };
  } catch {
    return { ok: true, exists: false };
  }
}

// 拡張子を落として保存しようとすることがある。フィルターがあれば OS が足すが、
// 環境によっては足さないので、こちらでも揃えておく。
function withPdfExtension(filePath) {
  return isPdfPath(filePath) ? filePath : `${filePath}.pdf`;
}

// 保存先を選ばせる（spec-1-6 確定事項25・49）。
//
// 同名ファイルの確認は showSaveDialog が OS の作法で出すので、アプリ側では
// 重ねて聞かない（確定事項22）。docs/04 第7章の3択は、出力先を自分で
// 組み立てる Phase 2 の結合・分割の話である。
async function pickSavePath({ dialogLike, parentWindow = null, defaultPath = undefined, title = 'PDF を保存' }) {
  const options = {
    title,
    filters: PDF_FILTERS,
    defaultPath,
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  };
  // pickPdf と同じ事情で、親の有無で呼び分ける。undefined を渡すと options を
  // 親として解釈されてしまう。
  const result = parentWindow === null
    ? await dialogLike.showSaveDialog(options)
    : await dialogLike.showSaveDialog(parentWindow, options);

  if (result?.canceled === true || typeof result?.filePath !== 'string' || result.filePath.length === 0)
    return { canceled: true };
  return { path: withPdfExtension(result.filePath) };
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
    pickSavePath: (parentWindow = null, { defaultPath, title } = {}) =>
      pickSavePath({ dialogLike: dialog, parentWindow, defaultPath, title }),
    pickInsertSource: (parentWindow = null, { defaultPath } = {}) =>
      pickInsertSource({ dialogLike: dialog, parentWindow, defaultPath }),
    pickMergeSources: (parentWindow = null, { defaultPath } = {}) =>
      pickMergeSources({ dialogLike: dialog, parentWindow, defaultPath }),
    exists: (filePath) => exists(filePath),
  };
}

module.exports = {
  MAX_PDF_BYTES,
  PDF_FILTERS,
  INSERT_FILTERS,
  isPdfPath,
  withPdfExtension,
  describeReadFailure,
  toBytes,
  readPdf,
  pickPdf,
  pickInsertSource,
  pickMergeSources,
  exists,
  pickSavePath,
  createFileIo,
};
