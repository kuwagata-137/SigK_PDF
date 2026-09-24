'use strict';

// ツールモードの実行（結合・分割・変換）。pdf-task.js の runTask が kind で引く表 TOOL_TASKS を持つ。
// spec-4-5 確定事項47 で pdf-task.js から切り出した（中身は変えていない）。
//
// require しても副作用は無い。メインとの結線（parentPort）と、注釈の同梱フォントの口は
// pdf-task.js に残してある。

const fs = require('node:fs');
const path = require('node:path');

const { mergeDocuments } = require('./op-merge.js');
const { splitDocument } = require('./op-split.js');
const { runConvert } = require('./convert-task.js');
const { writeDocument } = require('../pdf-write.js');
const { PDFDocument, TOOLS, SAVE_OPTIONS, LOAD_OPTIONS, describeLoadFailure, describeSourceReadFailure } = require('./pdf-io.js');

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

// 1つの入力を複数へ分ける（spec-2-2 確定事項24〜26・36）。
//
// 5段の名前は保存と同じだが、出力が複数あるので **write を part 単位**で刻む
// （advance('write', done, total)）。apply と save は入り口の合図だけを送る。
// part ごとに save() → writeDocument を済ませてから次へ進み、書き終えた文書は
// 手放す（事前調査 A。時間はほぼ writeDocument の回数に比例する）。
//
// 入力は読むだけなので退避も照合も要らない。途中で書けなかったら、そこで止めて
// 書き終えた分は残す（確定事項26）。書きかけの一時ファイルの後始末は
// task-runner.js が spec.targets で行う。
async function runSplit(spec, { fsLike = fs, advance = () => {} } = {}) {
  const { source, parts } = spec ?? {};
  if (typeof source !== 'string')
    return { error: '分割するファイルが決まっていません。' };
  if (!Array.isArray(parts) || parts.length === 0)
    return { error: '分割するページがありません。' };
  if (parts.some((part) => typeof part?.target !== 'string'))
    return { error: '出力先が決まっていません。' };

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
  advance('save');
  advance('write', 0, parts.length);
  const targets = parts.map((part) => part.target);
  const split = await splitDocument(doc, parts.map((part) => part.pages), TOOLS, {
    onPart: async (index, out) => {
      let output;
      try {
        output = await out.save(SAVE_OPTIONS);
      } catch (error) {
        return { error: `${index + 1} / ${parts.length} 本目の内容を組み立てられませんでした。` };
      }
      const written = await writeDocument(targets[index], Buffer.from(output), { makeBackup: false, expect: null, fsLike });
      if (written.ok !== true)
        return { error: `${index + 1} / ${parts.length} 本目を書けませんでした。${written.error ?? ''}` };
      return { ok: true };
    },
    onProgress: (done, total) => advance('write', done, total),
  });
  if (split.ok !== true)
    return split;

  return { ok: true, written: split.written, targets, pages: split.pages, labeled: split.labeled };
}

// runTask が kind で引く表。表に無い kind は保存（runSave）へ落ちる（pdf-task.js）。
const TOOL_TASKS = Object.freeze({ merge: runMerge, split: runSplit, convert: runConvert });

function isToolKind(kind) {
  return typeof kind === 'string' && Object.hasOwn(TOOL_TASKS, kind);
}

module.exports = { TOOL_TASKS, isToolKind, runMerge, runSplit, runConvert };
