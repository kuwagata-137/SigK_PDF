'use strict';

// 1 本の PDF を読み、手を加えて、別のファイルへ書くツール（透かし・フラット化。spec-4-5 確定事項26・33）。
// tool-tasks.js の表 TOOL_TASKS から呼ばれる。
//
// 5 段の名前は保存と同じ（read → load → apply → save → write）。入力は読むだけなので、
// 退避（.bak）も出力先の照合も要らない。入力がタブで開いたときから書き換えられていたら、読む前に止める（決定81 ⑫）。入力と同じ出力先・タブで開いている出力先は
// レンダラーが先に断る（確定事項41・42）。書きかけの一時ファイルの後始末は task-runner.js が
// spec.target で行う。

const fs = require('node:fs');

const { applyWatermark } = require('./op-watermark.js');
const { flattenDocument } = require('./op-flatten.js');
const { createFontSource } = require('./font-embed.js');
const { failure } = require('./task-failure.js');
const { writeDocument, readSignature, signaturesMatch } = require('../pdf-write.js');
const {
  PDFDocument, TOOLS, SAVE_OPTIONS, LOAD_OPTIONS,
  describeLoadFailure, describeSourceReadFailure, insertReader,
} = require('./pdf-io.js');

// 透かしの文字の輪郭に使う同梱フォント（確定事項20）。読むのは文字の透かしを入れるときだけ。
const fontSource = createFontSource();

// 元を読んで開く。戻り値は { doc } か { error }。advance は読む・開くの入り口で呼ぶ。
async function openSource(source, { fsLike, advance = () => {} }) {
  if (typeof source !== 'string')
    return { error: '対象のファイルが決まっていません。' };
  advance('read');
  let bytes;
  try {
    bytes = await fsLike.promises.readFile(source);
  } catch (error) {
    return failure(describeSourceReadFailure(error), error);
  }
  advance('load');
  try {
    return { doc: await PDFDocument.load(bytes, LOAD_OPTIONS) };
  } catch (error) {
    return failure(describeLoadFailure(error), error);
  }
}

// apply(doc, { fsLike }) は { ok, ...結果 } か { error } を返す。結果の欄は戻り値にそのまま載る。
async function runRewrite(spec, apply, { fsLike = fs, advance = () => {} } = {}) {
  const { source, target, expectSource = null } = spec ?? {};
  if (typeof source === 'string' && typeof target !== 'string')
    return { error: '保存先が決まっていません。' };
  // 止めたときの文は画面が組む（spec-6-1 確定事項C-9）。
  if (typeof source === 'string' && expectSource !== null && !signaturesMatch(expectSource, await readSignature(source, { fsLike })))
    return { sourceChanged: true };
  const opened = await openSource(source, { fsLike, advance });
  if (opened.error !== undefined)
    return opened;

  advance('apply');
  const applied = await apply(opened.doc, { fsLike });
  if (applied?.ok !== true)
    return applied ?? { error: '手を加えられませんでした。' };

  advance('save');
  let output;
  try {
    output = await opened.doc.save(SAVE_OPTIONS);
  } catch (error) {
    return failure('書き出す内容を組み立てられませんでした。', error);
  }

  advance('write');
  const written = await writeDocument(target, Buffer.from(output), { makeBackup: false, expect: null, fsLike });
  if (written.ok !== true)
    return written;

  const { ok, ...result } = applied;
  return { ok, ...result, path: written.path, bytes: written.bytes, signature: written.signature };
}

// 透かしを入れる（確定事項20〜26）。画像はパスから読み直す（画像→PDF と同じ insertReader。必ず toBytes() を通す）。
function runWatermark(spec, deps = {}) {
  return runRewrite(spec, (doc, { fsLike }) => applyWatermark(doc, spec, TOOLS, {
    fontSource: deps.fontSource ?? fontSource,
    readFile: insertReader(fsLike).readFile,
  }), deps);
}

// 注釈を焼き込む（確定事項27〜33）。焼くものが無ければ書かずに断る。spec.kinds・spec.pages（焼く種類と 0 始まりのページ）が
// あれば、選んだものだけを焼き、ほかは注釈のまま残す（spec-2-5 確定事項E5。決定80 ㉞）。
function runFlatten(spec, deps = {}) {
  return runRewrite(spec, (doc) => {
    const result = flattenDocument(doc, TOOLS, { kinds: spec?.kinds ?? null, pages: spec?.pages ?? null });
    return result.baked > 0 ? result : { error: '焼き込める書き込みがありません。' };
  }, deps);
}

// 焼き込む件数を数える（確定事項32）。ファイルは書かない。差し込みの下見と同じく進捗は送らない。ページごとの数（pages）も返す。
async function runFlattenPreview(spec, { fsLike = fs } = {}) {
  const opened = await openSource(spec?.source, { fsLike });
  if (opened.error !== undefined)
    return opened;
  return flattenDocument(opened.doc, TOOLS, { dryRun: true });
}

module.exports = { runRewrite, runWatermark, runFlatten, runFlattenPreview };
