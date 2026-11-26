(function (root) {
  'use strict';

  // テキストと吹き出しの書き込みに使うフォントの一覧の、画面の側（版 1.5.0 の③の下準備。docs/spec-7-11-view-font.md）。
  // 画面で描く時の名前（font-family）と、読み戻しで自分のテキストを見分ける /DA のフォント名を、ここ 1 か所で持つ。
  // 保存の側の一覧は worker/text-fonts.js で、同じ id と daName を持つ（test/text-fonts.test.js が食い違いを見張る）。
  // 同梱のフォントの @font-face は shell.css に書く（CSS からは読めないため。同じ試験が、family が shell.css にあるかを見る）。
  // フォントを追加する方法は質問 FT1 の回答で決める。
  //
  //   id     … フォントの識別子（保存の側と同じ）
  //   label  … 画面に表示する名前
  //   family … 画面で描く時の font-family
  //   daName … /DA に書くフォント名（自分で付けたテキストの印。spec-4-2 確定事項13）

  const DEFAULT_FONT_ID = 'noto-sans-jp';

  const TEXT_FONTS = Object.freeze([
    Object.freeze({ id: 'noto-sans-jp', label: 'Noto Sans JP', family: 'SigK Noto Sans JP', daName: 'SigKJP' }),
  ]);

  function fontById(id) {
    return TEXT_FONTS.find((font) => font.id === id) ?? null;
  }

  function defaultFont() {
    return fontById(DEFAULT_FONT_ID);
  }

  function fontByDaName(name) {
    return TEXT_FONTS.find((font) => font.daName === name) ?? null;
  }

  // 自分で付けたテキストの /DA のフォント名か。
  function isOwnDaName(name) {
    return fontByDaName(name) !== null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.textFonts = { DEFAULT_FONT_ID, TEXT_FONTS, fontById, defaultFont, fontByDaName, isOwnDaName };
})(typeof window !== 'undefined' ? window : globalThis);
