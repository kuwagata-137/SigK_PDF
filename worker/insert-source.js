'use strict';

// 差し込む元を読む層（spec-1-6 確定事項53〜65。spec-2-5 確定事項I5）。
//
// 差し込む元は 2 種類ある。ページ編集の［挿入］で選んだファイル（{ path }）と、ツールモードで帯のページを引いて写したもの（{ copy }）。
// 写しはファイルにしない（一時ファイルを作らない。付則C）ので、画面がバイト列を持ち、保存のときに spec の copies へ鍵ごとに 1 回だけ載せてくる。
// どちらも 1 回だけ読み、同じ元の複数ページは cache で使い回す。op-insert.js が 200 行を超えるので、読む所をここへ分けた（PR-4）。

const { detectFormat, isSupported, describeFormat, isProgressiveJpeg } = require('./image-format.js');
const { frameCount } = require('./image-decode.js');

const NOT_FOUND = '差し込むページが見つからないので、もう一度やり直してください。';

// 画像のページ数。複数ページを持つのは TIFF だけ（spec-3-2 確定事項24）。
function imageFrames(kind, bytes) {
  if (kind === 'png' || kind === 'jpeg')
    return 1;
  return frameCount(kind, bytes);
}

// 読んだバイト列を、差し込める形（PDF なら pdf-lib の文書、画像ならフレームの数）にする。
async function loadBytes(bytes, PDFDocument) {
  const kind = detectFormat(bytes);
  if (!isSupported(kind))
    return { error: describeFormat(kind) };
  if (kind === 'jpeg' && isProgressiveJpeg(bytes))
    return { error: 'この JPEG はプログレッシブ形式なので、挿入できません。' };

  if (kind === 'pdf') {
    try {
      return { ok: true, kind, doc: await PDFDocument.load(bytes, { updateMetadata: false }) };
    } catch (error) {
      return { error: '内容が壊れているか、パスワードで保護されているので、差し込む PDF を読めませんでした。' };
    }
  }
  const frames = imageFrames(kind, bytes);
  return frames === 0
    ? { error: '画像を読み込めませんでした。ファイルが壊れている可能性があります。' }
    : { ok: true, kind, bytes, frames };
}

// 差し込む元を1回だけ読む。同じファイルの複数ページを差し込むことがある。
async function loadSource(path, cache, { readFile, PDFDocument }) {
  if (cache.has(path))
    return cache.get(path);

  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    cache.set(path, { error: '差し込むファイルを読めませんでした。' });
    return cache.get(path);
  }
  cache.set(path, await loadBytes(bytes, PDFDocument));
  return cache.get(path);
}

// 差し込みの控え spec（{ path, page, size } か { copy, page, size }）の元を読む。写しは copies[鍵] のバイト列（鍵はパスと混ざらないよう
// 「copy:」を付けて cache に置く）。どちらも無ければ断る。
async function loadInsertSource(spec, cache, { readFile, copies, PDFDocument }) {
  if (typeof spec?.copy === 'string') {
    const key = `copy:${spec.copy}`;
    if (!cache.has(key)) {
      const bytes = copies?.[spec.copy];
      cache.set(key, bytes instanceof Uint8Array ? await loadBytes(bytes, PDFDocument) : { error: NOT_FOUND });
    }
    return cache.get(key);
  }
  if (typeof spec?.path !== 'string')
    return { error: NOT_FOUND };
  return loadSource(spec.path, cache, { readFile, PDFDocument });
}

module.exports = { NOT_FOUND, loadSource, loadInsertSource };
