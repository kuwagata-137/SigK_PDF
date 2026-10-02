'use strict';

// 同梱フォント（Noto Sans JP）を pdf-lib へ埋め込む口（spec-4-2 確定事項22〜24）。
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

const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'NotoSansJP-Regular.ttf');
const BOLD_FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'NotoSansJP-Bold.ttf');
const FONTKIT_PATH = path.join(__dirname, '..', 'vendor', 'fontkit.umd.min.js');

// /DA と /AP の Resources で使うフォント名。読み込むときに自分の注釈を見分ける印にもなる
// （pdf.js は defaultAppearanceData.fontName にこの名をそのまま返す。spec-4-2 事前調査 C）。太字のテキストは外観の Resources で
// BOLD_FONT_NAME を使い、/DA は太字でも DA_FONT_NAME のまま（自分のテキストの印。spec-4b-4a 確定事項I4）。
const DA_FONT_NAME = 'SigKJP';
const BOLD_FONT_NAME = 'SigKJPB';
const FONT_BASE_NAME = 'NotoSansJP-Regular';
const BOLD_BASE_NAME = 'NotoSansJP-Bold';
const FONT_ERROR = '日本語フォントを読めなかったため、テキストの書き込みを保存できません。';
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

function paddedFontkit(fontkit) {
  return {
    create(bytes, postscriptName) {
      const font = fontkit.create(bytes, postscriptName);
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

// fontkit とフォントの読み込みを 1 度だけ行う口。ワーカーは保存ごとに fork される新プロセス
// なので、実際には 1 プロセス 1 回である（require 43ms・読み 3.5ms。spec-4-2 事前調査 A）。
// load() は標準の書体、loadBold() は太字の書体（読むのは要るときだけ）。
function createFontSource({ fsLike = fs, fontkit = null, fontPath = FONT_PATH, boldPath = BOLD_FONT_PATH } = {}) {
  let loaded = null;
  let bold = null;
  function load() {
    if (loaded !== null)
      return loaded;
    try {
      const kit = paddedFontkit(fontkit ?? require(FONTKIT_PATH));
      loaded = { ok: true, fontkit: kit, bytes: toBytes(fsLike.readFileSync(fontPath)) };
    } catch {
      loaded = { ok: false, error: FONT_ERROR };
    }
    return loaded;
  }
  function loadBold() {
    if (bold !== null)
      return bold;
    const base = load();
    if (!base.ok)
      return base;
    try {
      bold = { ok: true, fontkit: base.fontkit, bytes: toBytes(fsLike.readFileSync(boldPath)) };
    } catch {
      bold = { ok: false, error: FONT_ERROR };
    }
    return bold;
  }
  return { load, loadBold };
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

// 書体を 1 つ埋める。bold なら太字の書体。
async function embedBundledFont(doc, fontSource, { random = Math.random, bold = false } = {}) {
  const loaded = bold ? fontSource.loadBold() : fontSource.load();
  if (!loaded.ok)
    return { error: loaded.error };
  doc.registerFontkit(loaded.fontkit);
  const baseName = bold ? BOLD_BASE_NAME : FONT_BASE_NAME;
  const font = await doc.embedFont(loaded.bytes, { subset: true, customName: `${subsetTag(random)}+${baseName}`, features: FEATURES });
  return { font, measure: measureOf(font, bold ? BOLD_FONT_NAME : DA_FONT_NAME) };
}

module.exports = {
  FONT_PATH, BOLD_FONT_PATH, FONTKIT_PATH, DA_FONT_NAME, BOLD_FONT_NAME, FONT_BASE_NAME, BOLD_BASE_NAME, FONT_ERROR, FEATURES,
  paddedFontkit, subsetTag, createFontSource, measureOf, embedBundledFont,
};
