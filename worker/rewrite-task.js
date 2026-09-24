'use strict';

// 1 本の PDF を読み、手を加えて、別のファイルへ書く（透かし・フラット化。spec-4-5 確定事項26・33）。
//
// 5 段の名前は保存と同じ（read → load → apply → save → write）。入力は読むだけなので、
// 退避（.bak）も外部変更の照合も要らない。入力と同じ出力先・タブで開いている出力先は
// レンダラーが先に断る（確定事項41・42）。書きかけの一時ファイルの後始末は task-runner.js が
// spec.target で行う。

const fs = require('node:fs');

const { writeDocument } = require('../pdf-write.js');
const { PDFDocument, SAVE_OPTIONS, LOAD_OPTIONS, describeLoadFailure, describeSourceReadFailure } = require('./pdf-io.js');

// apply(doc, { fsLike }) は { ok, ...結果 } か { error } を返す。結果の欄は戻り値にそのまま載る。
async function runRewrite(spec, apply, { fsLike = fs, advance = () => {} } = {}) {
  const { source, target } = spec ?? {};
  if (typeof source !== 'string')
    return { error: '対象のファイルが決まっていません。' };
  if (typeof target !== 'string')
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
  const applied = await apply(doc, { fsLike });
  if (applied?.ok !== true)
    return applied ?? { error: '手を加えられませんでした。' };

  advance('save');
  let output;
  try {
    output = await doc.save(SAVE_OPTIONS);
  } catch (error) {
    return { error: '書き出す内容を組み立てられませんでした。' };
  }

  advance('write');
  const written = await writeDocument(target, Buffer.from(output), { makeBackup: false, expect: null, fsLike });
  if (written.ok !== true)
    return written;

  const { ok, ...result } = applied;
  return { ok, ...result, path: written.path, bytes: written.bytes, signature: written.signature };
}

module.exports = { runRewrite };
