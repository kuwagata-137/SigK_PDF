'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/pointer-mode-rules.js');

// 閲覧の［選択］［ハンド］の決まり（spec-2-5 確定事項K7〜K12。決定80 ㉒〜㉗）。状態（viewPointer）はアプリ全体で 1 つ。
// 閲覧・ページ編集ではツールバーの 1 組がそれを映し、編集モードでは編集の道具を映す。編集の道具とはハンドかどうかだけを引き継ぐ。

const rules = globalThis.SigK.pointerModeRules;

test('選択とハンドの 2 つだけで、既定は選択。知らない値は選択に落ちる', () => {
  assert.deepEqual([...rules.VIEW_POINTERS], ['select', 'hand']);
  assert.equal(rules.DEFAULT_POINTER, 'select');
  assert.equal(rules.normalize('hand'), 'hand');
  assert.equal(rules.normalize('select'), 'select');
  for (const value of [undefined, null, 'grab', 1, ''])
    assert.equal(rules.normalize(value), 'select', String(value));
});

test('1 組を使えるのは閲覧・ページ編集・編集で、ツールモードでは使えない（K3・K11）', () => {
  assert.deepEqual(['view', 'pages', 'annot', 'tools', 'nope'].map(rules.isUsable), [true, true, true, false, false]);
  // ページの表示を viewPointer で動かすのは閲覧とページ編集。編集モードは編集の道具で動く。
  assert.deepEqual(['view', 'pages', 'annot', 'tools'].map(rules.followsPointer), [true, true, false, false]);
});

test('押している方: 閲覧・ページ編集・ツールでは viewPointer、編集では道具が選択かハンドのときだけ（K7・K8）', () => {
  for (const mode of ['view', 'pages', 'tools']) {
    assert.equal(rules.pressedOf({ mode, pointer: 'hand', tool: 'pen' }), 'hand', mode);
    assert.equal(rules.pressedOf({ mode, pointer: 'select', tool: 'hand' }), 'select', mode);
    assert.equal(rules.pressedOf({ mode, pointer: 'zzz', tool: null }), 'select', mode);
  }
  assert.equal(rules.pressedOf({ mode: 'annot', pointer: 'select', tool: 'hand' }), 'hand');
  assert.equal(rules.pressedOf({ mode: 'annot', pointer: 'hand', tool: 'select' }), 'select');
  for (const tool of [null, 'pen', 'highlight', 'eraser', 'mosaic', 'trim', 'shape'])
    assert.equal(rules.pressedOf({ mode: 'annot', pointer: 'hand', tool }), null, `道具 ${tool} ではどちらも押していない形`);
});

test('編集の道具から決まる viewPointer は、ハンドならハンド、ほかは選択（K9。決定80 ㉗）', () => {
  assert.equal(rules.fromTool('hand'), 'hand');
  for (const tool of [null, 'select', 'pen', 'eraser', 'trim'])
    assert.equal(rules.fromTool(tool), 'select', String(tool));
});

test('左＋右で入れ替える（K7）', () => {
  assert.equal(rules.toggled('select'), 'hand');
  assert.equal(rules.toggled('hand'), 'select');
});

// 閲覧・ページ編集で選んだ方は、編集モードへ入るとき（起動時に編集モードで始まるときも）に編集の道具へ映す（K9・K10）。
// undefined は「道具を変えない」、null は「道具なしにする」。
test('編集へ入るとき: ハンドなら道具をハンドに、選択なら道具がハンドのときだけ戻り先へ戻す', () => {
  assert.equal(rules.toolOnEnter('hand', { tool: null, base: null }), 'hand');
  assert.equal(rules.toolOnEnter('hand', { tool: 'pen', base: 'select' }), 'hand');
  assert.equal(rules.toolOnEnter('hand', { tool: 'hand', base: null }), undefined);
  assert.equal(rules.toolOnEnter('select', { tool: 'hand', base: 'select' }), 'select');
  assert.equal(rules.toolOnEnter('select', { tool: 'hand', base: null }), null);
  for (const tool of [null, 'select', 'pen', 'eraser'])
    assert.equal(rules.toolOnEnter('select', { tool, base: null }), undefined, String(tool));
});

test('Esc の最後の段は、ハンドを選択へ戻す。選択なら何もしない（K12）', () => {
  assert.equal(rules.escaped('hand'), 'select');
  assert.equal(rules.escaped('select'), null);
});
