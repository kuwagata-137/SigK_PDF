'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-plan.js');
require('../renderer/annotation-state.js');
require('../renderer/edit-history.js');

// 履歴（spec-1-5 確定事項8〜13・spec-4-1 確定事項15）。世代は { plan, annots } の
// スナップショットで、ページ編集と注釈が 1 本に並ぶ。

const plan = globalThis.SigK.pagePlan;
const annotation = globalThis.SigK.annotationState;
const history = globalThis.SigK.editHistory;

const QUAD = [48, 753, 232, 753, 48, 743, 232, 743];

function entry(overrides = {}) {
  return { src: 0, kind: 'highlight', color: '#ffe45a', quads: [QUAD], rect: [48, 743, 232, 753], ...overrides };
}

function fresh(pageCount = 3) {
  return { plan: plan.createPlan(pageCount), annots: annotation.createAnnots() };
}

test('createHistory は初期の1世代だけを持つ', () => {
  const made = history.createHistory(fresh());
  assert.equal(made.stack.length, 1);
  assert.equal(made.at, 0);
  assert.equal(history.canUndo(made), false);
  assert.equal(history.canRedo(made), false);
  assert.deepEqual(history.current(made), fresh());
});

test('createHistory は注釈が無くても壊れない', () => {
  const made = history.createHistory({ plan: plan.createPlan(2) });
  assert.deepEqual(history.current(made).annots, { added: [], removed: [] });
});

test('操作を積むと戻れるようになる', () => {
  const base = fresh();
  const rotated = { ...base, plan: plan.rotatePages(base.plan, [0], 90) };
  const pushed = history.pushHistory(history.createHistory(base), rotated, { before: [0], after: [0] });
  assert.equal(pushed.stack.length, 2);
  assert.equal(pushed.at, 1);
  assert.equal(history.canUndo(pushed), true);
  assert.equal(history.canRedo(pushed), false);
});

test('undo は1つ前の plan と annots を返す', () => {
  const base = fresh();
  const rotated = { ...base, plan: plan.rotatePages(base.plan, [0], 90) };
  const pushed = history.pushHistory(history.createHistory(base), rotated, { before: [0], after: [0] });
  const undone = history.undo(pushed);
  assert.deepEqual(undone.plan, base.plan);
  assert.deepEqual(undone.annots, base.annots);
  assert.equal(undone.changed, true);
  assert.equal(history.canRedo(undone.history), true);
});

test('redo は戻した操作をやり直す', () => {
  const base = fresh();
  const rotated = { ...base, plan: plan.rotatePages(base.plan, [0], 90) };
  const pushed = history.pushHistory(history.createHistory(base), rotated, { before: [0], after: [0] });
  const redone = history.redo(history.undo(pushed).history);
  assert.deepEqual(redone.plan, rotated.plan);
  assert.equal(redone.changed, true);
});

test('先頭で undo、末尾で redo は何も起こさない', () => {
  const made = history.createHistory(fresh(2));
  assert.equal(history.undo(made).changed, false);
  assert.equal(history.redo(made).changed, false);
  assert.deepEqual(history.undo(made).plan, plan.createPlan(2));
});

// spec-1-5 確定事項12。何が戻ったか分かるよう、その世代で操作の対象だったページを選ぶ。
test('undo と redo は操作の対象だったページを選択として返す', () => {
  const base = fresh(4);
  const deleted = plan.deletePages(base.plan, [2]);
  const pushed = history.pushHistory(history.createHistory(base), { ...base, plan: deleted.plan }, {
    before: [2],
    after: deleted.selection,
  });
  const undone = history.undo(pushed);
  assert.deepEqual(undone.selection, [2]);
  assert.equal(undone.annot, null);
  const redone = history.redo(undone.history);
  assert.deepEqual(redone.selection, deleted.selection);
});

test('注釈の操作はページ編集と同じ列に並び、対象の注釈を返す（spec-4-1 確定事項15）', () => {
  const base = fresh();
  const rotated = { ...base, plan: plan.rotatePages(base.plan, [0], 90) };
  let made = history.pushHistory(history.createHistory(base), rotated, { before: [0], after: [0] });
  const withAnnot = { ...rotated, annots: annotation.addAnnot(rotated.annots, entry({ id: 'sigk-1' })) };
  made = history.pushHistory(made, withAnnot, { annot: { before: null, after: 'sigk-1' } });
  const removed = { ...withAnnot, annots: annotation.removeAnnot(withAnnot.annots, { id: 'sigk-1' }) };
  made = history.pushHistory(made, removed, { annot: { before: 'sigk-1', after: null } });
  assert.equal(made.stack.length, 4);

  // 削除を戻すと注釈が戻り、その注釈が対象になる。
  const first = history.undo(made);
  assert.equal(first.annots.added.length, 1);
  assert.equal(first.annot, 'sigk-1');
  assert.deepEqual(first.selection, []);
  // 作成を戻すと注釈が消え、plan は回転したまま。
  const second = history.undo(first.history);
  assert.equal(second.annots.added.length, 0);
  assert.equal(second.annot, null);
  assert.equal(second.plan[0].rotate, 90);
  // 回転を戻すと plan が元へ。
  const third = history.undo(second.history);
  assert.equal(third.plan[0].rotate, 0);
  assert.deepEqual(third.selection, [0]);
  // やり直しは順に進む。
  const redone = history.redo(history.redo(third.history).history);
  assert.equal(redone.annots.added.length, 1);
  assert.equal(redone.annot, 'sigk-1');
});

test('戻した状態から操作すると、先の履歴は捨てられる（spec-1-5 確定事項10）', () => {
  const base = fresh();
  const first = { ...base, plan: plan.rotatePages(base.plan, [0], 90) };
  const second = { ...first, plan: plan.rotatePages(first.plan, [1], 90) };
  let made = history.createHistory(base);
  made = history.pushHistory(made, first, { before: [0], after: [0] });
  made = history.pushHistory(made, second, { before: [1], after: [1] });
  assert.equal(made.stack.length, 3);

  const undone = history.undo(made);
  const branched = history.pushHistory(undone.history, { ...first, plan: plan.rotatePages(first.plan, [2], 90) }, { before: [2], after: [2] });
  assert.equal(branched.stack.length, 3);
  assert.equal(branched.at, 2);
  assert.equal(history.canRedo(branched), false);
});

test('履歴は 50 世代で頭打ちになり、古いほうから捨てる（spec-1-5 確定事項9）', () => {
  const base = fresh(2);
  let made = history.createHistory(base);
  let current = base.plan;
  for (let count = 0; count < history.MAX_HISTORY + 10; count += 1) {
    current = plan.rotatePages(current, [0], 90);
    made = history.pushHistory(made, { plan: current, annots: base.annots }, { before: [0], after: [0] });
  }
  assert.equal(made.stack.length, history.MAX_HISTORY);
  assert.equal(made.at, history.MAX_HISTORY - 1);
  assert.notDeepEqual(made.stack[0].plan, base.plan);
});

test('世代は複製で持ち、あとから元を書き換えても変わらない', () => {
  const base = fresh();
  const made = history.createHistory(base);
  base.plan[0].rotate = 90;
  base.annots.added.push(entry({ id: 'x' }));
  assert.equal(history.current(made).plan[0].rotate, 0);
  assert.equal(history.current(made).annots.added.length, 0);
});
