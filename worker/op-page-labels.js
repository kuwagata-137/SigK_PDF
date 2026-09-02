'use strict';

// ページラベル（`/PageLabels`）を並びに合わせて作り直す層（spec-1-6 確定事項41〜46）。
//
// PDF は「表紙・i, ii, iii・1, 2, 3」のようなページ番号のラベルを持てる。これは
// catalog の `/PageLabels`（number tree）にあり、**並べ替えても削除しても追従しない**。
// 何もしないとラベルが「ページの中身」ではなく「位置」に貼り付いたまま残り、
// 他のビューアで開いたときだけ番号がずれて見える（実測で再現した）。
//
// pdf-lib に高レベル API は無いので、低レベルの `context.obj` と `catalog` を直に使う。
// 使う道具（PDFName・PDFHexString）は引数で受け取る。ワーカーは vendor から、
// テストは node_modules から読むため、パスをこの層に持たせない。
//
// 【落とし穴】接頭辞に**素の JS 文字列を渡すと `PDFName` に化ける**。`/P (付-)` ではなく
// `/P /#4ED8-` になり、pdf.js は警告を1行出して**ラベル全体を null にする**。例外は出ない。
// `PDFString.of()` も非 ASCII を下位バイトへ切り詰めて壊すので、`PDFHexString.fromText()`
// だけを使う。1,000ページ全部を hex にしても差は 497 バイト（0.2%）である。

const { pick, textOf, collectNumbered } = require('./pdf-tree-reader.js');

const ROMAN = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

function toRoman(value) {
  if (!Number.isInteger(value) || value < 1)
    return '';
  let rest = value;
  let out = '';
  for (const [weight, glyph] of ROMAN) {
    while (rest >= weight) {
      out += glyph;
      rest -= weight;
    }
  }
  return out;
}

// PDF の英字ラベルは 27 番目が aa、28 番目が bb になる（26 進法ではない）。
function toLetters(value) {
  if (!Number.isInteger(value) || value < 1)
    return '';
  const cycle = Math.floor((value - 1) / 26) + 1;
  return String.fromCharCode(97 + ((value - 1) % 26)).repeat(cycle);
}

function numeralFor(style, value) {
  switch (style) {
    case '/D': return String(value);
    case '/r': return toRoman(value);
    case '/R': return toRoman(value).toUpperCase();
    case '/a': return toLetters(value);
    case '/A': return toLetters(value).toUpperCase();
    default: return '';        // /S が無いエントリは接頭辞だけ
  }
}

// 文書のラベルを「ページ index → ラベル文字列」の配列にする。
// `/PageLabels` を持たない文書では null を返す（空配列と区別する）。
function readLabels(doc) {
  const context = doc.context;
  const node = pick(doc.catalog, '/PageLabels');
  if (node === undefined)
    return null;

  const entries = collectNumbered(context, node);
  if (entries.length === 0)
    return null;

  const count = doc.getPageCount();
  const labels = new Array(count).fill('');
  let at = 0;
  for (let page = 0; page < count; page += 1) {
    while (at + 1 < entries.length && entries[at + 1][0] <= page)
      at += 1;
    const [start, dict] = entries[at];
    if (page < start)
      continue;                     // 最初のエントリより前のページはラベル無し
    const style = pick(dict, '/S');
    const prefix = textOf(context.lookup(pick(dict, '/P')));
    const first = context.lookup(pick(dict, '/St'));
    const base = typeof first?.asNumber === 'function' ? first.asNumber() : 1;
    labels[page] = prefix + numeralFor(style === undefined ? null : style.asString(), base + (page - start));
  }
  return labels;
}

// ラベルの配列を1ページ1エントリの `/PageLabels` として書く。
//
// 範囲へ畳む最適化は入れない。任意の並べ替えのあとは範囲がまとまらず、
// 畳める場面が限られるうえ、1,000ページでも +2.0%・約1ms しか払わないためである。
function writeLabels(doc, labels, { PDFName, PDFHexString }) {
  const context = doc.context;
  const nums = [];
  labels.forEach((label, index) => {
    nums.push(index);
    nums.push(label === '' ? context.obj({}) : context.obj({ P: PDFHexString.fromText(label) }));
  });
  doc.catalog.set(PDFName.of('PageLabels'), context.obj({ Nums: nums }));
}

// plan の並びに合わせて作り直す。元がラベルを持たなければ何もしない。
// 挿入したページ（src を持たない要素）はラベル無しにする。
function rebuildLabels(doc, plan, before, tools) {
  if (before === null || !Array.isArray(plan))
    return false;
  writeLabels(doc, plan.map((entry) => before[entry?.src] ?? ''), tools);
  return true;
}

module.exports = { toRoman, toLetters, numeralFor, readLabels, writeLabels, rebuildLabels };
