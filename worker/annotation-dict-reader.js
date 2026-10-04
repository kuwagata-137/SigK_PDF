'use strict';

// 注釈の辞書を直に読む口（spec-4b-1a 確定事項20〜23）。pdf.js が返さない欄（ハイライトとペン以外の不透明度 /CA、
// 塗り /IC、雲形 /BE、/RD）を、開いている文書の注釈について返す。読むだけで、何も書かない。
//
// ファイルの大きさと更新時刻が、開いたときの控え（expect）と違えば読まない（changed）。開いたあとで外から
// 書き換わったファイルの辞書は、画面に映っている注釈と食い違うためである。暗号化された PDF も
// ignoreEncryption で開けば数の欄は読める（数は暗号化されない。文字列とストリームは読めない。事前調査 B）。
//
// 欄の読みは pdf-tree-reader.js の pick に寄せ、pdf-lib のクラスは名前でなく形で見分ける（PDFName は encodedName、
// 数は asNumber、配列は asArray を持つ）。ワーカーは vendor から、テストの検体づくりは node_modules から
// pdf-lib を読むためである。

const fs = require('node:fs');

const { PDFDocument, LOAD_OPTIONS, TOOLS } = require('./pdf-io.js');
const { parseRef } = require('./annotation-remove.js');
const { pick } = require('./pdf-tree-reader.js');
const { appearanceOf, numbersOf: fixedNumbersOf, skewedContent } = require('./appearance-reader.js');
const { rotationOf: rotationOfAppearance } = require('./shape-rotation.js');
const { freeTextDetailsOf } = require('./free-text-details.js');
const { freeTextFrameOf } = require('./free-text-frame.js');
const { readSignature, signaturesMatch } = require('../pdf-write.js');

// 回転を読む種類（spec-4b-2 確定事項34）。
const BOXED_SUBTYPES = Object.freeze(['Square', 'Circle']);

// 一度に読む注釈の数の上限。画面の側も、これを超える文書では口を呼ばない（確定事項25）。
const REFS_MAX = 10000;
const REF_ID = /^\d+R\d*$/;

function numberOf(context, value) {
  const item = context.lookup(value);
  return typeof item?.asNumber === 'function' ? item.asNumber() : null;
}

// 数の配列。数でない要素が混ざっていれば null。
function numbersOf(context, value) {
  const array = context.lookup(value);
  if (typeof array?.asArray !== 'function')
    return null;
  const items = array.asArray().map((item) => numberOf(context, item));
  return items.every((item) => item !== null) ? items : null;
}

// 名前（先頭の / を落とす）。名前でなければ null。
function nameOf(context, value) {
  const item = context.lookup(value);
  return typeof item?.encodedName === 'string' ? item.encodedName.slice(1) : null;
}

// 四角・丸・テキストの外観の回転（spec-4b-2 確定事項34、spec-4b-4b 確定事項I1）。{ box, angle }（回っている）・'skewed'（回転を読めない）・null（回っていない・
// 外観が無い）。外観の中身が回す・ゆがめるものは 'skewed'。暗号化された文書では中身が読めないので、その見分けはしない。
function rotationOf(dict, context, { encrypted = false } = {}) {
  const subtype = nameOf(context, pick(dict, '/Subtype'));
  if (!BOXED_SUBTYPES.includes(subtype))
    return null;
  const appearance = appearanceOf(context, dict);
  const rect = fixedNumbersOf(context, pick(dict, '/Rect'), 4);
  if (appearance === null || rect === null)
    return null;
  if (!encrypted && skewedContent(context, context.lookup(appearance.ref)))
    return 'skewed';
  return rotationOfAppearance({ rect, bbox: appearance.bbox, matrix: appearance.matrix });
}

// 1 つの注釈の辞書から、画面が要る欄を読む（確定事項23）。無い欄は null（cloudy は false）。雲形の強さ /BE /I は
// spec-4b-1b 確定事項38 で、四角・丸の回転は spec-4b-2 確定事項34 で足した（規格の既定は 0 で、効果が無い）。FreeText は
// /DS と /DA の色も読む（free-text-details.js。spec-4b-4a 確定事項J1）。
function detailsOf(dict, context, options = {}) {
  const border = context.lookup(pick(dict, '/BS'));
  const effect = context.lookup(pick(dict, '/BE'));
  const freeText = nameOf(context, pick(dict, '/Subtype')) === 'FreeText';
  const text = freeText ? freeTextDetailsOf(dict, context, options) : {};
  // FreeText の回転と吹き出しは、中身のゆがみを見ない読み方（free-text-frame.js。spec-4b-4b 確定事項I1・I2）。
  const frame = freeText ? freeTextFrameOf(dict, context) : null;
  return {
    ...text,
    ca: numberOf(context, pick(dict, '/CA')),
    interior: numbersOf(context, pick(dict, '/IC')),
    stroke: numbersOf(context, pick(dict, '/C')),
    borderWidth: numberOf(context, pick(border, '/W')),
    borderStyle: nameOf(context, pick(border, '/S')),
    dash: numbersOf(context, pick(border, '/D')),
    cloudy: nameOf(context, pick(effect, '/S')) === 'C',
    cloudIntensity: numberOf(context, pick(effect, '/I')),
    rectDifference: numbersOf(context, pick(dict, '/RD')),
    rotation: frame === null ? rotationOf(dict, context, options) : frame.rotation,
    ...(frame === null ? {} : { callout: frame.callout }),
  };
}

// 読める注釈だけを { id: 欄 } にする。辞書でないもの・/Subtype の無いものは飛ばす。
function collectDetails(doc, refs) {
  const context = doc.context;
  const encrypted = context.trailerInfo?.Encrypt !== undefined;
  const details = {};
  for (const id of refs) {
    const ref = parseRef(id);
    if (ref === null)
      continue;
    const dict = context.lookup(TOOLS.PDFRef.of(ref.num, ref.gen));
    if (typeof dict?.entries !== 'function' || pick(dict, '/Subtype') === undefined)
      continue;
    details[id] = detailsOf(dict, context, { encrypted });
  }
  return details;
}

// spec の形を確かめる。崩れていれば null。同じ id は 1 つにまとめる。
function requestOf(spec) {
  const { source, expect, refs } = spec ?? {};
  if (typeof source !== 'string' || source === '')
    return null;
  if (!Number.isFinite(expect?.size) || expect.size < 0 || !Number.isFinite(expect?.mtimeMs))
    return null;
  if (!Array.isArray(refs) || refs.length === 0 || refs.length > REFS_MAX)
    return null;
  if (!refs.every((id) => typeof id === 'string' && REF_ID.test(id)))
    return null;
  return { source, expect: { size: expect.size, mtimeMs: expect.mtimeMs }, refs: [...new Set(refs)] };
}

// ワーカーの入口（tool-tasks.js の TOOL_TASKS）。戻り値は { ok: true, details } か { ok: false, reason }。
async function runAnnotationDetails(spec, { fsLike = fs } = {}) {
  const request = requestOf(spec);
  if (request === null)
    return { ok: false, reason: 'invalid' };
  const current = await readSignature(request.source, { fsLike });
  if (current !== null && !signaturesMatch(request.expect, current))
    return { ok: false, reason: 'changed' };
  try {
    const bytes = await fsLike.promises.readFile(request.source);
    const doc = await PDFDocument.load(bytes, { ...LOAD_OPTIONS, ignoreEncryption: true });
    return { ok: true, details: collectDetails(doc, request.refs) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

module.exports = { REFS_MAX, detailsOf, collectDetails, requestOf, runAnnotationDetails };
