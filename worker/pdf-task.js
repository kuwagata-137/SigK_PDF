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
const { readLabels, rebuildLabels } = require('./op-page-labels.js');
const { pruneDestinations } = require('./op-outline.js');
const { writeDocument } = require('../pdf-write.js');

const pdfLib = require(path.join(__dirname, '..', 'vendor', 'pdf-lib.min.js'));
const { PDFDocument } = pdfLib;

// 低レベルの組み立てに要る道具。ページラベルとしおりの層へ渡す（パスをあちらに持たせない）。
const TOOLS = { PDFName: pdfLib.PDFName, PDFHexString: pdfLib.PDFHexString };

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

function describeReadFailure(error) {
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

// 5段を回す。advance(phase) は段の入り口ごとに1回だけ呼ぶ。
async function runSave(spec, { fsLike = fs, advance = () => {} } = {}) {
  const { source, pages, target, makeBackup = false, expect = null } = spec ?? {};
  if (typeof source !== 'string' || typeof target !== 'string')
    return { error: '保存先が決まっていません。' };

  advance('read');
  let bytes;
  try {
    bytes = await fsLike.promises.readFile(source);
  } catch (error) {
    return { error: describeReadFailure(error) };
  }

  advance('load');
  let doc;
  try {
    doc = await PDFDocument.load(bytes, LOAD_OPTIONS);
  } catch (error) {
    return { error: describeLoadFailure(error) };
  }

  advance('apply');
  // ページラベルは applyPlan の**前**に読む。当てたあとでは元の対応が失われる。
  const labelsBefore = readLabels(doc);
  const applied = applyPlan(doc, pages);
  if (applied.ok !== true)
    return applied;
  // 作り直しは applyPlan の**あと**。ページ数が合っていないと最後のラベルが引き延ばされる。
  rebuildLabels(doc, pages, labelsBefore, TOOLS);
  // 削除で飛び先を失ったしおりから /Dest と /A を落とす（見出しは残す）。
  const pruned = pruneDestinations(doc, TOOLS);

  advance('save');
  let output;
  try {
    output = await doc.save(SAVE_OPTIONS);
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
    pruned,
  };
}

// メインへ進捗を送りながら回す。
async function runTask(spec, { send = () => {}, fsLike = fs } = {}) {
  const started = Date.now();
  const result = await runSave(spec, { fsLike, advance: (phase) => send({ type: 'progress', phase }) });
  return { ...result, ms: Date.now() - started };
}

module.exports = { PHASES, SAVE_OPTIONS, LOAD_OPTIONS, describeLoadFailure, describeReadFailure, runSave, runTask };

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
