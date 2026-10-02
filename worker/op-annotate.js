'use strict';

// 注釈を /Annots へ書く層（spec-4-1 確定事項22〜27、spec-4-2 確定事項22〜26、spec-4-3 確定事項20〜23、
// spec-4-4 確定事項23〜27）。
//
// レンダラーから届く { add, remove } は「ファイルとの差分」である。add[] はマークアップ
// { src, kind, color, opacity, quads, rect } かテキスト { src, kind: 'text', color, opacity, rect,
// text, fontSize, rotation } か図形・ペン { src, kind, color, opacity, rect, lineWidth, paths? } か
// ノート { src, kind: 'note', color, opacity, rect, text, author }
// （src はこの文書のページ番号）、remove[] は pdf.js の id（"86R"）である。applyPlan の**前**に当てる。並べ替えのあとでは src が指すページが変わるためで、
// 当てた注釈はページ実体に付いて一緒に動く。外す側は annotation-remove.js。
//
// テキストは同梱フォントのサブセットを要る保存でだけ 1 度埋める（font-embed.js）。太字の書体は太字のテキストがある保存だけ埋める
// （spec-4b-4a 確定事項I4）。新しい形（折り返す形）のテキストの外観は free-text-wrapped.js が組む。
// 純関数（annotation-appearance.js・free-text-appearance.js・shape-appearance.js・note-appearance.js）が content stream を、
// annotation-fields.js が種類ごとの辞書の欄を組み、ここは pdf-lib の Form XObject と辞書に包む。pdf-lib のクラスは TOOLS で受ける
// （vendor へのパスをここに持たせない）。/Annots の直接操作は inserted-annotations.js と
// 同じ作法にする（page.node.addAnnot() は normalize() が content stream を包み直すので使わない）。

const { appearanceOf } = require('./annotation-appearance.js');
const { freeTextAppearanceOf, isFreeTextEntry } = require('./free-text-appearance.js');
const { isWrapped, isWrappedEntry, wrappedAppearanceOf } = require('./free-text-wrapped.js');
const { shapeAppearanceOf, KINDS: SHAPE_KINDS } = require('./shape-appearance.js');
const { noteAppearanceOf } = require('./note-appearance.js');
const { embedBundledFont, FONT_ERROR } = require('./font-embed.js');
const { parseRef, annotsOf, removeAnnotations } = require('./annotation-remove.js');
const { timestamp, kindFields, popupDict } = require('./annotation-fields.js');

function formStream(context, content, bbox, extra) {
  return context.register(context.stream(content, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: bbox, ...extra }));
}

// 外観の Form XObject。テキストは Resources にそのテキストが使う書体（太字なら太字の書体）も付ける。group の立った外観（不透明度が 1 未満の図形・ペン）は、
// 中身を透明グループの Form に入れて不透明で描き、外側で /GS の不透明度を当てて重ねる（spec-4b-1b 確定事項31。
// 塗りと線、矢印の軸と矢じり、ペンの線どうしが重なっても濃くならない。事前調査 D）。回した四角・丸は外側の Form にだけ
// /Matrix を付ける（spec-4b-2 確定事項29。G0 は回さない）。
function appearanceStream(context, appearance, font) {
  const gs = { Type: 'ExtGState', CA: appearance.opacity, ca: appearance.opacity };
  if (appearance.blend)
    gs.BM = appearance.blend;
  const resources = { ExtGState: { GS: gs } };
  if (font !== null && font !== undefined)
    resources.Font = { [font.measure.name]: font.font.ref };
  const outer = appearance.matrix === undefined ? { Resources: resources } : { Resources: resources, Matrix: appearance.matrix };
  if (appearance.group === true) {
    resources.XObject = { G0: formStream(context, appearance.content, appearance.bbox, { Group: { S: 'Transparency' }, Resources: {} }) };
    return formStream(context, 'q /GS gs /G0 Do Q', appearance.bbox, outer);
  }
  return formStream(context, appearance.content, appearance.bbox, outer);
}

function appendAnnots(page, context, PDFName, refs) {
  const annots = annotsOf(page, context, PDFName);
  if (annots !== null)
    refs.forEach((ref) => annots.push(ref));
  else
    page.node.set(PDFName.of('Annots'), context.obj(refs));
}

// 1 つ足す。外観（Form XObject）を作り、注釈の辞書を登録して /Annots へ並べる。ノートは
// /Popup も一緒に足す。フラグは外観が指定すればそれ（ノートは Print＋NoZoom＋NoRotate）、無ければ Print。
function addAnnotation(doc, page, { entry, appearance }, fonts, tools, now, serial) {
  const { PDFName, PDFString } = tools;
  const context = doc.context;
  const streamRef = appearanceStream(context, appearance, entry.kind === 'text' ? fontOfEntry(fonts, entry) : null);
  const dict = context.obj({
    Type: 'Annot',
    Subtype: appearance.subtype,
    // 回した四角・丸は回した外接（spec-4b-2 確定事項29）。ほかは外観の /BBox と同じ箱。
    Rect: appearance.rect ?? appearance.bbox,
    ...kindFields(entry, appearance, tools, now),
    CA: appearance.opacity,
    F: appearance.flags ?? 4,
    NM: PDFString.of(`sigk-${now.getTime().toString(36)}-${serial}`),
    P: page.ref,
    M: PDFString.of(timestamp(now)),
    AP: { N: streamRef },
  });
  const annotRef = context.register(dict);
  const refs = [annotRef];
  if (appearance.popupRect !== undefined) {
    const popupRef = context.register(popupDict(context, page, annotRef, appearance.popupRect));
    dict.set(PDFName.of('Popup'), popupRef);
    refs.push(popupRef);
  }
  appendAnnots(page, context, PDFName, refs);
  return annotRef;
}

// テキストが使う書体（太字なら太字の書体）。
function fontOfEntry(fonts, entry) {
  return entry.bold === true ? fonts?.bold : fonts?.regular;
}

// 種類ごとの外観。テキストだけフォントの計量が要る。形が違えば null。
function appearanceFor(entry, fonts) {
  if (entry.kind === 'text') {
    const measure = fontOfEntry(fonts, entry)?.measure;
    return isWrapped(entry) ? wrappedAppearanceOf(entry, measure) : freeTextAppearanceOf(entry, measure);
  }
  if (entry.kind === 'note')
    return noteAppearanceOf(entry);
  return SHAPE_KINDS.includes(entry.kind) ? shapeAppearanceOf(entry) : appearanceOf(entry);
}

// 1 件の形が読めるか（テキストはフォント無しで見る。今までの形は太字・斜体を持てない）。
function validAdd(entry) {
  if (entry.kind !== 'text')
    return appearanceFor(entry) !== null;
  return isWrapped(entry) ? isWrappedEntry(entry) : isFreeTextEntry(entry) && entry.bold === undefined && entry.italic === undefined;
}

// add[] の形を先に全部見る。1 つでも違えば何も書かない（validatePlan と同じ流儀）。
function validateAdd(add, pageCount) {
  for (const [index, entry] of add.entries()) {
    if (!Number.isInteger(entry?.src) || entry.src < 0 || entry.src >= pageCount)
      return { error: `書き込み ${index + 1} のページ番号が文書に合いません。` };
    if (!validAdd(entry))
      return { error: `書き込み ${index + 1} の形が読めません。` };
  }
  return null;
}

// テキストがあるときだけフォントを埋める（embedFont を呼ぶと文字が無くても空のサブセットが
// 埋まるため）。標準の書体は太字でないテキスト、太字の書体は太字のテキストがあるときだけ。読めなければ断る。
async function fontsFor(doc, add, fontSource) {
  const texts = add.filter((entry) => entry.kind === 'text');
  if (texts.length === 0)
    return { fonts: null };
  if (fontSource === undefined || fontSource === null)
    return { error: FONT_ERROR };
  const fonts = {};
  for (const bold of [false, true]) {
    if (!texts.some((entry) => (entry.bold === true) === bold))
      continue;
    const embedded = await embedBundledFont(doc, fontSource, { bold });
    if (embedded.error !== undefined)
      return { error: embedded.error };
    fonts[bold ? 'bold' : 'regular'] = embedded;
  }
  return { fonts };
}

// { add, remove } を当てる。戻り値は { ok, added, removed } か { error }。
async function applyAnnotations(doc, { add = [], remove = [] } = {}, tools, { now = new Date(), fontSource = null } = {}) {
  const pages = doc.getPages();
  const invalid = validateAdd(add, pages.length);
  if (invalid !== null)
    return invalid;
  if (!Array.isArray(remove) || remove.some((id) => parseRef(id) === null))
    return { error: '消す書き込みの指定が読めません。' };
  const { fonts, error } = await fontsFor(doc, add, fontSource);
  if (error !== undefined)
    return { error };

  const prepared = add.map((entry) => ({ entry, appearance: appearanceFor(entry, fonts) }));
  const removed = removeAnnotations(doc, remove, tools);
  prepared.forEach((item, serial) => {
    addAnnotation(doc, pages[item.entry.src], item, fonts, tools, now, serial + 1);
  });
  // サブセットを確定させる。save() も flush するが、抽出（copyPages）の前に辞書が要る。
  for (const embedded of Object.values(fonts ?? {}))
    await embedded.font.embed();
  return { ok: true, added: prepared.length, removed };
}

module.exports = { parseRef, applyAnnotations };
