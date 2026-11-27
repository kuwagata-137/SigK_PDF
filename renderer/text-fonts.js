(function (root) {
  'use strict';

  // テキストと吹き出しの書き込みに使うフォントの一覧の、画面の側（版 1.5.0 の③。質問 FT1「案B Windows フォント使用」。
  // docs/spec-7-11-view-font.md）。画面で描く時の名前（font-family）と、読み戻しで自分のテキストを見分ける /DA のフォント名を、
  // ここ 1 か所で持つ。保存の側の一覧は worker/text-fonts.js で、同じ id と daName を持つ（test/text-fonts.test.js が食い違いを見張る）。
  // 同梱のフォント（Noto Sans JP）の @font-face は shell.css に書く。ほかは Windows に入っているフォントで、このパソコンに入っていて
  // 埋め込んでよいものだけを、メイン（font-catalog.js）から受け取って使える控えにする（setAvailable）。
  //
  //   id       … フォントの識別子（保存の側と同じ）
  //   label    … 画面に表示する名前（プロパティパネルの「フォント」の一覧）
  //   family   … 画面で描く時の font-family
  //   daName   … /DA に書くフォント名（自分で付けたテキストの印。spec-4-2 確定事項13）
  //   bundled  … SigK PDF に同梱するか

  const DEFAULT_FONT_ID = 'noto-sans-jp';

  const font = (id, label, family, daName, bundled = false) => Object.freeze({ id, label, family, daName, bundled });
  const TEXT_FONTS = Object.freeze([
    font('noto-sans-jp', 'Noto Sans JP', 'SigK Noto Sans JP', 'SigKJP', true),
    font('yu-gothic', '游ゴシック', 'Yu Gothic', 'SigKYG'),
    font('yu-mincho', '游明朝', 'Yu Mincho', 'SigKYM'),
    font('meiryo', 'メイリオ', 'Meiryo', 'SigKMR'),
    font('ms-gothic', 'MS ゴシック', 'MS Gothic', 'SigKMG'),
    font('ms-mincho', 'MS 明朝', 'MS Mincho', 'SigKMM'),
  ]);

  // 使えるフォント（id → 太字の書体があるか）。同梱のフォントは初めから使える。
  const available = new Map([[DEFAULT_FONT_ID, true]]);
  const listeners = [];

  function fontById(id) {
    return TEXT_FONTS.find((entry) => entry.id === id) ?? null;
  }

  function defaultFont() {
    return fontById(DEFAULT_FONT_ID);
  }

  function fontByDaName(name) {
    return TEXT_FONTS.find((entry) => entry.daName === name) ?? null;
  }

  // 自分で付けたテキストの /DA のフォント名か。
  function isOwnDaName(name) {
    return fontByDaName(name) !== null;
  }

  // メインが調べた、このパソコンで使えるフォント（[{ id, bold }]。bold は太字の書体があるか）。知らない id は捨てる。
  function setAvailable(list) {
    available.clear();
    available.set(DEFAULT_FONT_ID, true);
    for (const item of Array.isArray(list) ? list : []) {
      if (fontById(item?.id) !== null)
        available.set(item.id, item.bold === true);
    }
    listeners.forEach((listener) => listener());
    return availableFonts();
  }

  function isAvailable(id) {
    return available.has(id);
  }

  // 「フォント」の一覧に並べるフォント（一覧の順）。
  function availableFonts() {
    return TEXT_FONTS.filter((entry) => available.has(entry.id));
  }

  // 書き込みの font の欄から、描く時に使うフォント。無い・このパソコンで使えない時は既定のフォント（質問 FT1 の案B の説明
  // 「そのフォントが入っていないパソコンでは、Noto Sans JP で直す」）。
  function usableFont(id) {
    return id !== undefined && id !== null && available.has(id) ? fontById(id) : defaultFont();
  }

  // 太字の書体があるか（質問 FT3。無いフォントでは［B］を押せない）。
  function hasBold(id) {
    return available.get(usableFont(id).id) === true;
  }

  function onChange(listener) {
    listeners.push(listener);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.textFonts = {
    DEFAULT_FONT_ID, TEXT_FONTS, fontById, defaultFont, fontByDaName, isOwnDaName,
    setAvailable, isAvailable, availableFonts, usableFont, hasBold, onChange,
  };
})(typeof window !== 'undefined' ? window : globalThis);
