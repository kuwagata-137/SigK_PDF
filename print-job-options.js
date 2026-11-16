'use strict';

// 印刷画面の指定を、Electron の webContents.print の設定に組み立てる（docs/spec-7-7-print-dialog.md）。
//
// レンダラーから来た値はそのまま渡さず、型と範囲を確かめてから使う。
// silent の印刷（質問 PR1 案A。Windows の印刷画面を表示せずに直接送る）では、用紙を必ず指定する
// （pageSize と usePrinterDefaultPageSize のどちらも無いと、Electron が例外を出す）。
// 用紙がプリンターの既定と同じ時は usePrinterDefaultPageSize を使う（ドライバーに用紙の番号で渡るため）。
// 違う時だけ、寸法（µm。縦長の向き）を pageSize で渡し、向きは landscape で渡す。
// 余白は 0 にする。用紙 1 枚ぶんの画像の中で、印刷可能領域に収まるように配置してあるため。

const DUPLEX_MODES = new Set(['simplex', 'longEdge', 'shortEdge']);
// Electron の説明にある用紙の寸法の下限（µm）。上限は 5 m とする（それより大きい用紙は無い）。
const MIN_MICRONS = 353;
const MAX_MICRONS = 5000000;
const MAX_COPIES = 999;

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
  if (size === null)
    settings.usePrinterDefaultPageSize = true;
  else
    settings.pageSize = size;
  return settings;
}

module.exports = { MAX_COPIES, buildPrintSettings };
