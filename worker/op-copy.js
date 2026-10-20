'use strict';

// 帯のページの写しを作る（spec-2-5 確定事項I3〜I5。PR-4）。
//
// ツールモードで帯のページを引いてほかの帯や受け口へ落とすと、画面はこの処理で、引き始めた帯の今の見た目（保存していない並べ替え・回転・
// 切り取り・書き込み・差し込み）を PDF にする。**ファイルは書かない**（一時ファイルを作らない。付則C）。バイト列を返し、画面がそれを
// pdf.js で開いて、写した先の差し込み（{ copy }）か、名前の無い帯（新しい帯）の中身にする。
//
// 元の中身は、ファイルのパス（source）か、バイト列（copies[sourceCopy]）。バイト列は名前の無い帯の中身と、開いたあとでほかのアプリに書き換えられた
// ファイルの開いたときの中身（鍵 'opened'。spec-6-1 タスク C）。保存（pdf-task.js の runSave）も同じ readSource で読む。

const { applyForCopy } = require('./save-apply.js');
const { readSignature, signaturesMatch } = require('../pdf-write.js');
const { normalizeRotation } = require('./op-pages.js');
const { PDFDocument, SAVE_OPTIONS, LOAD_OPTIONS, describeLoadFailure, describeSourceReadFailure, insertReader } = require('./pdf-io.js');

const { failure } = require('./task-failure.js');
const NO_SOURCE = 'PDF の中身が見つからないので、もう一度やり直してください。';

// 元の中身のバイト列。写しの鍵（sourceCopy）があれば、パスがあってもその鍵のバイト列だけを使う（無ければ止める。書き換えられたディスクの中身へ
// 黙って落ちない。spec-6-1 確定事項C-6）。鍵が無ければパスから読む。
async function readSource({ source, sourceCopy, copies }, fsLike) {
  if (typeof sourceCopy === 'string') {
    const bytes = copies?.[sourceCopy];
    return bytes instanceof Uint8Array ? { ok: true, bytes } : { error: NO_SOURCE };
  }
  if (typeof source !== 'string')
    return { error: NO_SOURCE };
  try {
    return { ok: true, bytes: await fsLike.promises.readFile(source) };
  } catch (error) {
    return failure(describeSourceReadFailure(error), error);
  }
}

// 元のファイルが、画面が開いたときから書き換えられているか（spec-6-1 確定事項C-2）。読む前に呼ぶ。バイト列で渡されたもの・開いたときの印
// （expectSource）を知らないもの・今の印を読めないもの（無くなったファイル。読みに行って「見つからない」で止まる）は照らさない。
async function sourceChanged({ source, sourceCopy, expectSource = null }, fsLike) {
  if (typeof source !== 'string' || typeof sourceCopy === 'string' || expectSource === null)
    return false;
  return !signaturesMatch(expectSource, await readSignature(source, { fsLike }));
}

// 見えている大きさ（切り取りの箱。90／270 度回っていれば幅と高さを入れ替える）。帯と差し込みの寸法の控えに使う。
function viewedSize(page) {
  const { width, height } = page.getCropBox();
  const angle = normalizeRotation(page.getRotation().angle);
  return angle === 90 || angle === 270 ? { width: height, height: width } : { width, height };
}

// spec は { kind: 'copy-pages', source, sourceCopy, copies, pages, inserts, annotations, expectSource }。pages は写すページの plan の要素（並びの順）。
async function runCopy(spec, { fsLike } = {}) {
  const { pages, inserts = [], annotations = {}, copies = {} } = spec ?? {};
  // 書き換えられていたら写さず、画面が開いたときの中身でやり直す（spec-6-1 タスク C。保存と同じ）。
  if (await sourceChanged(spec ?? {}, fsLike))
    return { sourceChanged: true };
  const read = await readSource(spec ?? {}, fsLike);
  if (read.ok !== true)
    return read;

  let doc;
  try {
    doc = await PDFDocument.load(read.bytes, LOAD_OPTIONS);
  } catch (error) {
    return failure(describeLoadFailure(error), error);
  }

  const applied = await applyForCopy(doc, pages, inserts, { ...insertReader(fsLike), copies }, annotations);
  if (applied.ok !== true)
    return applied;

  let bytes;
  try {
    bytes = await applied.doc.save(SAVE_OPTIONS);
  } catch (error) {
    return failure('写すページを組み立てられませんでした。', error);
  }
  return { ok: true, bytes, pages: applied.pages, sizes: applied.doc.getPages().map(viewedSize) };
}

module.exports = { NO_SOURCE, readSource, sourceChanged, runCopy };
