'use strict';

// ワーカー（utilityProcess）のエントリ（spec-1-6 確定事項1〜14）。
//
// メインから { source, pages, ops, target } を受け、read → load → apply → save →
// write の5段を回す。段の切り替わりごとに進捗を送る。pdf-lib の save() に進捗の
// 口が無いため、段の中では進まない（実測）。
//
// pdf-lib は vendor から読む。配布物に node_modules は入っていない（docs/07 決定18）。
// asar の中からでも require できることは実測で確かめた（spec-1-6 事前調査 A）。
//
// 本体（runSave）は process.parentPort に触れない。テストから直接呼べるように
// するためで、メッセージの結線はファイルの末尾だけに閉じてある。

const fs = require('node:fs');
const path = require('node:path');

const { applyPlan } = require('./op-pages.js');
const { extractPages } = require('./op-extract.js');
const { mergeDocuments } = require('./op-merge.js');
const { buildPreview, prepareInserts } = require('./op-insert.js');
const { readLabels, rebuildLabels } = require('./op-page-labels.js');
const { pruneDestinations } = require('./op-outline.js');
const { writeDocument } = require('../pdf-write.js');
const { toBytes } = require('../file-io.js');

const pdfLib = require(path.join(__dirname, '..', 'vendor', 'pdf-lib.min.js'));
const { PDFDocument } = pdfLib;

// 低レベルの組み立てに要る道具。ページラベル・しおり・差し込みの層へ渡す
// （vendor へのパスをあちらに持たせない）。
const TOOLS = {
  PDFDocument,
  PDFPage: pdfLib.PDFPage,
  PDFName: pdfLib.PDFName,
  PDFHexString: pdfLib.PDFHexString,
  rgb: pdfLib.rgb,
};

const PHASES = ['read', 'load', 'apply', 'save', 'write'];

// save() のオプション（spec-1-6 事前調査 B）。
//
//   updateFieldAppearances: false … 既定 true のままだと、getForm() を通った文書で
//     /AP を持たない和文の欄の見た目を WinAnsi で作り直そうとして失敗する。
//     このワーカーは getForm() を呼ばないので今は牙を剥かないが、明示して塞いでおく。
//   addDefaultPage: false … 0ページのときに白紙 A4 を勝手に生やさない。
//     0ページは applyPlan が先に断るので、ここは二重の備えである。
const SAVE_OPTIONS = { updateFieldAppearances: false, addDefaultPage: false };

// load のオプション。updateMetadata は **load 側**にある。save へ渡しても効かず、
// 既定のままだと読み込んだ時点で Producer が pdf-lib へ書き換わる（実測 B）。
const LOAD_OPTIONS = { updateMetadata: false };

// 例外の型を選ばずに握る。pdf-lib は内容が欠けた PDF で素の TypeError を投げる
// ことがあり、そのまま画面へ出しても意味が通らない（確定事項11）。
function describeLoadFailure(error) {
  if (/encrypted/i.test(String(error?.message ?? '')))
    return 'パスワードで保護された PDF は保存できません。';
  return 'この PDF は内容が壊れているため保存できません。';
}

// file-io.js にも同じ役目の describeReadFailure があるが、あちらは「開くとき」の文言で、
// こちらは「保存しようとしたら元が無くなっていた」文言である。取り違えないよう名前を分ける。
function describeSourceReadFailure(error) {
  switch (error?.code) {
    case 'ENOENT':
      return '元のファイルが見つかりません。移動または削除された可能性があります。';
    case 'EACCES':
    case 'EPERM':
      return '元のファイルを読む権限がありません。';
    case 'EBUSY':
      return '元のファイルが他のプログラムで使われています。';
    default:
      return '元のファイルを読めませんでした。';
  }
}

// apply の段。開いた文書をその場で並べ替える（上書き・名前を付けて保存）。
//
// ページラベルは applyPlan の**前**に読む。当てたあとでは元の対応が失われる。
// 作り直しは applyPlan の**あと**で、ページ数が合っていないと最後のラベルが
// 引き延ばされる。この前後関係は入れ替えられない。
async function applyForSave(doc, pages, inserts, fsLike) {
  const labelsBefore = readLabels(doc);
  // 差し込むページを先に組み立てる。
  const prepared = await prepareInserts(doc, doc.getPages(), pages, inserts, TOOLS, insertReader(fsLike));
  if (prepared.ok !== true)
    return prepared;

  const applied = applyPlan(doc, pages, { inserted: prepared.pages });
  if (applied.ok !== true)
    return applied;
  rebuildLabels(doc, pages, labelsBefore, TOOLS);
  // 削除で飛び先を失ったしおりから /Dest と /A を落とす（見出しは残す）。
  return { ok: true, doc, pages: applied.pages, pruned: pruneDestinations(doc, TOOLS) };
}

// apply の段。新規文書へ複製する（抽出。確定事項47）。
//
// ページラベルは保存と同じ規則で引き継ぐ（確定事項45）。しおりも名前付き宛先も
// 新しい文書へは来ないので、掃除するものが無い。
async function applyForExtract(doc, pages) {
  const labelsBefore = readLabels(doc);
  const extracted = await extractPages(doc, pages, { PDFDocument });
  if (extracted.ok !== true)
    return extracted;
  rebuildLabels(extracted.doc, pages, labelsBefore, TOOLS);
  return { ok: true, doc: extracted.doc, pages: extracted.pages, pruned: { outlines: 0, names: 0 } };
}

// 差し込む元をディスクから読む口。**必ず toBytes() を通す**（確定事項55）。
// embedJpg は byteOffset≠0 の Uint8Array を必ず拒否し、readFileSync は 4KB 未満の
// ファイルでプール Buffer を返すためである。書き落とすと「小さい JPEG だけ
// 挿入できない」という再現しにくい不具合になる。
function insertReader(fsLike) {
  return { readFile: async (target) => toBytes(await fsLike.promises.readFile(target)) };
}

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
  const { kind = 'save', source, pages, inserts = [], target, makeBackup = false, expect = null } = spec ?? {};
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
    ? await applyForExtract(doc, pages)
    : await applyForSave(doc, pages, inserts, fsLike);
  if (applied.ok !== true)
    return applied;

  advance('save');
  let output;
  try {
    output = await applied.doc.save(SAVE_OPTIONS);
  } catch (error) {
    return { error: '保存する内容を組み立てられませんでした。' };
  }

  advance('write');
  const written = await writeDocument(target, Buffer.from(output), { makeBackup, expect, fsLike });
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
  };
}

// 複数の入力を1つへ結合する（spec-2-1 確定事項22・29〜34）。
//
// 5段の名前は保存と同じだが、入力が複数あるので read と apply はファイル単位で
// 刻む（advance(phase, done, total)）。load は apply の中で1本ずつ行い、複製し
// 終えた入力から手放す（op-merge.js）。「load」の段は入り口の合図だけを送る。
//
// 入力は読むだけなので、退避（.bak）も外部変更の照合も要らない。出力先が入力の
// 1つと同じ経路はレンダラーが先に断る（確定事項24）。ここは黙って書く。
async function runMerge(spec, { fsLike = fs, advance = () => {} } = {}) {
  const { inputs, target } = spec ?? {};
  if (!Array.isArray(inputs) || inputs.length === 0)
    return { error: '結合するファイルがありません。' };
  if (typeof target !== 'string')
    return { error: '保存先が決まっていません。' };
  if (inputs.some((input) => typeof input?.path !== 'string'))
    return { error: '結合するファイルの場所が分かりません。' };

  const nameOf = (input) => input.name ?? path.basename(input.path);

  advance('read', 0, inputs.length);
  const bytes = [];
  for (const [index, input] of inputs.entries()) {
    try {
      bytes.push(await fsLike.promises.readFile(input.path));
    } catch (error) {
      return { error: `「${nameOf(input)}」${describeSourceReadFailure(error)}` };
    }
    advance('read', index + 1, inputs.length);
  }

  advance('load');
  advance('apply', 0, inputs.length);
  const entries = inputs.map((input, index) => ({
    name: nameOf(input),
    pages: input.pages ?? null,
    load: async () => {
      const doc = await PDFDocument.load(bytes[index], LOAD_OPTIONS);
      bytes[index] = null;
      return doc;
    },
  }));
  const merged = await mergeDocuments(entries, TOOLS, {
    describeLoadFailure,
    onProgress: (done, total) => advance('apply', done, total),
  });
  if (merged.ok !== true)
    return merged;

  advance('save');
  let output;
  try {
    output = await merged.doc.save(SAVE_OPTIONS);
  } catch (error) {
    return { error: '結合した内容を組み立てられませんでした。' };
  }

  advance('write');
  const written = await writeDocument(target, Buffer.from(output), { makeBackup: false, expect: null, fsLike });
  if (written.ok !== true)
    return written;

  return {
    ok: true,
    path: written.path,
    bytes: written.bytes,
    pages: merged.pages,
    inputs: inputs.length,
    labeled: merged.labeled,
    signature: written.signature,
  };
}

// メインへ進捗を送りながら回す。
//
// insert-preview だけは5段を回さない。ファイルを書かず、読むのも差し込む元
// 1本だけなので、進捗を出す間もなく終わる（実測で数ミリ秒）。
async function runTask(spec, { send = () => {}, fsLike = fs } = {}) {
  const started = Date.now();
  const progress = (phase, done, total) => send(
    Number.isInteger(done) ? { type: 'progress', phase, done, total } : { type: 'progress', phase });
  let result;
  if (spec?.kind === 'insert-preview')
    result = await runInsertPreview(spec, { fsLike });
  else if (spec?.kind === 'merge')
    result = await runMerge(spec, { fsLike, advance: progress });
  else
    result = await runSave(spec, { fsLike, advance: progress });
  return { ...result, ms: Date.now() - started };
}

module.exports = { PHASES, SAVE_OPTIONS, LOAD_OPTIONS, describeLoadFailure, describeSourceReadFailure, applyForSave, applyForExtract, runInsertPreview, runSave, runMerge, runTask };

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
