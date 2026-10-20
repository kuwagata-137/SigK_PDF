'use strict';

// 差し込む元を読む層（spec-1-6 確定事項53〜65。spec-2-5 確定事項I5）。
//
// 差し込む元は 2 種類ある。ページ編集の［挿入］で選んだファイル（{ path }）と、ツールモードで帯のページを引いて写したもの（{ copy }）。
// 写しはファイルにしない（一時ファイルを作らない。付則C）ので、画面がバイト列を持ち、保存のときに spec の copies へ鍵ごとに 1 回だけ載せてくる。
// どちらも 1 回だけ読み、同じ元の複数ページは cache で使い回す。op-insert.js が 200 行を超えるので、読む所をここへ分けた（PR-4）。

const { detectFormat, isSupported, describeFormat, isProgressiveJpeg } = require('./image-format.js');
const { frameCount } = require('./image-decode.js');
const { readSignature, signaturesMatch } = require('../pdf-write.js');
const { pdfLib } = require('./pdf-io.js');

const { failure } = require('./task-failure.js');
const NOT_FOUND = '差し込むページが見つからないので、もう一度やり直してください。';

// 画像のページ数。複数ページを持つのは TIFF だけ（spec-3-2 確定事項24）。
function imageFrames(kind, bytes) {
  if (kind === 'png' || kind === 'jpeg')
    return 1;
  return frameCount(kind, bytes);
}

const UNREADABLE = '内容が壊れているか、パスワードで保護されているので、差し込む PDF を読めませんでした。';
const BROKEN_PAGE = '差し込む PDF に壊れたページがあるので、差し込めませんでした。';

// ページの木の中の、pdf-lib が黙って飛ばすページ（壊れたページ）の見分け（spec-6-1 確定事項D-8。点検の直し I-1・I-2）。壊れていれば理由の文、
// 無ければ null。そのまま差し込むと、ページが欠けたことに気づけない（決定81 ⑬ で、1 ページだけ壊れた PDF を開かないことにしたのと同じ考え）。
// 葉（/Kids の無い辞書。ページ）を数えて pdf-lib のページ数と比べるので、辞書でない値・/Type の無い辞書など、pdf-lib が飛ばす形をどれも拾う。
// 一度通った辞書にまた来たら（木が自分を指している）壊れているとみなす（pdf.js も循環で止める）。
function brokenPageReason(doc) {
  const { PDFArray, PDFDict, PDFName } = pdfLib;
  const seen = new Set();
  let leaves = 0;
  const walk = (node, depth) => {
    if (seen.has(node) || depth > 64)
      return 'ページの木が自分を指しているか、深すぎる';
    seen.add(node);
    const kids = node.lookup(PDFName.of('Kids'));
    if (kids === undefined) {
      leaves += 1;
      return null;
    }
    if (!(kids instanceof PDFArray))
      return '/Kids が配列でない';
    for (let index = 0; index < kids.size(); index += 1) {
      const kid = kids.lookup(index);
      const reason = kid instanceof PDFDict ? walk(kid, depth + 1) : `/Kids の ${index + 1} 番目が辞書でない`;
      if (reason !== null)
        return reason;
    }
    return null;
  };
  const reason = walk(doc.catalog.Pages(), 0);
  if (reason !== null)
    return reason;
  const count = doc.getPageCount();
  return count === leaves ? null : `ページの木の葉 ${leaves} 枚と、pdf-lib が数えたページ ${count} 枚が違う`;
}

// 読んだバイト列を、差し込める形（PDF なら pdf-lib の文書、画像ならフレームの数）にする。
async function loadBytes(bytes, PDFDocument) {
  const kind = detectFormat(bytes);
  if (!isSupported(kind))
    return { error: describeFormat(kind) };
  if (kind === 'jpeg' && isProgressiveJpeg(bytes))
    return { error: 'この JPEG はプログレッシブ形式なので、挿入できません。' };

  if (kind === 'pdf') {
    let doc;
    try {
      doc = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (error) {
      return failure(UNREADABLE, error);
    }
    // 見出しだけの PDF などはカタログが無く、見分けの中で例外になる。読めないものとして断る（点検の直し M-3）。断った理由は記録に残す。
    let reason;
    try {
      reason = brokenPageReason(doc);
    } catch (error) {
      return failure(UNREADABLE, error);
    }
    return reason === null ? { ok: true, kind, doc } : failure(BROKEN_PAGE, new Error(reason));
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
    cache.set(path, failure('差し込むファイルを読めませんでした。', error));
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

// 並びにある差し込み（{ path }）の元のファイルが、差し込んだときから書き換えられているか（spec-6-1 確定事項C-8）。読む前に呼ぶ。差し込んだときの
// 印（expect）を持たないもの・写し（{ copy }）・今の印を読めないもの（無くなったファイル。読みに行って断る）は照らさない。
async function insertsChanged(plan, inserts, fsLike) {
  for (const entry of Array.isArray(plan) ? plan : []) {
    const spec = Number.isInteger(entry?.insert) ? inserts?.[entry.insert] : undefined;
    if (typeof spec?.path !== 'string' || spec.expect === null || spec.expect === undefined)
      continue;
    if (!signaturesMatch(spec.expect, await readSignature(spec.path, { fsLike })))
      return true;
  }
  return false;
}

module.exports = { NOT_FOUND, loadSource, loadInsertSource, insertsChanged };
