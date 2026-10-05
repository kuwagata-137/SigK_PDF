'use strict';

// 注釈の外観（/AP /N。状態の辞書なら /AS で選ぶ）を読む純粋層（spec-4-5 確定事項28、spec-4b-2 確定事項34）。
//
// appearanceOf は op-flatten.js から移した（spec-4b-2。フラット化と読み戻しの口が共用する）。skewedContent は、外観の中身と
// その 1 段下の Form が図形を回す・ゆがめるか（cm か /Matrix の b・c が 0 でない）を見る（読み戻しの口が、回転を読めない
// 他のアプリの四角・丸を表示のみにするのに使う）。pdf-lib のクラスで instanceof しない（ワーカーは vendor の、テストは
// node_modules の pdf-lib を使う）。

const zlib = require('node:zlib');

const { pick } = require('./pdf-tree-reader.js');
const { IDENTITY } = require('./pdf-matrix.js');

// 中身を見る上限（展開したバイト数）。図形の外観はふつう数百バイトで、これを超える分は見ない。
const CONTENT_MAX = 256 * 1024;
const NUMBER = '(-?(?:\\d+\\.?\\d*|\\.\\d+))';
const CM = new RegExp(`${Array(6).fill(NUMBER).join('\\s+')}\\s+cm\\b`, 'g');
// 回す・ゆがめるとみなす b・c の大きさ。
const TURN_EPSILON = 1e-6;

const isRef = (value) => typeof value?.objectNumber === 'number';
// ストリームは getContents を持つ（PDFDict も中身を dict という Map で持つので、dict の有無では見分けられない）。
const isStream = (value) => typeof value?.getContents === 'function';

function numbersOf(context, value, length) {
  const array = context.lookup(value);
  if (typeof array?.asArray !== 'function')
    return null;
  const numbers = array.asArray().map((item) => context.lookup(item)).map((item) => (typeof item?.asNumber === 'function' ? item.asNumber() : Number.NaN));
  return numbers.length === length && numbers.every(Number.isFinite) ? numbers : null;
}

// 外観を選ぶ。戻り値は { ref, bbox, matrix } か null（無い・選べない・/BBox が読めない）。
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

function turns(matrix) {
  return Math.abs(matrix[1]) > TURN_EPSILON || Math.abs(matrix[2]) > TURN_EPSILON;
}

// フィルターの名前（無ければ null、1 つの名前の配列はその名前、読めないものは '?'）。
function filterName(filter) {
  if (filter === undefined)
    return null;
  if (typeof filter.asString === 'function')
    return filter.asString();
  const items = typeof filter.asArray === 'function' ? filter.asArray() : [];
  return items.length === 1 && typeof items[0]?.asString === 'function' ? items[0].asString() : '?';
}

// ストリームの中身（展開したもの）を latin1 の文字列で。フィルターが無いか FlateDecode のものだけ。読めなければ null。
function contentText(stream) {
  const name = filterName(pick(stream.dict, '/Filter'));
  if (name !== null && name !== '/FlateDecode')
    return null;
  try {
    const raw = Buffer.from(stream.getContents());
    const bytes = name === '/FlateDecode' ? zlib.inflateSync(raw, { maxOutputLength: CONTENT_MAX }) : raw.subarray(0, CONTENT_MAX);
    return bytes.toString('latin1');
  } catch {
    return null;
  }
}

// [a b c d] が 90° の倍数の回転（拡大は縦横で同じ・裏返さない）か。0°・180° は b・c が 0 なので turns が見ない。
function quarterTurn([a, b, c, d]) {
  return Math.abs(a) <= TURN_EPSILON && Math.abs(d) <= TURN_EPSILON && Math.abs(b + c) <= TURN_EPSILON && Math.abs(b) > TURN_EPSILON;
}

// 外観の中身とその 1 段下の Form（/Resources /XObject の Form）が、図形を回す・ゆがめるか（確定事項34）。中身が読めない
// （暗号化・見ないフィルター）ものは false。呼ぶ側は暗号化された文書では呼ばない。quarterTurns なら 90° の倍数の回転は
// 見逃す（自前の FreeText は置いた向きの 4 方向を中身の cm で描くため。spec-4b-4b 確定事項H1。事前調査 P）。
function skewedContent(context, stream, depth = 1, { quarterTurns = false } = {}) {
  const skews = (matrix) => turns(matrix) && !(quarterTurns && quarterTurn(matrix));
  const text = contentText(stream);
  if (text !== null && [...text.matchAll(CM)].some((match) => skews(match.slice(1, 7).map(Number))))
    return true;
  if (depth <= 0)
    return false;
  const xobjects = context.lookup(pick(context.lookup(pick(stream.dict, '/Resources')), '/XObject'));
  if (typeof xobjects?.entries !== 'function')
    return false;
  for (const [, value] of xobjects.entries()) {
    const child = context.lookup(value);
    if (!isStream(child) || pick(child.dict, '/Subtype')?.asString?.() !== '/Form')
      continue;
    const matrix = numbersOf(context, pick(child.dict, '/Matrix'), 6);
    if ((matrix !== null && skews(matrix)) || skewedContent(context, child, depth - 1, { quarterTurns }))
      return true;
  }
  return false;
}

module.exports = { isRef, isStream, numbersOf, appearanceOf, skewedContent };
