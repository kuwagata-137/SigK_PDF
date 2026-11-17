'use strict';

// 印刷画面の指定を、Electron の webContents.print の設定に組み立てる（docs/spec-7-7-print-dialog.md）。
//
// レンダラーから来た値はそのまま渡さず、型と範囲を確かめてから使う。
// silent の印刷（質問 PR1 案A。Windows の印刷画面を表示せずに直接送る）では、用紙を必ず指定する
// （pageSize・mediaSize・usePrinterDefaultPageSize のどれも無いと、Electron が例外を出す）。
// 用紙がプリンターの既定と同じ時は usePrinterDefaultPageSize を使う（ドライバーに用紙の番号で渡るため）。
// 違う時は、レンダラーから寸法（µm）を受け取り、縦向きにそろえて渡す。向きは landscape で渡す（決定97 ③）。
// - 寸法が NAMED_PAPERS の 8 種のどれかと縦横とも ±1 mm で一致する時は、mediaSize に Windows の用紙番号（vendor_id）を
//   入れて渡す。Chromium は vendor_id を DEVMODE の dmPaperSize に設定する。Chrome の印刷画面も、同じ方法で用紙を指定する。
//   寸法だけ（pageSize）では、Chromium は dmPaperWidth・dmPaperLength だけを書き換え、dmPaperSize は既定の用紙のまま残す
//   ので、用紙番号で用紙を選ぶドライバーでは既定の用紙に印刷される。
// - 一致しない時は、寸法を pageSize で渡す。Electron は、pageSize から name が CUSTOM の mediaSize を組み立てる。
// mediaSize は Electron の非公開オプションである。2026-11-17 に、Electron 44.0.0 が、pageSize を付けずに渡した mediaSize を
// 受け付けることを確認した。pageSize を一緒に渡すと、Electron が mediaSize を組み立て直し、vendor_id が消える。
// Electron を更新する時は、mediaSize を受け付けることを確認し直す。
// 余白は 0 にする。用紙 1 枚ぶんの画像の中で、印刷可能領域に収まるように配置してあるため。

const DUPLEX_MODES = new Set(['simplex', 'longEdge', 'shortEdge']);
// Electron の説明にある用紙の寸法の下限（µm）。上限は 5 m とする（それより大きい用紙は無い）。
const MIN_MICRONS = 353;
const MAX_MICRONS = 5000000;
const MAX_COPIES = 999;
// 用紙番号で渡す用紙（縦向きの寸法 µm）。vendorId は Windows の用紙番号（DMPAPER_*）。name と displayName は、Electron が
// pageSize に指定された名前（'A4' など）から組み立てる mediaSize の name・custom_display_name と同じ書き方にする。
// JIS B4・JIS B5 は Electron に無いので、Chromium の用紙名にする。
const NAMED_PAPERS = Object.freeze([
  { name: 'NA_LETTER', displayName: 'Letter', vendorId: '1', width: 215900, height: 279400 },
  { name: 'NA_LEDGER', displayName: 'Tabloid', vendorId: '3', width: 279400, height: 431800 },
  { name: 'NA_LEGAL', displayName: 'Legal', vendorId: '5', width: 215900, height: 355600 },
  { name: 'ISO_A3', displayName: 'A3', vendorId: '8', width: 297000, height: 420000 },
  { name: 'ISO_A4', displayName: 'A4', vendorId: '9', width: 210000, height: 297000 },
  { name: 'ISO_A5', displayName: 'A5', vendorId: '11', width: 148000, height: 210000 },
  { name: 'JIS_B4', displayName: 'JIS B4', vendorId: '12', width: 257000, height: 364000 },
  { name: 'JIS_B5', displayName: 'JIS B5', vendorId: '13', width: 182000, height: 257000 },
].map((paper) => Object.freeze(paper)));
// 8 種の用紙と一致するとみなす誤差（µm。縦横それぞれ）。プリンターによっては A5 を 148.5 × 210 mm で返す。
const NAMED_TOLERANCE = 1000;

function intInRange(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number))
    return fallback;
  return Math.min(max, Math.max(min, number));
}

function pageSizeFrom(value) {
  if (value === null || typeof value !== 'object')
    return null;
  const width = Math.round(Number(value.width));
  const height = Math.round(Number(value.height));
  const valid = (v) => Number.isFinite(v) && v >= MIN_MICRONS && v <= MAX_MICRONS;
  if (!valid(width) || !valid(height))
    return null;
  return { width: Math.min(width, height), height: Math.max(width, height) };
}

// 縦向きの寸法が 8 種の用紙のどれかと一致すれば、その用紙。無ければ null。
function namedPaperFor(size) {
  const near = (a, b) => Math.abs(a - b) <= NAMED_TOLERANCE;
  return NAMED_PAPERS.find((paper) => near(size.width, paper.width) && near(size.height, paper.height)) ?? null;
}

// webContents.print の mediaSize（Chromium の印刷設定の media_size と同じ形）。印刷可能領域は用紙全体にする。
// Electron が pageSize から組み立てる mediaSize と同じ値で、余白は印刷する画像内に確保してある。
function mediaSizeOf(paper) {
  return {
    name: paper.name,
    custom_display_name: paper.displayName,
    width_microns: paper.width,
    height_microns: paper.height,
    vendor_id: paper.vendorId,
    imageable_area_left_microns: 0,
    imageable_area_bottom_microns: 0,
    imageable_area_right_microns: paper.width,
    imageable_area_top_microns: paper.height,
  };
}

function buildPrintSettings(options = {}) {
  const source = options !== null && typeof options === 'object' ? options : {};
  const settings = { silent: source.silent === true, printBackground: true };
  if (typeof source.deviceName === 'string' && source.deviceName !== '')
    settings.deviceName = source.deviceName;
  if (!settings.silent)
    return settings;

  settings.copies = intInRange(source.copies, 1, MAX_COPIES, 1);
  settings.collate = source.collate !== false;
  settings.color = source.color !== false;
  settings.duplexMode = DUPLEX_MODES.has(source.duplexMode) ? source.duplexMode : 'simplex';
  settings.landscape = source.landscape === true;
  settings.margins = { marginType: 'none' };
  const size = pageSizeFrom(source.pageSize);
  if (size === null) {
    settings.usePrinterDefaultPageSize = true;
    return settings;
  }
  const named = namedPaperFor(size);
  if (named === null)
    settings.pageSize = size;
  else
    settings.mediaSize = mediaSizeOf(named);
  return settings;
}

module.exports = { MAX_COPIES, NAMED_PAPERS, buildPrintSettings };
