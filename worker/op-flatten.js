'use strict';

// 注釈の外観をページの内容へ焼き込む（フラット化。spec-4-5 確定事項27〜33。論点9・10）。
//
// 焼く注釈ごとに、外観（/AP /N。状態の辞書なら /AS で選ぶ）をページの Resources に SigKF<n> で置き、
// 内容の末尾に `q <A> cm /SigKF<n> Do Q` を注釈の並び順に足す（A は flatten-geometry.js）。
// そのあと注釈の辞書と Popup を文書から消し、/Annots を残すものだけにする。**外観の実体は消さない**
// （ページから参照される。annotation-remove.js の removeAnnotations は外観まで消すので使わない）。
// 辞書の /CA は重ねない（pdf.js と同じ。本アプリの外観は中で不透明度を設定し直す。事前調査 C）。
//
// 辞書の読みは pdf-tree-reader.js の pick に寄せ、pdf-lib のクラスで instanceof しない
// （ワーカーは vendor の、テストは node_modules の pdf-lib を使う）。

const { pick } = require('./pdf-tree-reader.js');
const { FLAGS, decide, emptyCensus, count, summarize } = require('./flatten-selection.js');
const { bakeMatrix } = require('./flatten-geometry.js');
const { IDENTITY, matrixText } = require('./pdf-matrix.js');
const { ICON_SIZE, noteAppearanceOf } = require('./note-appearance.js');

const FLATTEN_PREFIX = 'SigKF';
// 色の無いノートは黄（本アプリの読み込みと同じ。spec-4-4 確定事項20）。spec-4b-1b 確定事項14 でノートの既定の色に合わせた。
const DEFAULT_NOTE_COLOR = '#ffd966';

const isRef = (value) => typeof value?.objectNumber === 'number';
// ストリームは getContents を持つ（PDFDict も中身を dict という Map で持つので、dict の有無では見分けられない）。
const isStream = (value) => typeof value?.getContents === 'function';

function nameOf(value) {
  return typeof value?.asString === 'function' ? value.asString().replace(/^\//, '') : '';
}

function numbersOf(context, value, length) {
  const array = context.lookup(value);
  if (typeof array?.asArray !== 'function')
    return null;
  const numbers = array.asArray().map((item) => context.lookup(item)).map((item) => (typeof item?.asNumber === 'function' ? item.asNumber() : Number.NaN));
  return numbers.length === length && numbers.every(Number.isFinite) ? numbers : null;
}

// 外観を選ぶ（確定事項28）。戻り値は { ref, bbox, matrix } か null（無い・選べない・/BBox が読めない）。
function appearanceOf(context, dict) {
  const ap = context.lookup(pick(dict, '/AP'));
  let ref = pick(ap, '/N');
  const normal = context.lookup(ref);
  if (!isStream(normal) && typeof normal?.entries === 'function') {
    const state = pick(dict, '/AS');
    ref = typeof state?.asString === 'function' ? pick(normal, state.asString()) : undefined;
  }
  const stream = context.lookup(ref);
  if (!isRef(ref) || !isStream(stream))
    return null;
  const bbox = numbersOf(context, pick(stream.dict, '/BBox'), 4);
  if (bbox === null || bbox[0] === bbox[2] || bbox[1] === bbox[3])
    return null;
  return { ref, bbox, matrix: numbersOf(context, pick(stream.dict, '/Matrix'), 6) ?? IDENTITY };
}

// /Annots の 1 項目を読んで扱いを決める。
function planOf(context, item) {
  const dict = context.lookup(item);
  if (typeof dict?.entries !== 'function')
    return { item, decision: { action: 'skip' } };
  const subtype = nameOf(pick(dict, '/Subtype'));
  const flagsValue = context.lookup(pick(dict, '/F'));
  const flags = typeof flagsValue?.asNumber === 'function' ? flagsValue.asNumber() | 0 : 0;
  const rect = numbersOf(context, pick(dict, '/Rect'), 4);
  const appearance = appearanceOf(context, dict);
  const decision = decide({ subtype, flags, hasAppearance: appearance !== null, hasRect: rect !== null });
  return { item, dict, subtype, flags, rect, appearance, decision };
}

// '/C' の 0〜1 の RGB を #rrggbb へ。読めなければ黄。
function noteColorOf(context, dict) {
  const rgb = numbersOf(context, pick(dict, '/C'), 3);
  if (rgb === null || !rgb.every((value) => value >= 0 && value <= 1))
    return DEFAULT_NOTE_COLOR;
  return `#${rgb.map((value) => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
}

// 外観の無いノートの付箋を描き起こす（/Rect の左上から 20×20。不透明度 1 ＝ 本アプリの画面と同じ）。
function drawNote(context, plan) {
  const x1 = Math.min(plan.rect[0], plan.rect[2]);
  const y2 = Math.max(plan.rect[1], plan.rect[3]);
  const box = [x1, y2 - ICON_SIZE, x1 + ICON_SIZE, y2];
  const appearance = noteAppearanceOf({ kind: 'note', rect: box, color: noteColorOf(context, plan.dict), opacity: 1, text: '' });
  const ref = context.register(context.stream(appearance.content, {
    Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: appearance.bbox,
    Resources: { ExtGState: { GS: { Type: 'ExtGState', ca: 1, CA: 1 } } },
  }));
  return { ref, bbox: appearance.bbox, matrix: IDENTITY, rect: box };
}

// ページの Resources の /XObject に SigKF<n> の空いている名前を取る（同じ外観なら使い回す）。
function xobjectName(xobjects, ref, PDFName) {
  for (let index = 1; ; index += 1) {
    const name = `${FLATTEN_PREFIX}${index}`;
    const current = xobjects.get(PDFName.of(name));
    if (current === undefined) {
      xobjects.set(PDFName.of(name), ref);
      return name;
    }
    if (current.objectNumber === ref.objectNumber && current.generationNumber === ref.generationNumber)
      return name;
  }
}

// 1 つの注釈を焼く行を返す。外観の辞書に /Subtype が無ければ /Form を足す（Do は Form を要る）。
function bakeLine(context, plan, xobjects, rotate, PDFName) {
  const source = plan.decision.action === 'draw-note'
    ? drawNote(context, plan)
    : { ...plan.appearance, rect: plan.rect };
  const stream = context.lookup(source.ref);
  if (stream.dict.get(PDFName.of('Subtype')) === undefined)
    stream.dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
  const noRotate = plan.subtype === 'Text' || (plan.flags & FLAGS.NO_ROTATE) !== 0;
  const matrix = bakeMatrix({ bbox: source.bbox, matrix: source.matrix, rect: source.rect, rotate, noRotate });
  return `q ${matrixText(matrix)} cm /${xobjectName(xobjects, source.ref, PDFName)} Do Q`;
}

const isBaked = (plan) => plan.decision.action === 'bake' || plan.decision.action === 'draw-note';

// 焼いた注釈の辞書と Popup を消し、/Annots を残すものだけの新しい配列にする（共有された配列は書き換えない）。
// 消す Popup は、焼いた注釈が /Popup で指すものと、/Parent が焼いた注釈を指すもの。
function removeBaked(doc, page, plans, PDFName) {
  const { context } = doc;
  const baked = plans.filter(isBaked);
  const bakedKeys = new Set(baked.filter((plan) => isRef(plan.item)).map((plan) => String(plan.item)));
  const popupRefs = baked.map((plan) => pick(plan.dict, '/Popup')).filter(isRef);
  const popupKeys = new Set(popupRefs.map(String));
  const isOrphanPopup = (plan) => plan.decision.action === 'popup'
    && (popupKeys.has(String(plan.item)) || bakedKeys.has(String(pick(plan.dict, '/Parent'))));
  const dropped = (plan) => isBaked(plan) || isOrphanPopup(plan);
  const remaining = plans.filter((plan) => !dropped(plan)).map((plan) => plan.item);
  for (const plan of plans.filter(dropped)) {
    if (isRef(plan.item))
      context.delete(plan.item);
  }
  // /Annots に並んでいない Popup も消す（親の本文の写しを持つことがある）。2 度消しても害は無い。
  popupRefs.forEach((ref) => context.delete(ref));
  if (remaining.length === 0)
    page.node.delete(PDFName.of('Annots'));
  else
    page.node.set(PDFName.of('Annots'), context.obj(remaining));
}

function flattenPage(doc, page, census, { PDFName }, dryRun) {
  const { context } = doc;
  const annots = context.lookup(page.node.get(PDFName.of('Annots')));
  if (typeof annots?.asArray !== 'function')
    return;
  const plans = annots.asArray().map((item) => planOf(context, item));
  plans.forEach((plan) => count(census, plan.decision));
  const toBake = plans.filter(isBaked);
  if (dryRun || toBake.length === 0)
    return;
  // normalizedEntries が既存の内容を q … Q で包み、/XObject の辞書を用意する。
  const { XObject: xobjects } = page.node.normalizedEntries();
  const rotate = page.getRotation().angle;
  const lines = toBake.map((plan) => bakeLine(context, plan, xobjects, rotate, PDFName));
  page.node.addContentStream(context.register(context.stream(lines.join('\n'))));
  removeBaked(doc, page, plans, PDFName);
}

// 文書の全ページを焼く。dryRun なら数えるだけで文書を変えない（flatten-preview。確定事項32）。
// 戻り値は { ok, baked, kept, notes, bake, keep }（flatten-selection.js の summarize）。
function flattenDocument(doc, TOOLS, { dryRun = false } = {}) {
  const census = emptyCensus();
  for (const page of doc.getPages())
    flattenPage(doc, page, census, TOOLS, dryRun);
  return { ok: true, ...summarize(census) };
}

module.exports = { FLATTEN_PREFIX, flattenDocument };
