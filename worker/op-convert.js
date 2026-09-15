'use strict';

// 画像を PDF に組む層（spec-3-1 確定事項28〜31・spec-3-2 確定事項20〜23）。
//
// 入力は `entries: [{ name, layouts: [{ page, box, allowUpscale }…], load }]`。`load()` が
// `{ ok, kind, bytes }` か `{ error }` を返す（loadImage）。紙と箱は pt の数値で受け取る
// だけで、用紙・向き・余白の意味はここに無い（convert-plan.js が決める）。
// 1エントリ＝1ファイルで、`layouts` はページ数ぶん（複数ページの TIFF。それ以外は1つ）。
//
// 【1枚ごとに embed() を呼ぶ】（事前調査 A）
// pdf-lib の embedPng は呼んだ時点で PNG を RGBA へ完全展開し、既定では save() まで
// 抱える。12MP を 30 枚で RSS が +695MB になった。載せた直後に `await image.embed()` を
// 呼ぶと圧縮してコンテキストへ書き込み、増分が1枚ぶん（約 140MB）で頭打ちになる。
// 合計時間は変わらない（save() の仕事を前倒ししているだけ）。
// BMP・GIF・TIFF は pixel-image.js が埋め込んだ時点で圧縮済みなので、ここの embed() は何もしない。
//
// 【PDF → 画像はここに来ない — 設計の例外】（docs/05 Phase 3・spec-3-3 確定事項26）
// ほかのツール（結合・分割・画像→PDF）は「レンダラーが計画を組み、ワーカーが実体を
// 書く」向きで揃えてある。PDF → 画像（renderer/tools-to-image.js）だけは逆で、
// **レンダラーが pdf.js で 1 ページずつ canvas に描いて PNG／JPEG のバイト列にし、メインは
// それをファイルに書くだけ**である（main.js の image:write → image-io.js の writeImage）。
//
// 理由は 1 つで、pdf.js の描画は DOM の canvas（か OffscreenCanvas）を要し、ワーカー
// （utilityProcess ＝ Node 側）には canvas が無いからである。ワーカーへ移すには Node で
// 動く canvas の実装（ネイティブ依存）を足すことになり、依存とインストーラーが膨らむ。
// 描画そのものは軽く（300dpi の A4 で 3〜10ms。重いのは PNG 化の 25〜38ms）、
// レンダラーで 1 ページずつ描いて捨てれば画面は固まらない（spec-3-3 事前調査 A・B）。
// 帯・中止・二重起動の防止は save.js の runLocal に載せ、ワーカー経路と同じ枠に見せている。

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
  return { ok: true, kind: inspected.kind, bytes, pages: inspected.pages };
}

function validLayout(layout) {
  const { page, box } = layout ?? {};
  return page?.width > 0 && page?.height > 0 && box?.width > 0 && box?.height > 0;
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0)
    return { error: '変換する画像がありません。' };
  for (const entry of entries) {
    if (!Array.isArray(entry?.layouts) || entry.layouts.length === 0 || !entry.layouts.every(validLayout))
      return { error: withName(entry?.name, '紙の大きさが決まっていません。') };
  }
  return { ok: true };
}

function totalPages(entries) {
  return entries.reduce((sum, entry) => sum + entry.layouts.length, 0);
}

// 1ページを紙に載せて文書へ足す。
async function addPage(doc, entry, loaded, frame, tools) {
  const embedded = await embedImage(doc, loaded, tools, { frame });
  if (embedded.ok !== true)
    return { error: withName(entry.name, embedded.error) };
  const made = drawImagePage(doc, embedded.image, entry.layouts[frame], tools);
  if (made.ok !== true)
    return { error: withName(entry.name, made.error) };
  doc.addPage(made.page);
  await embedded.image.embed();
  return { ok: true };
}

// 1ファイルの全ページを載せる。載せ終えたら bytes は手放す。onPage(done) はページごと。
async function addFile(doc, entry, tools, onPage) {
  const loaded = await entry.load();
  if (loaded.ok !== true)
    return { error: withName(entry.name, loaded.error) };
  if (Number.isInteger(loaded.pages) && loaded.pages < entry.layouts.length)
    return { error: withName(entry.name, '画像のページ数が一覧に入れたときと違います。もう一度足してください。') };
  for (let frame = 0; frame < entry.layouts.length; frame += 1) {
    const added = await addPage(doc, entry, loaded, frame, tools);
    if (added.ok !== true) {
      loaded.bytes = null;
      return added;
    }
    onPage();
  }
  loaded.bytes = null;
  return { ok: true };
}

// すべてを1つの文書へ（「まとめる」）。onProgress(done, total) は1ページ載せるごとに呼ぶ。
async function convertToSingle(entries, tools, { onProgress = () => {} } = {}) {
  const check = validateEntries(entries);
  if (check.ok !== true)
    return check;
  const doc = await tools.PDFDocument.create();
  const total = totalPages(entries);
  let done = 0;
  for (const entry of entries) {
    const added = await addFile(doc, entry, tools, () => { done += 1; onProgress(done, total); });
    if (added.ok !== true)
      return added;
  }
  return { ok: true, doc, pages: total };
}

// 1ファイルごとに別の文書へ（「画像ごと」）。組んだ文書は onPart(index, doc) へ渡し、呼ぶ側が
// save / write する。onPart が { error } を返したらそこで止め、何本書けたかを添えて返す
// （分割の op-split.js と同じ約束）。onProgress(done, total) はファイル単位。
async function convertToEach(entries, tools, { onPart = async () => ({ ok: true }), onProgress = () => {} } = {}) {
  const check = validateEntries(entries);
  if (check.ok !== true)
    return check;
  const pages = [];
  for (const [index, entry] of entries.entries()) {
    const doc = await tools.PDFDocument.create();
    const added = await addFile(doc, entry, tools, () => {});
    if (added.ok !== true)
      return { error: added.error, written: index };
    const handled = await onPart(index, doc);
    if (handled?.error !== undefined)
      return { error: handled.error, written: index };
    pages.push(entry.layouts.length);
    onProgress(index + 1, entries.length);
  }
  return { ok: true, written: entries.length, pages };
}

module.exports = { loadImage, validateEntries, totalPages, convertToSingle, convertToEach };
