'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-plan.js');
const plan = globalThis.SigK.pagePlan;

// plan は「操作の列」ではなく「結果の並び」である（spec-1-5 確定事項1）。
// 要素は { src, rotate } で、src は元ファイルの 0 始まりページ番号、
// rotate は元ページの /Rotate に足す相対角度（0/90/180/270）。

// ---- 初期値（確定事項5） ----

test('createPlan は 0 から始まる連番の並びを作る', () => {
  assert.deepEqual(plan.createPlan(3), [
    { src: 0, rotate: 0 },
    { src: 1, rotate: 0 },
    { src: 2, rotate: 0 },
  ]);
});

test('createPlan はページ数が取れなければ空を返す', () => {
  assert.deepEqual(plan.createPlan(0), []);
  assert.deepEqual(plan.createPlan(-1), []);
  assert.deepEqual(plan.createPlan(Number.NaN), []);
  assert.deepEqual(plan.createPlan(undefined), []);
});

// ---- 回転の正規化（確定事項4） ----

test('normalizeRotation は 0/90/180/270 に丸める', () => {
  assert.equal(plan.normalizeRotation(0), 0);
  assert.equal(plan.normalizeRotation(90), 90);
  assert.equal(plan.normalizeRotation(360), 0);
  assert.equal(plan.normalizeRotation(450), 90);
});

test('normalizeRotation は負の角度を正へ回す', () => {
  assert.equal(plan.normalizeRotation(-90), 270);
  assert.equal(plan.normalizeRotation(-180), 180);
  assert.equal(plan.normalizeRotation(-450), 270);
});

test('normalizeRotation は数でない値を 0 にする', () => {
  assert.equal(plan.normalizeRotation(Number.NaN), 0);
  assert.equal(plan.normalizeRotation(undefined), 0);
  assert.equal(plan.normalizeRotation('90'), 0);
});

// ---- 回転（確定事項38） ----

test('rotatePages は選んだページだけを回す', () => {
  const before = plan.createPlan(3);
  const after = plan.rotatePages(before, [1], 90);

  assert.deepEqual(after.map((page) => page.rotate), [0, 90, 0]);
  // 元の配列は書き換えない（純粋関数）。
  assert.deepEqual(before.map((page) => page.rotate), [0, 0, 0]);
});

test('左回転（−90）は 270 として持つ', () => {
  const after = plan.rotatePages(plan.createPlan(1), [0], -90);

  assert.equal(after[0].rotate, 270);
});

test('4回回すと元に戻る', () => {
  let current = plan.createPlan(2);
  for (let count = 0; count < 4; count += 1)
    current = plan.rotatePages(current, [0, 1], 90);

  assert.deepEqual(current, plan.createPlan(2));
});

test('rotatePages は範囲外の index を無視する', () => {
  const after = plan.rotatePages(plan.createPlan(2), [5, -1, 0], 90);

  assert.deepEqual(after.map((page) => page.rotate), [90, 0]);
});

// ---- 並べ替え（確定事項30・34） ----

test('movePages は1枚を後ろへ動かす', () => {
  const result = plan.movePages(plan.createPlan(4), [0], 3);

  assert.deepEqual(result.plan.map((page) => page.src), [1, 2, 0, 3]);
});

test('movePages は1枚を先頭へ動かす', () => {
  const result = plan.movePages(plan.createPlan(4), [2], 0);

  assert.deepEqual(result.plan.map((page) => page.src), [2, 0, 1, 3]);
});

test('movePages は末尾へ動かせる', () => {
  const result = plan.movePages(plan.createPlan(3), [0], 3);

  assert.deepEqual(result.plan.map((page) => page.src), [1, 2, 0]);
});

test('movePages は複数枚をまとめて動かし、並び順を保つ', () => {
  const result = plan.movePages(plan.createPlan(5), [0, 1], 4);

  assert.deepEqual(result.plan.map((page) => page.src), [2, 3, 0, 1, 4]);
});

test('movePages は飛び飛びの選択もまとめて動かす', () => {
  const result = plan.movePages(plan.createPlan(5), [0, 4], 2);

  assert.deepEqual(result.plan.map((page) => page.src), [1, 0, 4, 2, 3]);
});

test('movePages は回転を連れて動く', () => {
  const rotated = plan.rotatePages(plan.createPlan(3), [0], 90);
  const result = plan.movePages(rotated, [0], 3);

  assert.deepEqual(result.plan, [
    { src: 1, rotate: 0 },
    { src: 2, rotate: 0 },
    { src: 0, rotate: 90 },
  ]);
});

test('movePages は移動先の index を新しい選択として返す（確定事項14）', () => {
  const result = plan.movePages(plan.createPlan(5), [0, 1], 4);

  assert.deepEqual(result.selection, [2, 3]);
});

test('movePages は動かないときに changed:false を返す', () => {
  const source = plan.createPlan(4);

  assert.equal(plan.movePages(source, [1], 1).changed, false);
  assert.equal(plan.movePages(source, [1], 2).changed, false);
  assert.equal(plan.movePages(source, [], 2).changed, false);
});

// ---- 削除（確定事項41・42） ----

test('deletePages は選んだページを並びから外す', () => {
  const result = plan.deletePages(plan.createPlan(4), [1, 2]);

  assert.deepEqual(result.plan.map((page) => page.src), [0, 3]);
  assert.equal(result.changed, true);
});

test('最後の1ページは消せない（確定事項41）', () => {
  const source = plan.createPlan(3);
  const result = plan.deletePages(source, [0, 1, 2]);

  assert.equal(result.changed, false);
  assert.deepEqual(result.plan, source);
});

test('1ページだけの文書でも消せない', () => {
  const result = plan.deletePages(plan.createPlan(1), [0]);

  assert.equal(result.changed, false);
});

test('削除した位置に来たページを選び直す（確定事項42）', () => {
  const result = plan.deletePages(plan.createPlan(4), [1]);

  assert.deepEqual(result.selection, [1]);
});

test('末尾を消したときは最後のページを選ぶ', () => {
  const result = plan.deletePages(plan.createPlan(4), [3]);

  assert.deepEqual(result.selection, [2]);
});

test('削除しても選択は空にならない（続けて Delete を押せる）', () => {
  let current = plan.createPlan(4);
  let selection = [3];
  for (let count = 0; count < 3; count += 1) {
    const result = plan.deletePages(current, selection);
    current = result.plan;
    selection = result.selection;
    assert.ok(selection.length > 0, `${count} 回目で選択が空になった`);
  }
  assert.equal(current.length, 1);
});

test('canDelete は全ページを選んだときだけ false になる', () => {
  const source = plan.createPlan(3);

  assert.equal(plan.canDelete(source, [0, 1]), true);
  assert.equal(plan.canDelete(source, [0, 1, 2]), false);
  assert.equal(plan.canDelete(source, []), false);
});

// ---- dirty の判定（確定事項6） ----

test('編集していない plan は dirty でない', () => {
  assert.equal(plan.isDirty(plan.createPlan(3), 3), false);
});

test('並べ替えたら dirty', () => {
  const moved = plan.movePages(plan.createPlan(3), [0], 3).plan;

  assert.equal(plan.isDirty(moved, 3), true);
});

test('削除したら dirty', () => {
  const deleted = plan.deletePages(plan.createPlan(3), [1]).plan;

  assert.equal(plan.isDirty(deleted, 3), true);
});

// 確定事項6 が明示している境目。操作した回数では決めない。
test('4回回して元に戻したら dirty でない', () => {
  let current = plan.createPlan(2);
  for (let count = 0; count < 4; count += 1)
    current = plan.rotatePages(current, [0], 90);

  assert.equal(plan.isDirty(current, 2), false);
});

test('3回回した時点では dirty', () => {
  let current = plan.createPlan(2);
  for (let count = 0; count < 3; count += 1)
    current = plan.rotatePages(current, [0], 90);

  assert.equal(plan.isDirty(current, 2), true);
});

// ---- 履歴（確定事項8〜13） ----

test('createHistory は初期の1世代だけを持つ', () => {
  const history = plan.createHistory(plan.createPlan(3));

  assert.equal(history.stack.length, 1);
  assert.equal(history.at, 0);
  assert.equal(plan.canUndo(history), false);
  assert.equal(plan.canRedo(history), false);
});

test('操作を積むと戻れるようになる', () => {
  const source = plan.createPlan(3);
  const rotated = plan.rotatePages(source, [0], 90);
  const history = plan.pushHistory(plan.createHistory(source), rotated, { before: [0], after: [0] });

  assert.equal(history.stack.length, 2);
  assert.equal(history.at, 1);
  assert.equal(plan.canUndo(history), true);
  assert.equal(plan.canRedo(history), false);
});

test('undo は1つ前の plan を返す', () => {
  const source = plan.createPlan(3);
  const rotated = plan.rotatePages(source, [0], 90);
  const pushed = plan.pushHistory(plan.createHistory(source), rotated, { before: [0], after: [0] });
  const undone = plan.undo(pushed);

  assert.deepEqual(undone.plan, source);
  assert.equal(undone.changed, true);
  assert.equal(plan.canRedo(undone.history), true);
});

test('redo は戻した操作をやり直す', () => {
  const source = plan.createPlan(3);
  const rotated = plan.rotatePages(source, [0], 90);
  const pushed = plan.pushHistory(plan.createHistory(source), rotated, { before: [0], after: [0] });
  const undone = plan.undo(pushed);
  const redone = plan.redo(undone.history);

  assert.deepEqual(redone.plan, rotated);
  assert.equal(redone.changed, true);
});

test('先頭で undo、末尾で redo は何も起こさない', () => {
  const history = plan.createHistory(plan.createPlan(2));

  assert.equal(plan.undo(history).changed, false);
  assert.equal(plan.redo(history).changed, false);
});

// 確定事項12。何が戻ったか分かるよう、その世代で操作の対象だったページを選ぶ。
test('undo と redo は操作の対象だったページを選択として返す', () => {
  const source = plan.createPlan(4);
  const deleted = plan.deletePages(source, [2]);
  const pushed = plan.pushHistory(plan.createHistory(source), deleted.plan, {
    before: [2],
    after: deleted.selection,
  });

  const undone = plan.undo(pushed);
  assert.deepEqual(undone.selection, [2]);

  const redone = plan.redo(undone.history);
  assert.deepEqual(redone.selection, deleted.selection);
});

test('戻した状態から操作すると、先の履歴は捨てられる（確定事項10）', () => {
  const source = plan.createPlan(3);
  const first = plan.rotatePages(source, [0], 90);
  const second = plan.rotatePages(first, [1], 90);

  let history = plan.createHistory(source);
  history = plan.pushHistory(history, first, { before: [0], after: [0] });
  history = plan.pushHistory(history, second, { before: [1], after: [1] });
  assert.equal(history.stack.length, 3);

  const undone = plan.undo(history);
  const branched = plan.pushHistory(undone.history, plan.rotatePages(first, [2], 90), { before: [2], after: [2] });

  assert.equal(branched.stack.length, 3);
  assert.equal(branched.at, 2);
  assert.equal(plan.canRedo(branched), false);
});

test('履歴は 50 世代で頭打ちになり、古いほうから捨てる（確定事項9）', () => {
  const source = plan.createPlan(2);
  let history = plan.createHistory(source);
  let current = source;

  for (let count = 0; count < plan.MAX_HISTORY + 10; count += 1) {
    current = plan.rotatePages(current, [0], 90);
    history = plan.pushHistory(history, current, { before: [0], after: [0] });
  }

  assert.equal(history.stack.length, plan.MAX_HISTORY);
  assert.equal(history.at, plan.MAX_HISTORY - 1);
  // 捨てたぶんは戻れない。いちばん古い世代は初期状態ではなくなっている。
  assert.notDeepEqual(history.stack[0].plan, source);
});

// ---- 選択（確定事項15〜18） ----

test('単独クリックはその1枚だけを選び、起点をそこへ置く', () => {
  const result = plan.resolveClick({ selection: [0, 1, 2], anchor: 0, index: 4 });

  assert.deepEqual(result.selection, [4]);
  assert.equal(result.anchor, 4);
});

test('Ctrl クリックは選択を反転し、起点を移す', () => {
  const added = plan.resolveClick({ selection: [0], anchor: 0, index: 2, ctrl: true });
  assert.deepEqual(added.selection, [0, 2]);
  assert.equal(added.anchor, 2);

  const removed = plan.resolveClick({ selection: [0, 2], anchor: 0, index: 2, ctrl: true });
  assert.deepEqual(removed.selection, [0]);
  assert.equal(removed.anchor, 2);
});

test('Shift クリックは起点からの範囲を選び、起点は動かさない', () => {
  const result = plan.resolveClick({ selection: [1], anchor: 1, index: 4, shift: true });

  assert.deepEqual(result.selection, [1, 2, 3, 4]);
  assert.equal(result.anchor, 1);
});

test('Shift クリックは起点より手前でも範囲になる', () => {
  const result = plan.resolveClick({ selection: [4], anchor: 4, index: 1, shift: true });

  assert.deepEqual(result.selection, [1, 2, 3, 4]);
  assert.equal(result.anchor, 4);
});

test('Shift クリックは前の範囲を置き換える', () => {
  const first = plan.resolveClick({ selection: [1], anchor: 1, index: 4, shift: true });
  const second = plan.resolveClick({ ...first, index: 2, shift: true });

  assert.deepEqual(second.selection, [1, 2]);
});

test('Ctrl+Shift は範囲を足す（確定事項17）', () => {
  const result = plan.resolveClick({ selection: [7], anchor: 1, index: 3, ctrl: true, shift: true });

  assert.deepEqual(result.selection, [1, 2, 3, 7]);
  assert.equal(result.anchor, 1);
});

test('起点が無いときの Shift クリックは、その1枚を選ぶ', () => {
  const result = plan.resolveClick({ selection: [], anchor: null, index: 3, shift: true });

  assert.deepEqual(result.selection, [3]);
  assert.equal(result.anchor, 3);
});

test('selectAll は全ページを選ぶ', () => {
  assert.deepEqual(plan.selectAll(3), [0, 1, 2]);
  assert.deepEqual(plan.selectAll(0), []);
});

// ---- 挿入位置（確定事項33） ----
//
// jsdom は elementFromPoint を持たない。だから位置の判定を純粋関数へ出す。

// 3列 × 幅100・間隔10。枠は x=0/110/220、y=0/200 に並ぶ。
function grid({ columns = 3, count = 6, width = 100, height = 190, gap = 10 } = {}) {
  const pages = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    pages.push({
      index,
      top: row * (height + gap),
      left: column * (width + gap),
      width,
      height,
    });
  }
  return { pages, columns };
}

test('枠の中心より左なら手前、右なら後ろへ入れる', () => {
  const { pages } = grid();

  assert.equal(plan.dropIndex({ layout: { pages }, columns: 3, x: 130, y: 90 }), 1);
  assert.equal(plan.dropIndex({ layout: { pages }, columns: 3, x: 190, y: 90 }), 2);
});

test('行をまたぐと、その行の枠で判定する', () => {
  const { pages } = grid();

  // 2行目の左端の枠（index 3）の左半分。
  assert.equal(plan.dropIndex({ layout: { pages }, columns: 3, x: 20, y: 250 }), 3);
  // 同じ枠の右半分。
  assert.equal(plan.dropIndex({ layout: { pages }, columns: 3, x: 90, y: 250 }), 4);
});

test('行の左端より左、右端より右は行の端へ寄せる', () => {
  const { pages } = grid();

  assert.equal(plan.dropIndex({ layout: { pages }, columns: 3, x: -50, y: 90 }), 0);
  assert.equal(plan.dropIndex({ layout: { pages }, columns: 3, x: 999, y: 90 }), 3);
});

test('最後の行より下は末尾になる', () => {
  const { pages } = grid();

  assert.equal(plan.dropIndex({ layout: { pages }, columns: 3, x: 50, y: 9999 }), 6);
});

test('最初の行より上は先頭になる', () => {
  const { pages } = grid();

  assert.equal(plan.dropIndex({ layout: { pages }, columns: 3, x: 50, y: -9999 }), 0);
});

// 1列のときは左右ではなく上下で決める。左右で決めると、紙の右半分に置いた
// だけで「次のページの手前」になってしまう。
test('1列のときは枠の上下で判定する', () => {
  const { pages } = grid({ columns: 1, count: 3 });

  assert.equal(plan.dropIndex({ layout: { pages }, columns: 1, x: 50, y: 50 }), 0);
  assert.equal(plan.dropIndex({ layout: { pages }, columns: 1, x: 50, y: 150 }), 1);
  assert.equal(plan.dropIndex({ layout: { pages }, columns: 1, x: 50, y: 250 }), 1);
});

test('ページが1枚も無ければ 0 を返す', () => {
  assert.equal(plan.dropIndex({ layout: { pages: [] }, columns: 3, x: 10, y: 10 }), 0);
  assert.equal(plan.dropIndex({ layout: null, columns: 3, x: 10, y: 10 }), 0);
});

// ---- ドラッグ中の自動スクロール（確定事項36） ----

test('パネルの端に寄せた向きへスクロールする', () => {
  const panel = { viewportHeight: 600, edge: 40, step: 12 };

  assert.equal(plan.autoScrollStep({ y: 10, ...panel }), -12);
  assert.equal(plan.autoScrollStep({ y: 590, ...panel }), 12);
});

test('端から離れていればスクロールしない', () => {
  const panel = { viewportHeight: 600, edge: 40, step: 12 };

  assert.equal(plan.autoScrollStep({ y: 300, ...panel }), 0);
  // ちょうど境目は動かさない。触れた瞬間に流れ出すと落とし先を狙えない。
  assert.equal(plan.autoScrollStep({ y: 40, ...panel }), 0);
  assert.equal(plan.autoScrollStep({ y: 560, ...panel }), 0);
});

test('パネルの高さが取れないときは動かさない', () => {
  assert.equal(plan.autoScrollStep({ y: 10, viewportHeight: 0, edge: 40, step: 12 }), 0);
  assert.equal(plan.autoScrollStep({ y: 10, viewportHeight: 600, edge: 0, step: 12 }), 0);
});
