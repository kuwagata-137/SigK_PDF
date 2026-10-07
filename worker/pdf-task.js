'use strict';

// ワーカー（utilityProcess）のエントリ（spec-1-6 確定事項1〜14）。
//
// メインから { source, pages, ops, target } を受け、read → load → apply → save →
// write の5段を回す。段の切り替わりごとに進捗を送る。pdf-lib の save() に進捗の
// 口が無いため、段の中では進まない（実測）。
//
// pdf-lib は vendor から読む（pdf-io.js。配布物に node_modules は入っていない。docs/07 決定18）。
// ツールモードの実行（結合・分割・変換）は tool-tasks.js にあり、runTask が kind で振り分ける
// （spec-4-5 確定事項47）。ここに残るのは保存・抽出・差し込みの下見である。
//
// 本体（runSave）は process.parentPort に触れない。テストから直接呼べるように
// するためで、メッセージの結線はファイルの末尾だけに閉じてある。

const fs = require('node:fs');

const { applyForSave, applyForExtract } = require('./save-apply.js');
const { buildPreview } = require('./op-insert.js');
const { writeDocument } = require('../pdf-write.js');
const { pruneOrphans } = require('./orphan-objects.js');
const {
  PDFDocument, TOOLS, SAVE_OPTIONS, LOAD_OPTIONS,
  describeLoadFailure, describeSourceReadFailure, insertReader,
} = require('./pdf-io.js');
const { TOOL_TASKS, isToolKind, runMerge, runSplit, runConvert } = require('./tool-tasks.js');

const PHASES = ['read', 'load', 'apply', 'save', 'write'];

// Windows のパスとして同じファイルか（大文字小文字と区切りの字をそろえる。recent-documents.js の pathKey と同じ比べ方）。
function samePath(a, b) {
  const key = (value) => value.replace(/\//g, '\\').toLowerCase();
  return key(a) === key(b);
}

// apply の段（applyForSave・applyForExtract）は save-apply.js にある（spec-4b-6b m0）。

// 差し込むページを1つの PDF として組み立てて返す（確定事項93・94）。
//
// ファイルは書かない。バイト列をそのまま返し、レンダラーが pdf.js で開いて
// 画面へ出す。**保存と同じ op-insert.js を通る**ので、見えているものと
// 保存されるものが食い違わない。
async function runInsertPreview(spec, { fsLike = fs } = {}) {
  const { path: sourcePath, base = null } = spec ?? {};
  if (typeof sourcePath !== 'string')
    return { error: '差し込むファイルが決まっていません。' };

  let built;
  try {
    built = await buildPreview(sourcePath, base, TOOLS, insertReader(fsLike));
  } catch (error) {
    return { error: '差し込むページを組み立てられませんでした。' };
  }
  if (built.ok !== true)
    return built;

  const bytes = await built.doc.save(SAVE_OPTIONS);
  return { ok: true, bytes, pages: built.sizes, kind: built.kind };
}

// 5段を回す。advance(phase) は段の入り口ごとに1回だけ呼ぶ。
//
// kind は 'save'（既定。開いた文書をその場で並べ替える）か 'extract'
// （選んだページだけを新規文書へ複製する）。違うのは apply の段だけで、
// 読み・書き・進捗・後始末はすべて同じ経路を通る。
async function runSave(spec, { fsLike = fs, advance = () => {} } = {}) {
  const { kind = 'save', source, pages, inserts = [], annotations = {}, target, makeBackup = false, expect = null, mosaics = [], dropBackup = false } = spec ?? {};
  if (typeof source !== 'string' || typeof target !== 'string')
    return { error: '保存先が決まっていません。' };

  advance('read');
  let bytes;
  try {
    bytes = await fsLike.promises.readFile(source);
  } catch (error) {
    return { error: describeSourceReadFailure(error) };
  }

  advance('load');
  let doc;
  try {
    doc = await PDFDocument.load(bytes, LOAD_OPTIONS);
  } catch (error) {
    return { error: describeLoadFailure(error) };
  }

  advance('apply');
  const applied = kind === 'extract'
    ? await applyForExtract(doc, pages, annotations, mosaics)
    : await applyForSave(doc, pages, inserts, fsLike, annotations, mosaics);
  if (applied.ok !== true)
    return applied;
  // モザイクで差し替えた古い中身を、ファイルに残さない（spec-4b-6b 確定事項22）。モザイクの無い保存の振る舞いは変えない。
  if (applied.mosaics > 0)
    pruneOrphans(applied.doc, TOOLS);
  // 名前を付けて保存で開いているファイル自身を選んだときも、モザイクのある保存は上書き保存と同じく控えを残さない（決定64 ⑧。画面側で
  // 上書きとして扱うことの保険。コードの点検で直した）。
  const dropOwnBackup = dropBackup || (applied.mosaics > 0 && kind === 'save' && samePath(source, target));

  advance('save');
  let output;
  try {
    output = await applied.doc.save(SAVE_OPTIONS);
  } catch (error) {
    return { error: '保存する内容を組み立てられませんでした。' };
  }

  advance('write');
  const written = await writeDocument(target, Buffer.from(output), { makeBackup, dropBackup: dropOwnBackup, expect, fsLike });
  if (written.ok !== true)
    return written;

  return {
    ok: true,
    path: written.path,
    backup: written.backup,
    bytes: written.bytes,
    pages: applied.pages,
    signature: written.signature,
    pruned: applied.pruned,
    // 前からある控えを消せなかった（spec-4b-6b 確定事項23。画面が帯で知らせる）。
    backupLeft: written.backupLeft === true,
  };
}

// メインへ進捗を送りながら回す。
//
// insert-preview だけは5段を回さない。ファイルを書かず、読むのも差し込む元
// 1本だけなので、進捗を出す間もなく終わる（実測で数ミリ秒）。フラット化の件数の下見
// （flatten-preview）も同じくファイルを書かず、進捗を送らない（tool-tasks.js）。
// ツールの kind（TOOL_TASKS）はその実行関数へ、それ以外は保存へ回す。
async function runTask(spec, { send = () => {}, fsLike = fs } = {}) {
  const started = Date.now();
  const progress = (phase, done, total, unit) => send(
    Number.isInteger(done) ? { type: 'progress', phase, done, total, ...(unit === undefined ? {} : { unit }) } : { type: 'progress', phase });
  let result;
  if (spec?.kind === 'insert-preview')
    result = await runInsertPreview(spec, { fsLike });
  else if (isToolKind(spec?.kind))
    result = await TOOL_TASKS[spec.kind](spec, { fsLike, advance: progress });
  else
    result = await runSave(spec, { fsLike, advance: progress });
  return { ...result, ms: Date.now() - started };
}

module.exports = { PHASES, SAVE_OPTIONS, LOAD_OPTIONS, describeLoadFailure, describeSourceReadFailure, applyForSave, applyForExtract, runInsertPreview, runSave, runMerge, runSplit, runConvert, runTask };

// メッセージの結線。utilityProcess の中でだけ効く。
if (process.parentPort !== undefined && process.parentPort !== null) {
  process.parentPort.on('message', async (event) => {
    const message = event?.data;
    if (message?.type !== 'run')
      return;
    const send = (payload) => process.parentPort.postMessage(payload);
    let result;
    try {
      result = await runTask(message.spec, { send });
    } catch (error) {
      result = { error: '保存中に予期しない問題が起きました。元のファイルは変更していません。' };
    }
    send({ type: 'done', taskId: message.taskId, result });
  });
}
