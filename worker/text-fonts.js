'use strict';

// テキストと吹き出しの書き込みに使うフォントの一覧の、保存の側（版 1.5.0 の③の下準備。docs/spec-7-11-view-font.md）。
// 保存（ワーカー）が使うファイル・PDF の中の名前を、ここ 1 か所で持つ。画面の側の一覧は renderer/text-fonts.js で、同じ id と
// daName を持つ（test/text-fonts.test.js が食い違いを見張る）。フォントを追加する方法は質問 FT1 の回答で決める。
//
//   id            … フォントの識別子（画面の側と同じ）
//   daName        … /DA に書くフォント名。自分で付けたテキストの印で、読み戻しはこの名前で見分ける（spec-4-2 確定事項13）
//   regular・bold … 標準と太字の書体。file はフォントのファイル、baseName はサブセットの名前（BaseFont）の後ろ、
//                   resourceName は外観の Resources で使う名前（spec-4b-4a 確定事項I4）

const path = require('node:path');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

const DEFAULT_FONT_ID = 'noto-sans-jp';

const TEXT_FONTS = Object.freeze([
  Object.freeze({
    id: 'noto-sans-jp',
    daName: 'SigKJP',
    regular: Object.freeze({ file: path.join(FONT_DIR, 'NotoSansJP-Regular.ttf'), baseName: 'NotoSansJP-Regular', resourceName: 'SigKJP' }),
    bold: Object.freeze({ file: path.join(FONT_DIR, 'NotoSansJP-Bold.ttf'), baseName: 'NotoSansJP-Bold', resourceName: 'SigKJPB' }),
  }),
]);

function fontById(id) {
  return TEXT_FONTS.find((font) => font.id === id) ?? null;
}

function defaultFont() {
  return fontById(DEFAULT_FONT_ID);
}

module.exports = { DEFAULT_FONT_ID, TEXT_FONTS, fontById, defaultFont };
