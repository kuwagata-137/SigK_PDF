'use strict';

// 画像を PDF に組む層（spec-3-1 確定事項28〜31）。
//
// 入力は `entries: [{ name, layout: { page, box, allowUpscale }, load }]`。`load()` が
// `{ ok, kind, bytes }` か `{ error }` を返す（loadImage）。紙と箱は pt の数値で受け取る
// だけで、用紙・向き・余白の意味はここに無い（convert-plan.js が決める）。
//
// 【1枚ごとに embed() を呼ぶ】（事前調査 A）
// pdf-lib の embedPng は呼んだ時点で PNG を RGBA へ完全展開し、既定では save() まで
// 抱える。12MP を 30 枚で RSS が +695MB になった。載せた直後に `await image.embed()` を
// 呼ぶと圧縮してコンテキストへ書き込み、増分が1枚ぶん（約 140MB）で頭打ちになる。
// 合計時間は変わらない（save() の仕事を前倒ししているだけ）。
//
// 【PDF → 画像はここに来ない】
// 3-2 の PDF → 画像は pdf.js でキャンバスへ描いたものを書き出す。ワーカーは Node 側で
// canvas を持たないため、その処理だけはレンダラーで行い、書き出しをメインへ渡す。
// 設計の例外である理由は 3-2 の着手時にここへ書く（docs/05 Phase 3）。

const { inspectImageBytes } = require('./image-format.js');
const { embedImage, drawImagePage } = require('./image-page.js');

function withName(name, message) {
  return typeof name === 'string' && name !== '' ? `「${name}」${message}` : message;
}

// 1枚を読んで、画像として載せられるかを確かめる。ワーカー側の防具で、画面（image-io.js）
// と同じ inspectImageBytes を通る（確定事項30）。
async function loadImage(path, { readFile }) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    return { error: '画像を読めませんでした。移動または削除された可能性があります。' };
  }
  const inspected = inspectImageBytes(bytes);
  if (inspected.ok !== true)
    return { error: inspected.error };
  return { ok: true, kind: inspected.kind, bytes };
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0)
    return { error: '変換する画像がありません。' };
  for (const entry of entries) {
    const { page, box } = entry?.layout ?? {};
    if (!(page?.width > 0) || !(page?.height > 0) || !(box?.width > 0) || !(box?.height > 0))
      return { error: withName(entry?.name, '紙の大きさが決まっていません。') };
  }
  return { ok: true };
}

// 1枚を紙に載せてページにする。埋め込んだら bytes は手放す。
async function makePage(doc, entry, tools) {
  const loaded = await entry.load();
  if (loaded.ok !== true)
    return { error: withName(entry.name, loaded.error) };
  const embedded = await embedImage(doc, loaded);
  loaded.bytes = null;
  if (embedded.ok !== true)
    return { error: withName(entry.name, embedded.error) };
  const made = drawImagePage(doc, embedded.image, entry.layout, tools);
  if (made.ok !== true)
    return { error: withName(entry.name, made.error) };
  doc.addPage(made.page);
  await embedded.image.embed();
  return { ok: true };
}

// すべてを1つの文書へ（「まとめる」）。onProgress(done, total) は1枚載せるごとに呼ぶ。
async function convertToSingle(entries, tools, { onProgress = () => {} } = {}) {
  const check = validateEntries(entries);
  if (check.ok !== true)
    return check;
  const doc = await tools.PDFDocument.create();
  for (const [index, entry] of entries.entries()) {
    const made = await makePage(doc, entry, tools);
    if (made.ok !== true)
      return made;
    onProgress(index + 1, entries.length);
  }
  return { ok: true, doc, pages: entries.length };
}

// 1枚ごとに別の文書へ（「画像ごと」）。組んだ文書は onPart(index, doc) へ渡し、呼ぶ側が
// save / write する。onPart が { error } を返したらそこで止め、何本書けたかを添えて返す
// （分割の op-split.js と同じ約束）。
async function convertToEach(entries, tools, { onPart = async () => ({ ok: true }), onProgress = () => {} } = {}) {
  const check = validateEntries(entries);
  if (check.ok !== true)
    return check;
  for (const [index, entry] of entries.entries()) {
    const doc = await tools.PDFDocument.create();
    const made = await makePage(doc, entry, tools);
    if (made.ok !== true)
      return { error: made.error, written: index };
    const handled = await onPart(index, doc);
    if (handled?.error !== undefined)
      return { error: handled.error, written: index };
    onProgress(index + 1, entries.length);
  }
  return { ok: true, written: entries.length };
}

module.exports = { loadImage, validateEntries, convertToSingle, convertToEach };
