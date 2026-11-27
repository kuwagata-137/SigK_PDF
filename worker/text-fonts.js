'use strict';

// テキストと吹き出しの書き込みに使うフォントの一覧の、保存の側（版 1.5.0 の③。質問 FT1「案B Windows フォント使用」。
// docs/spec-7-11-view-font.md）。保存（ワーカー）と、使えるフォントを調べるメイン（font-catalog.js）が使うファイル・PDF の中の名前を、
// ここ 1 か所で持つ。画面の側の一覧は renderer/text-fonts.js で、同じ id と daName を持つ（test/text-fonts.test.js が食い違いを見張る）。
//
// 同梱するのは Noto Sans JP だけで、ほかは Windows に入っているフォントを使う（同梱はしない。Microsoft の Font redistribution FAQ は、
// 埋め込みの決まり〔OpenType の fsType〕に従うアプリが作る文書への埋め込みを認めている）。そのフォントが入っていないパソコンでは
// 一覧に並べない（font-catalog.js）。
//
//   id            … フォントの識別子（画面の側と同じ）
//   daName        … /DA に書くフォント名。自分で付けたテキストの印で、読み戻しはこの名前で見分ける（spec-4-2 確定事項13）。
//                   標準の書体の resourceName と同じ
//   regular・bold … 標準と太字の書体。file はフォントのファイル、postscriptName は .ttc（複数のフォントを 1 つにしたファイル）から
//                   選ぶ名前（.ttf は null）、baseName はサブセットの名前（BaseFont）の後ろ、resourceName は外観の Resources で使う名前
//                   （spec-4b-4a 確定事項I4）。太字の書体が無いフォントは bold が null（質問 FT3）
//   dsFamily      … /DS（既定の書式）に書くフォント名（ほかのアプリが外観を作り直す時に使う。worker/default-style.js）

const path = require('node:path');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
// Windows のフォントのフォルダ。SIGK_FONT_DIR は試験と起動確認の差し替え（Windows のフォントを読ませない時は、空のフォルダを渡す）。
const SYSTEM_FONT_DIR = process.env.SIGK_FONT_DIR || path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');

const DEFAULT_FONT_ID = 'noto-sans-jp';

function face(dir, file, postscriptName, resourceName) {
  return Object.freeze({ file: path.join(dir, file), postscriptName, baseName: postscriptName ?? path.parse(file).name, resourceName });
}

function systemFont(id, dsFamily, regular, bold) {
  const [file, postscriptName, resourceName] = regular;
  return Object.freeze({
    id,
    daName: resourceName,
    dsFamily,
    bundled: false,
    regular: face(SYSTEM_FONT_DIR, file, postscriptName, resourceName),
    bold: bold === null ? null : face(SYSTEM_FONT_DIR, ...bold),
  });
}

const TEXT_FONTS = Object.freeze([
  Object.freeze({
    id: 'noto-sans-jp',
    daName: 'SigKJP',
    dsFamily: 'Noto Sans JP',
    bundled: true,
    regular: Object.freeze({ file: path.join(FONT_DIR, 'NotoSansJP-Regular.ttf'), postscriptName: null, baseName: 'NotoSansJP-Regular', resourceName: 'SigKJP' }),
    bold: Object.freeze({ file: path.join(FONT_DIR, 'NotoSansJP-Bold.ttf'), postscriptName: null, baseName: 'NotoSansJP-Bold', resourceName: 'SigKJPB' }),
  }),
  // PostScript 名は、Chromium のフォント一覧の機能（queryLocalFonts）で Windows 11 の名前を確かめた（2026-11-27）。
  systemFont('yu-gothic', 'Yu Gothic', ['YuGothR.ttc', 'YuGothic-Regular', 'SigKYG'], ['YuGothB.ttc', 'YuGothic-Bold', 'SigKYGB']),
  systemFont('yu-mincho', 'Yu Mincho', ['yumin.ttf', 'YuMincho-Regular', 'SigKYM'], ['yumindb.ttf', 'YuMincho-Demibold', 'SigKYMB']),
  systemFont('meiryo', 'Meiryo', ['meiryo.ttc', 'Meiryo', 'SigKMR'], ['meiryob.ttc', 'Meiryo-Bold', 'SigKMRB']),
  systemFont('ms-gothic', 'MS Gothic', ['msgothic.ttc', 'MS-Gothic', 'SigKMG'], null),
  systemFont('ms-mincho', 'MS Mincho', ['msmincho.ttc', 'MS-Mincho', 'SigKMM'], null),
]);

function fontById(id) {
  return TEXT_FONTS.find((font) => font.id === id) ?? null;
}

function defaultFont() {
  return fontById(DEFAULT_FONT_ID);
}

// 書き込みの font の欄（無ければ既定のフォント）から、フォントを引く。知らない id は null。
function fontOfEntry(entry) {
  return entry?.font === undefined ? defaultFont() : fontById(entry.font);
}

// 擬似太字の線の太さ（字の大きさに掛ける）。文字の輪郭に、この太さの線を追加して太く見せる（質問 FT3「案B 擬似太字」。
// 質問の図の見本と、spec-4b-4a 事前調査 B の検体と同じ 30 分の 1。画面の側は renderer/free-text-font.js の SYNTHETIC_BOLD_RATIO）。
const SYNTHETIC_BOLD_RATIO = 1 / 30;

// 書き込みに使う書体。太字の書体が無いフォント（MS ゴシック・MS 明朝）の太字は、標準の書体で描き、synthetic（擬似太字）を true にする。
function faceOfEntry(entry) {
  const font = fontOfEntry(entry);
  if (font === null)
    return null;
  if (entry?.bold !== true)
    return { font, bold: false, synthetic: false, face: font.regular };
  return font.bold !== null ? { font, bold: true, synthetic: false, face: font.bold } : { font, bold: false, synthetic: true, face: font.regular };
}

module.exports = { DEFAULT_FONT_ID, SYSTEM_FONT_DIR, SYNTHETIC_BOLD_RATIO, TEXT_FONTS, fontById, defaultFont, fontOfEntry, faceOfEntry };
