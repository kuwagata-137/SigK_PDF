'use strict';

// plan（結果の並び）を pdf-lib の文書へ当てる層（spec-1-6 確定事項2・14）。
//
// plan は `[{ src, rotate }, ...]` で、src は**元ファイルの 0 始まりページ番号**、
// rotate は**元ページの /Rotate に足す相対角度**である（spec-1-5 確定事項1）。
// 配列は操作の履歴ではなく「いまの状態」を表すので、当てる処理は冪等になる。
//
// pdf-lib を require しない。setRotation は { type, angle } の素のオブジェクトを
// 受けるので degrees() を要さず、この層は Electron にも fs にも pdf-lib にも
// 依存しないまま node --test から直接呼べる（docs/07 第4章の「依存なしで回る層」）。
//
// 【なぜ removePage + insertPage で、copyPages を使わないのか】
// 実測（spec-1-6 事前調査）では、
//   removePage + insertPage … しおり・名前付き宛先が残り、飛び先もページを追う
//   copyPages で作り直す    … しおりも名前付き宛先も必ず消える
// であった。ファイルサイズは copyPages のほうが小さくなるが、文書の構造を失う
// 代償のほうが大きい（ユーザー確定 2026-09-01）。

const QUARTER = 90;
const FULL = 360;

// 0/90/180/270 のいずれかに丸める。pdf.js も pdf-lib も 90 の倍数を前提にしており、
// 半端な値を入れると片方だけが正規化して食い違う。丸めるのはここ1か所だけにする。
function normalizeRotation(value) {
  if (!Number.isFinite(value))
    return 0;
  const quarters = Math.round(value / QUARTER) * QUARTER;
  return ((quarters % FULL) + FULL) % FULL;
}

// plan がこの文書に当てられる形かを見る。
//
// src の重複を弾くのは、同じページオブジェクトを2か所へ挿すと**回転が共有されて
// しまう**ためである（実測で確認した）。ページの複製は第1版の範囲外なので、
// ここでは受け付けない。
function validatePlan(plan, pageCount) {
  if (!Array.isArray(plan) || plan.length === 0)
    return { error: '保存するページがありません。' };

  const seen = new Set();
  for (const entry of plan) {
    const src = entry?.src;
    if (!Number.isInteger(src) || src < 0 || src >= pageCount)
      return { error: 'ページの指定が元の文書と合いません。もう一度開き直してください。' };
    if (seen.has(src))
      return { error: '同じページを2回保存することはできません。' };
    seen.add(src);
  }
  return { ok: true };
}

// 当てたあとの各ページの絶対角度。画面へ映すときと同じ計算を、保存側でも1回だけ行う。
function resolveRotations(plan, baseRotations) {
  return plan.map((entry) => normalizeRotation(baseRotations[entry.src] + normalizeRotation(entry.rotate)));
}

function applyPlan(doc, plan) {
  const original = doc.getPages();
  const check = validatePlan(plan, original.length);
  if (check.ok !== true)
    return check;

  // 外す前に元の角度を控える。外したあとに読むと、当てた値が混ざる。
  const baseRotations = original.map((page) => page.getRotation().angle);
  const angles = resolveRotations(plan, baseRotations);

  // 後ろから外す。前から外すと index がずれる。
  for (let index = original.length - 1; index >= 0; index -= 1)
    doc.removePage(index);

  plan.forEach((entry, index) => {
    const page = original[entry.src];
    page.setRotation({ type: 'degrees', angle: angles[index] });
    doc.insertPage(index, page);
  });

  return { ok: true, pages: plan.length, angles };
}

module.exports = { normalizeRotation, validatePlan, resolveRotations, applyPlan };
