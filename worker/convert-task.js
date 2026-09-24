'use strict';

// 画像を PDF にする（spec-3-1 確定事項22〜25・29）。tool-tasks.js の振り分けから呼ばれる。
// spec-4-5 確定事項47 で pdf-task.js から切り出した（中身は変えていない）。
//
// output が 'single' なら結合の型（apply を画像単位で刻み、1本書く）、'each' なら分割の型
// （write を出力単位で刻み、書き終えた分は残す）。読み口は差し込みと同じ insertReader で、
// 必ず toBytes() を通す（4KB 未満の JPEG が byteOffset≠0 で埋め込めない。確定事項31）。
// 1ファイル＝1エントリ。layouts はページ数ぶん（TIFF 以外は1つ。spec-3-2 確定事項20）。
// 塊④ までの `layout`（1つ）も受ける。

const fs = require('node:fs');
const path = require('node:path');

const { loadImage, convertToSingle, convertToEach } = require('./op-convert.js');
const { writeDocument } = require('../pdf-write.js');
const { TOOLS, SAVE_OPTIONS, insertReader } = require('./pdf-io.js');

function convertEntries(images, reader) {
  return images.map((image) => ({
    name: image.name ?? path.basename(image.path),
    layouts: Array.isArray(image.layouts) ? image.layouts : [image.layout],
    load: () => loadImage(image.path, reader),
  }));
}

async function runConvertSingle(spec, entries, { fsLike, advance }) {
  const { target } = spec;
  if (typeof target !== 'string')
    return { error: '保存先が決まっていません。' };

  advance('read');
  advance('load');
  advance('apply', 0, entries.reduce((sum, entry) => sum + entry.layouts.length, 0), 'ページ');
  const converted = await convertToSingle(entries, TOOLS, { onProgress: (done, total) => advance('apply', done, total, 'ページ') });
  if (converted.ok !== true)
    return converted;

  advance('save');
  let output;
  try {
    output = await converted.doc.save(SAVE_OPTIONS);
  } catch (error) {
    return { error: '変換した内容を組み立てられませんでした。' };
  }

  advance('write');
  // Buffer.from(Uint8Array) は複製する。100 ページの写真では出力が数百 MB になり得るので、
  // 複製せずに同じメモリを指す Buffer で書く（spec-3-2 実測）。
  const written = await writeDocument(target, Buffer.from(output.buffer, output.byteOffset, output.byteLength), { makeBackup: false, expect: null, fsLike });
  if (written.ok !== true)
    return written;
  return { ok: true, path: written.path, bytes: written.bytes, pages: converted.pages, inputs: entries.length, signature: written.signature };
}

async function runConvertEach(spec, entries, { fsLike, advance }) {
  const targets = spec.images.map((image) => image.target);
  if (targets.some((target) => typeof target !== 'string'))
    return { error: '出力先が決まっていません。' };

  advance('read');
  advance('load');
  advance('apply');
  advance('save');
  advance('write', 0, entries.length);
  const converted = await convertToEach(entries, TOOLS, {
    onPart: async (index, doc) => {
      let output;
      try {
        output = await doc.save(SAVE_OPTIONS);
      } catch (error) {
        return { error: `${index + 1} / ${entries.length} 本目の内容を組み立てられませんでした。` };
      }
      const written = await writeDocument(targets[index], Buffer.from(output.buffer, output.byteOffset, output.byteLength), { makeBackup: false, expect: null, fsLike });
      if (written.ok !== true)
        return { error: `${index + 1} / ${entries.length} 本目を書けませんでした。${written.error ?? ''}` };
      return { ok: true };
    },
    onProgress: (done, total) => advance('write', done, total),
  });
  if (converted.ok !== true)
    return converted;
  return { ok: true, written: converted.written, targets, pages: converted.pages };
}

async function runConvert(spec, { fsLike = fs, advance = () => {} } = {}) {
  const { images, output = 'single' } = spec ?? {};
  if (!Array.isArray(images) || images.length === 0)
    return { error: '変換する画像がありません。' };
  if (images.some((image) => typeof image?.path !== 'string'))
    return { error: '変換する画像の場所が分かりません。' };
  if (images.some((image) => (image?.layout === undefined || image.layout === null) && !(Array.isArray(image?.layouts) && image.layouts.length > 0)))
    return { error: '紙の大きさが決まっていません。' };
  if (output !== 'single' && output !== 'each')
    return { error: '出力の方式が決まっていません。' };

  const entries = convertEntries(images, insertReader(fsLike));
  return output === 'each'
    ? runConvertEach(spec, entries, { fsLike, advance })
    : runConvertSingle(spec, entries, { fsLike, advance });
}

module.exports = { runConvert };
