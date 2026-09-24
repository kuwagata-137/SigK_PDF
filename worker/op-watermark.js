'use strict';

// 透かしをページへ足す（spec-4-5 確定事項20〜26）。pdf-lib の道具は TOOLS で受け取る
// （ワーカーは vendor の、テストは node_modules の pdf-lib。混ぜると PDFName の突き合わせが外れる）。
//
// 透かしの Form XObject は文書に 1 つだけ作り、対象ページの Resources に固定名 SigKWM で置いて、
// 内容の末尾に 1 行足す（Resources を共有する PDF でもキーは 1 つ。事前調査 A）。前面だけ（論点2）。
// 文字は字形の輪郭で描き（glyph-outline.js。論点1）、フォントは埋めない。画像は PNG・JPEG だけを
// 1 回だけ埋める（論点7。PNG の透過は SMask で保たれる。事前調査 B）。

const { ANGLES, SIZE_RATIOS, POSITIONS, placementOf, matrixText } = require('./watermark-layout.js');
const { outlineOf } = require('./glyph-outline.js');
const { isOpacity, textMarkOf, imageMarkOf } = require('./watermark-appearance.js');
const { parseColor } = require('./annotation-appearance.js');
const { detectFormat, isProgressiveJpeg } = require('./image-format.js');
const { embedImage } = require('./image-page.js');

const WATERMARK_NAME = 'SigKWM';
const MAX_TEXT_LENGTH = 50;
const WATERMARK_FONT_ERROR = '日本語フォントを読めなかったため、文字の透かしを入れられません。';
// 透かしの行を包む印（ページ付けの付随物のうちの透かし。読み上げなどが本文と見分けられる）。
const ARTIFACT_OPEN = '/Artifact <</Type /Pagination /Subtype /Watermark>> BDC';
const IMAGE_KINDS = new Set(['png', 'jpeg']);

// 0 始まり・範囲内・重複なし・昇順（レンダラーが集合にして渡す。確定事項25）。
function validPages(pages, pageCount) {
  return Array.isArray(pages) && pages.length > 0 && pages.every((page, index) =>
    Number.isInteger(page) && page >= 0 && page < pageCount && (index === 0 || page > pages[index - 1]));
}

// 文字そのものの検査は textForm が、分かりやすい文言で行う。
function validMark(mark) {
  if (mark?.type !== 'text' && mark?.type !== 'image')
    return false;
  if (!Object.values(ANGLES).includes(mark.angle) || !Object.hasOwn(SIZE_RATIOS, mark.size) || !POSITIONS.includes(mark.position))
    return false;
  if (!isOpacity(mark.opacity))
    return false;
  return mark.type === 'text' ? parseColor(mark.color) !== null : typeof mark.image === 'string' && mark.image !== '';
}

// 1 行に整える（制御文字は空白に、前後の空白は落とす）。レンダラーも同じに整えて渡す。
function normalizeText(text) {
  return typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
}

function textForm(mark, fontSource) {
  const text = normalizeText(mark.text);
  if (text === '')
    return { error: '透かしの文字を入れてください。' };
  if (text.length > MAX_TEXT_LENGTH)
    return { error: `透かしの文字は ${MAX_TEXT_LENGTH} 文字までです。` };
  const loaded = fontSource.load();
  if (loaded.ok !== true)
    return { error: WATERMARK_FONT_ERROR };
  const appearance = textMarkOf(outlineOf(loaded.fontkit.create(loaded.bytes), text), mark);
  if (appearance === null)
    return { error: '透かしの文字を描けません。' };
  return { ok: true, appearance, resources: {} };
}

async function imageForm(doc, mark, TOOLS, readFile) {
  let bytes;
  try {
    bytes = await readFile(mark.image);
  } catch {
    return { error: '透かしの画像を読めませんでした。' };
  }
  const kind = detectFormat(bytes);
  if (!IMAGE_KINDS.has(kind))
    return { error: 'PNG か JPEG の画像を選んでください。' };
  if (kind === 'jpeg' && isProgressiveJpeg(bytes))
    return { error: 'この JPEG は透かしに使えません（プログレッシブ形式）。' };
  const embedded = await embedImage(doc, { kind, bytes }, TOOLS);
  if (embedded.ok !== true)
    return embedded;
  const appearance = imageMarkOf({ width: embedded.image.width, height: embedded.image.height, opacity: mark.opacity });
  if (appearance === null)
    return { error: '画像の大きさを読み取れませんでした。' };
  return { ok: true, appearance, resources: { XObject: { Im: embedded.image.ref } } };
}

// 透かしの Form XObject を文書に 1 つ登録する。中身は Flate で縮める（文字の輪郭は数 KB になる）。
function registerForm(doc, { appearance, resources }) {
  const { context } = doc;
  const gs = { Type: 'ExtGState', ca: appearance.opacity, CA: appearance.opacity };
  return context.register(context.flateStream(appearance.content, {
    Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: appearance.bbox,
    Resources: { ExtGState: { GS: gs }, ...resources },
  }));
}

// ページの Resources の /XObject に名前を取る。SigKWM が空いていればそれ、同じ XObject なら使い回し、
// 別のものが居れば SigKWM1・SigKWM2… の空いている名前（確定事項23）。
function xobjectName(page, ref, { PDFName }) {
  const dict = page.node.normalizedEntries().XObject;
  for (let index = 0; index < 1000; index += 1) {
    const name = index === 0 ? WATERMARK_NAME : `${WATERMARK_NAME}${index}`;
    const current = dict.get(PDFName.of(name));
    if (current === undefined) {
      dict.set(PDFName.of(name), ref);
      return name;
    }
    if (current.objectNumber === ref.objectNumber && current.generationNumber === ref.generationNumber)
      return name;
  }
  return null;
}

function cropBoxOf(page) {
  const { x, y, width, height } = page.getCropBox();
  return [x, y, x + width, y + height];
}

// 透かしを当てる。戻り値は { ok, pages } か { error }。
//   spec.pages … 0 始まりのページ番号（重複なし・昇順）
//   spec.mark  … { type: 'text', text, color, … } か { type: 'image', image（パス）, … }。
//                共通の欄は opacity・angle（45・0）・size（small・medium・large）・position（9 か所）
//   deps       … fontSource（同梱フォントの口）と readFile（画像のパスからバイト列を読む口）
async function applyWatermark(doc, { pages, mark }, TOOLS, { fontSource, readFile } = {}) {
  if (!validPages(pages, doc.getPageCount()))
    return { error: '透かしを入れるページが正しくありません。' };
  if (!validMark(mark))
    return { error: '透かしの設定が読めません。' };
  const form = mark.type === 'text' ? textForm(mark, fontSource) : await imageForm(doc, mark, TOOLS, readFile);
  if (form.ok !== true)
    return form;

  const ref = registerForm(doc, form);
  const { width, height } = form.appearance;
  for (const index of pages) {
    const page = doc.getPage(index);
    const matrix = placementOf({
      box: cropBoxOf(page), rotate: page.getRotation().angle, width, height,
      angle: mark.angle, size: mark.size, position: mark.position,
    });
    const name = matrix === null ? null : xobjectName(page, ref, TOOLS);
    if (name === null)
      return { error: `${index + 1} ページ目に透かしを置けません。` };
    const line = `${ARTIFACT_OPEN} q ${matrixText(matrix)} cm /${name} Do Q EMC`;
    page.node.addContentStream(doc.context.register(doc.context.stream(line)));
  }
  return { ok: true, pages: pages.length };
}

module.exports = { WATERMARK_NAME, MAX_TEXT_LENGTH, WATERMARK_FONT_ERROR, normalizeText, applyWatermark };
