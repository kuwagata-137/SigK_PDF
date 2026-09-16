'use strict';

// 注釈を /Annots へ書く層（spec-4-1 確定事項22〜27、spec-4-2 確定事項22〜26）。
//
// レンダラーから届く { add, remove } は「ファイルとの差分」である。add[] はマークアップ
// { src, kind, color, opacity, quads, rect } かテキスト { src, kind: 'text', color, opacity, rect,
// text, fontSize, rotation }（src はこの文書のページ番号）、remove[] は pdf.js の id（"86R"）で
// ある。applyPlan の**前**に当てる。並べ替えのあとでは src が指すページが変わるためで、
// 当てた注釈はページ実体に付いて一緒に動く。外す側は annotation-remove.js。
//
// テキストは同梱フォントのサブセットを要る保存でだけ 1 度埋める（font-embed.js）。
// 純関数（annotation-appearance.js・free-text-appearance.js）が content stream を組み、
// ここは pdf-lib の Form XObject と辞書に包む。pdf-lib のクラスは TOOLS で受ける
// （vendor へのパスをここに持たせない）。/Annots の直接操作は inserted-annotations.js と
// 同じ作法にする（page.node.addAnnot() は normalize() が content stream を包み直すので使わない）。

const { appearanceOf } = require('./annotation-appearance.js');
const { freeTextAppearanceOf, isFreeTextEntry } = require('./free-text-appearance.js');
const { embedBundledFont, FONT_ERROR } = require('./font-embed.js');
const { parseRef, annotsOf, removeAnnotations } = require('./annotation-remove.js');

function timestamp(now) {
  const pad = (value) => String(value).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return `D:${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${sign}${hours}'${minutes}'`;
}

// 外観の Form XObject。テキストは Resources にフォントも付ける。
function appearanceStream(context, appearance, font) {
  const gs = { Type: 'ExtGState', CA: appearance.opacity, ca: appearance.opacity };
  if (appearance.blend)
    gs.BM = appearance.blend;
  const resources = { ExtGState: { GS: gs } };
  if (font !== null)
    resources.Font = { [font.measure.name]: font.font.ref };
  return context.register(context.stream(appearance.content, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: appearance.bbox,
    Resources: resources,
  }));
}

// 種類ごとの欄。マークアップは /QuadPoints と /C、テキストは /Contents・/DA・/Border・/Rotate
// （spec-4-2 確定事項25。/C は箱の背景色に使うビューアがあるので書かない）。
function kindFields(entry, appearance, { PDFString, PDFHexString }) {
  if (entry.kind !== 'text') {
    return { QuadPoints: entry.quads.flat(), C: appearance.rgb, Contents: PDFString.of('') };
  }
  const fields = {
    Contents: PDFHexString.fromText(entry.text),
    DA: PDFString.of(appearance.da),
    Border: [0, 0, 0],
  };
  if (entry.rotation !== 0)
    fields.Rotate = entry.rotation;
  return fields;
}

// 1 つ足す。外観（Form XObject）を作り、注釈の辞書を登録して /Annots へ並べる。
function addAnnotation(doc, page, { entry, appearance }, font, tools, now, serial) {
  const { PDFName, PDFString } = tools;
  const context = doc.context;
  const streamRef = appearanceStream(context, appearance, entry.kind === 'text' ? font : null);
  const dict = context.obj({
    Type: 'Annot',
    Subtype: appearance.subtype,
    Rect: appearance.bbox,
    ...kindFields(entry, appearance, tools),
    CA: appearance.opacity,
    F: 4,
    NM: PDFString.of(`sigk-${now.getTime().toString(36)}-${serial}`),
    P: page.ref,
    M: PDFString.of(timestamp(now)),
    AP: { N: streamRef },
  });
  const annotRef = context.register(dict);
  const annots = annotsOf(page, context, PDFName);
  if (annots !== null)
    annots.push(annotRef);
  else
    page.node.set(PDFName.of('Annots'), context.obj([annotRef]));
  return annotRef;
}

// add[] の形を先に全部見る。1 つでも違えば何も書かない（validatePlan と同じ流儀）。
function validateAdd(add, pageCount) {
  for (const [index, entry] of add.entries()) {
    if (!Number.isInteger(entry?.src) || entry.src < 0 || entry.src >= pageCount)
      return { error: `注釈 ${index + 1} のページ番号が文書に合いません。` };
    const valid = entry.kind === 'text' ? isFreeTextEntry(entry) : appearanceOf(entry) !== null;
    if (!valid)
      return { error: `注釈 ${index + 1} の形が読めません。` };
  }
  return null;
}

// テキストがあるときだけフォントを埋める（embedFont を呼ぶと文字が無くても空のサブセットが
// 埋まるため）。読めなければ断る。
async function fontFor(doc, add, fontSource) {
  if (!add.some((entry) => entry.kind === 'text'))
    return { font: null };
  if (fontSource === undefined || fontSource === null)
    return { error: FONT_ERROR };
  const embedded = await embedBundledFont(doc, fontSource);
  return embedded.error === undefined ? { font: embedded } : { error: embedded.error };
}

// { add, remove } を当てる。戻り値は { ok, added, removed } か { error }。
async function applyAnnotations(doc, { add = [], remove = [] } = {}, tools, { now = new Date(), fontSource = null } = {}) {
  const pages = doc.getPages();
  const invalid = validateAdd(add, pages.length);
  if (invalid !== null)
    return invalid;
  if (!Array.isArray(remove) || remove.some((id) => parseRef(id) === null))
    return { error: '消す注釈の指定が読めません。' };
  const { font, error } = await fontFor(doc, add, fontSource);
  if (error !== undefined)
    return { error };

  const prepared = add.map((entry) => ({
    entry,
    appearance: entry.kind === 'text' ? freeTextAppearanceOf(entry, font.measure) : appearanceOf(entry),
  }));
  const removed = removeAnnotations(doc, remove, tools);
  prepared.forEach((item, serial) => {
    addAnnotation(doc, pages[item.entry.src], item, font, tools, now, serial + 1);
  });
  // サブセットを確定させる。save() も flush するが、抽出（copyPages）の前に辞書が要る。
  if (font !== null)
    await font.font.embed();
  return { ok: true, added: prepared.length, removed };
}

module.exports = { parseRef, applyAnnotations };
