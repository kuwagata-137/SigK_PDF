'use strict';

// テキストのフォントを pdf-lib へ埋め込む口（spec-4-2 確定事項22〜24）。版 1.5.0 の③（質問 FT1「案B」）で、同梱の Noto Sans JP の
// ほかに、Windows のフォント（worker/text-fonts.js の一覧。.ttc は PostScript 名で選ぶ）も、書き込みのフォントごとに埋めるようにした。
//
// fontkit は vendor から、フォントは assets から path.join で読む（配布物に node_modules は
// 無い。docs/07 決定18）。どちらも test/dist-files.test.js が build.files に入ることを見張る。
//
// 埋めるのは「文字を知る口」（measure）を通した字だけである。pdf-lib のサブセットは
// encodeText を通したグリフからしか作られないので、/AP に書く行は必ず encode を通す。
// テキスト注釈のある保存だけ、保存 1 回につき 1 度埋める（embedFont を呼ぶと文字が無くても
// 空のサブセットが埋まるため。呼び分けは op-annotate.js）。太字の書体（Bold）は太字のテキストがある保存だけ埋める
// （spec-4b-4a 確定事項I4）。どちらも合字を切る（画面の font-variant-ligatures: none と字の並びをそろえる。事前調査 E）。

const fs = require('node:fs');
const path = require('node:path');

const { toBytes } = require('../file-io.js');

const { failure, passFailure } = require('./task-failure.js');
const { DEFAULT_FONT_ID, defaultFont, fontById } = require('./text-fonts.js');

// フォントのファイルと名前は、フォントの一覧（text-fonts.js。版 1.5.0 の③の下準備）の既定のフォントから取る。
const DEFAULT_FONT = defaultFont();
const FONT_PATH = DEFAULT_FONT.regular.file;
const BOLD_FONT_PATH = DEFAULT_FONT.bold.file;
const FONTKIT_PATH = path.join(__dirname, '..', 'vendor', 'fontkit.umd.min.js');

// /DA と /AP の Resources で使うフォント名。読み込むときに自分の注釈を見分ける印にもなる
// （pdf.js は defaultAppearanceData.fontName にこの名をそのまま返す。spec-4-2 事前調査 C）。太字のテキストは外観の Resources で
// BOLD_FONT_NAME を使い、/DA は太字でも DA_FONT_NAME のまま（自分のテキストの印。spec-4b-4a 確定事項I4）。
const DA_FONT_NAME = DEFAULT_FONT.regular.resourceName;
const BOLD_FONT_NAME = DEFAULT_FONT.bold.resourceName;
const FONT_BASE_NAME = DEFAULT_FONT.regular.baseName;
const BOLD_BASE_NAME = DEFAULT_FONT.bold.baseName;
const FONT_ERROR = '日本語フォントを読み込めなかったため、テキストの書き込みを保存できません。';
// 合字を切る（fontkit の layout が fi・ff などを 1 字にまとめると、画面の行の幅と食い違う）。
const FEATURES = Object.freeze({ liga: false });

// fontkit の TTF サブセットは、loca が短い形式（合計 64KB 未満）のとき奇数長のグリフを詰めず、
// offsets を半分にする段で切り捨てて以降のグリフが 1 バイトずれる（spec-4-2 事前調査 B 不具合1）。
// createSubset() が返すサブセットの _addGlyph を包み、奇数長なら 1 バイト詰めて offset も進める。
// pdf-lib の中には手を入れず、registerFontkit へ渡す fontkit を包む形にする。
function paddedSubset(subset) {
  const proto = Object.getPrototypeOf(subset);
  subset._addGlyph = function addGlyphPadded(gid) {
    const index = proto._addGlyph.call(this, gid);
    const buffer = this.glyf[index];
    if (buffer.length % 2 === 0)
      return index;
    // fontkit は同梱の Buffer 実装で書き出すので、同じ型で作る（Node の Buffer は弾かれる）。
    const Bytes = buffer.constructor;
    this.glyf[index] = Bytes.concat([buffer, Bytes.alloc(1)]);
    this.offset += 1;
    return index;
  };
  return subset;
}

// postscriptName を渡すと、.ttc（複数のフォントを 1 つにしたファイル）からその名前のフォントを選ぶ（pdf-lib は名前を渡さずに
// create を呼ぶため、ここで決めておく）。
function paddedFontkit(fontkit, postscriptName = null) {
  return {
    create(bytes, name) {
      const font = fontkit.create(bytes, postscriptName ?? name);
      if (font === null || font === undefined || Array.isArray(font.fonts))
        throw new Error(`フォント ${postscriptName ?? name ?? ''} が見つかりません`);
      const createSubset = font.createSubset.bind(font);
      font.createSubset = () => paddedSubset(createSubset());
      return font;
    },
  };
}

// サブセットのタグ（PDF 32000-1 9.6.4。同じファイルの別のサブセットは別のタグにする）。
function subsetTag(random = Math.random) {
  let tag = '';
  for (let index = 0; index < 6; index += 1)
    tag += String.fromCharCode(65 + Math.min(25, Math.floor(random() * 26)));
  return tag;
}

// fontkit とフォントの読み込みを書体ごとに 1 度だけ行う口。ワーカーは保存ごとに fork される新プロセス
// なので、実際には 1 プロセス 1 回である（require 43ms・読み 3.5ms。spec-4-2 事前調査 A）。
// loadFace(fontId, bold) はフォントと太字かで選んだ書体（読むのは要るときだけ）。load() は既定のフォントの標準、loadBold() は太字。
// fontPath・boldPath は既定のフォント（Noto Sans JP）のファイルの差し替え（試験）。
function createFontSource({ fsLike = fs, fontkit = null, fontPath = FONT_PATH, boldPath = BOLD_FONT_PATH } = {}) {
  const loaded = new Map();
  let base = null;
  function fontkitBase() {
    base ??= fontkit ?? require(FONTKIT_PATH);
    return base;
  }
  function fileOf(font, bold) {
    if (font.id === DEFAULT_FONT_ID)
      return bold ? boldPath : fontPath;
    return (bold ? font.bold : font.regular).file;
  }
  function loadFace(fontId = DEFAULT_FONT_ID, bold = false) {
    const key = `${fontId}:${bold ? 'bold' : 'regular'}`;
    if (loaded.has(key))
      return loaded.get(key);
    const font = fontById(fontId);
    let result;
    try {
      if (font === null || (bold && font.bold === null))
        throw new Error(`フォント ${fontId} の書体がありません`);
      const face = bold ? font.bold : font.regular;
      result = { ok: true, fontkit: paddedFontkit(fontkitBase(), face.postscriptName), bytes: toBytes(fsLike.readFileSync(fileOf(font, bold))), face };
    } catch (error) {
      result = { ok: false, ...failure(FONT_ERROR, error) };
    }
    loaded.set(key, result);
    return result;
  }
  return { loadFace, load: () => loadFace(DEFAULT_FONT_ID, false), loadBold: () => loadFace(DEFAULT_FONT_ID, true) };
}

// 純関数（free-text-appearance.js）へ渡す「文字を知る口」。name は外観の Resources で使う名前。
function measureOf(font, name = DA_FONT_NAME) {
  return {
    name,
    font,
    encode: (line) => font.encodeText(line).asString(),
    width: (line, size) => font.widthOfTextAtSize(line, size),
  };
}

// 書体を 1 つ埋める。fontId はフォント（既定は Noto Sans JP）、bold なら太字の書体。
async function embedBundledFont(doc, fontSource, { random = Math.random, bold = false, fontId = DEFAULT_FONT_ID } = {}) {
  const loaded = typeof fontSource.loadFace === 'function' ? fontSource.loadFace(fontId, bold) : bold ? fontSource.loadBold() : fontSource.load();
  if (!loaded.ok)
    return passFailure(loaded);
  doc.registerFontkit(loaded.fontkit);
  const face = loaded.face ?? (bold ? DEFAULT_FONT.bold : DEFAULT_FONT.regular);
  try {
    const font = await doc.embedFont(loaded.bytes, { subset: true, customName: `${subsetTag(random)}+${face.baseName}`, features: FEATURES });
    return { font, measure: measureOf(font, face.resourceName) };
  } catch (error) {
    return failure(FONT_ERROR, error);
  }
}

module.exports = {
  FONT_PATH, BOLD_FONT_PATH, FONTKIT_PATH, DA_FONT_NAME, BOLD_FONT_NAME, FONT_BASE_NAME, BOLD_BASE_NAME, FONT_ERROR, FEATURES,
  paddedFontkit, subsetTag, createFontSource, measureOf, embedBundledFont,
};
