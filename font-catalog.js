'use strict';

// このパソコンで、テキストと吹き出しの書き込みに使えるフォントを調べる（版 1.5.0 の③。質問 FT1「案B Windows フォント使用」。
// docs/spec-7-11-view-font.md）。メインのプロセスで動き、画面の側へ [{ id, bold }] を返す（IPC fonts:list。bold は太字の書体があるか）。
//
// Windows のフォント（worker/text-fonts.js の一覧）は、ファイルがあり、PostScript 名のフォントが見つかり、埋め込みの決まり（OpenType の
// OS/2 の fsType）が「編集できる文書にサブセットで埋め込んでよい」時だけ使える（Microsoft の Font redistribution FAQ）。読むのは
// 初めて聞かれた時の 1 回だけで、結果を覚える（起動を遅くしない）。同梱の Noto Sans JP はいつも使える。

const fs = require('node:fs');
const path = require('node:path');

const { TEXT_FONTS, DEFAULT_FONT_ID } = require('./worker/text-fonts.js');

const FONTKIT_PATH = path.join(__dirname, 'vendor', 'fontkit.umd.min.js');

// fsType のビット（OpenType 仕様の OS/2）。0〜3 は使い方の許可（0 はインストールしてよい・2 は埋め込み不可・4 は表示と印刷だけ・
// 8 は編集できる文書に埋め込んでよい。複数あれば緩い方）、8 はサブセットにしてはいけない、9 はビットマップだけ埋め込んでよい。
const USAGE_MASK = 0x000f;
const EDITABLE = 0x0008;
const NO_SUBSETTING = 0x0100;
const BITMAP_ONLY = 0x0200;

// fontkit は fsType を { noEmbedding, viewOnly, editable, noSubsetting, bitmapOnly } の形で返すので、ビットの数に戻す。
function fsTypeBits(fsType) {
  if (Number.isInteger(fsType))
    return fsType;
  if (typeof fsType !== 'object' || fsType === null)
    return null;
  const flags = [['noEmbedding', 0x0002], ['viewOnly', 0x0004], ['editable', EDITABLE], ['noSubsetting', NO_SUBSETTING], ['bitmapOnly', BITMAP_ONLY]];
  return flags.reduce((bits, [name, bit]) => (fsType[name] === true ? bits | bit : bits), 0);
}

// 編集できる文書（SigK PDF で直せるテキスト）に、サブセットで埋め込んでよいか。
function embeddable(raw) {
  const fsType = fsTypeBits(raw);
  if (fsType === null || (fsType & (NO_SUBSETTING | BITMAP_ONLY)) !== 0)
    return false;
  const usage = fsType & USAGE_MASK;
  return usage === 0 || (usage & EDITABLE) !== 0;
}

// 書体 1 つが使えるか。ファイルが無い・読めない・PostScript 名のフォントが無い・埋め込めない時は false。
async function faceUsable(face, { fsLike, fontkit }) {
  try {
    const bytes = await fsLike.promises.readFile(face.file);
    const font = fontkit.create(bytes, face.postscriptName ?? undefined);
    if (font === null || font === undefined || Array.isArray(font.fonts))
      return false;
    if (face.postscriptName !== null && font.postscriptName !== face.postscriptName)
      return false;
    return embeddable(font['OS/2']?.fsType);
  } catch {
    return false;
  }
}

// [{ id, bold }]。一覧の順で、使えるフォントだけ。同梱のフォントは先頭にいつも入れる。
async function listUsableFonts({ fsLike = fs, fontkit = null } = {}) {
  const kit = fontkit ?? require(FONTKIT_PATH);
  const result = [{ id: DEFAULT_FONT_ID, bold: true }];
  for (const font of TEXT_FONTS) {
    if (font.bundled)
      continue;
    if (!(await faceUsable(font.regular, { fsLike, fontkit: kit })))
      continue;
    const bold = font.bold !== null && (await faceUsable(font.bold, { fsLike, fontkit: kit }));
    result.push({ id: font.id, bold });
  }
  return result;
}

// 1 回だけ調べて覚える口（メインの IPC fonts:list が使う）。
function createFontCatalog(options = {}) {
  let pending = null;
  return {
    list() {
      pending ??= listUsableFonts(options).catch(() => [{ id: DEFAULT_FONT_ID, bold: true }]);
      return pending;
    },
  };
}

module.exports = { FONTKIT_PATH, embeddable, faceUsable, listUsableFonts, createFontCatalog };
