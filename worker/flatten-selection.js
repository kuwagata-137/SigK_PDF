'use strict';

// フラット化で、どの注釈を焼き、どれを注釈のまま残すかを決める（spec-4-5 確定事項27・28・32。論点9・10）。
// pdf-lib を知らない純関数。焼くときの判定（op-flatten.js）と、画面に出す件数（flatten-preview）が同じ表を通る。

// 注釈の /F の各ビット（ISO 32000-1 12.5.3）。
const FLAGS = Object.freeze({ INVISIBLE: 1, HIDDEN: 2, PRINT: 4, NO_ZOOM: 8, NO_ROTATE: 16, NO_VIEW: 32 });
// 見えていない印。pdf.js と同じく、Invisible も種類を問わず見えないものとして扱う。
const NOT_VIEWED = FLAGS.INVISIBLE | FLAGS.HIDDEN | FLAGS.NO_VIEW;

// 焼く種類と、画面でのまとまり。規格の markup 注釈から、働きを持つ添付ファイル・音声・墨消しの指定を除き、
// 透かし注釈を足したもの。ここに無い種類（リンク・フォームの欄・動画・知らない種類など）は焼かずに残す
// （墨消しの指定を焼くと、下の文字が残ったまま消えたように見えて危ない）。
const GROUPS = Object.freeze({
  Highlight: 'markup', Underline: 'markup', StrikeOut: 'markup', Squiggly: 'markup',
  FreeText: 'text',
  Square: 'shape', Circle: 'shape', Line: 'shape', Polygon: 'shape', PolyLine: 'shape', Ink: 'shape',
  Text: 'note',
  Stamp: 'other', Caret: 'other', Watermark: 'other',
});

// 1 つの注釈の扱い。subtype は先頭の / を除いた名前。
//   bake       … 外観を焼く
//   draw-note  … 外観の無いノート。付箋を描き起こして焼く（論点10）
//   keep       … 注釈のまま残す（reason: functional・hidden・noAppearance）
//   popup      … Popup。親を焼けば外し、親を残せば残す（ここでは数えない）
function decide({ subtype, flags = 0, hasAppearance, hasRect }) {
  if (subtype === 'Popup')
    return { action: 'popup' };
  if (!Object.hasOwn(GROUPS, subtype))
    return { action: 'keep', reason: 'functional' };
  const group = GROUPS[subtype];
  if ((flags & NOT_VIEWED) !== 0)
    return { action: 'keep', reason: 'hidden', group };
  if (hasAppearance && hasRect)
    return { action: 'bake', group };
  if (subtype === 'Text' && hasRect)
    return { action: 'draw-note', group };
  return { action: 'keep', reason: 'noAppearance', group };
}

function emptyCensus() {
  return {
    bake: { markup: 0, text: 0, shape: 0, note: 0, other: 0 },
    keep: { functional: 0, noAppearance: 0, hidden: 0 },
  };
}

// 数える。popup と skip（辞書として読めない項目）は数えない。
function count(census, decision) {
  if (decision.action === 'bake' || decision.action === 'draw-note')
    census.bake[decision.group] += 1;
  else if (decision.action === 'keep')
    census.keep[decision.reason] += 1;
}

const sum = (record) => Object.values(record).reduce((total, value) => total + value, 0);

// 戻り値は { baked, kept, notes, bake, keep }。notes は焼くノートの数（本文と作成者が失われる）。
function summarize(census) {
  return { baked: sum(census.bake), kept: sum(census.keep), notes: census.bake.note, bake: { ...census.bake }, keep: { ...census.keep } };
}

module.exports = { FLAGS, GROUPS, decide, emptyCensus, count, summarize };
