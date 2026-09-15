'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-plan.js');
const plan = globalThis.SigK.pagePlan;
// 履歴は edit-history.js にある（テストも test/edit-history.test.js）。編集の状態を
// 受け取って返すだけの層で、並べ替えや回転そのものは知らない。

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
