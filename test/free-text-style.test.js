'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, placeText, plain } = require('./text-helpers.js');

// テキストの書式の欄（spec-4b-4a 確定事項A・G5）。いまは文字の大きさだけ。

test('appliesTo はテキストの欄を、表示のみでないテキストに、8〜200・0.5 刻みの大きさのときだけ当てる', async (t) => {
  const { SigK } = await withTextShell(t);
  const style = SigK.freeTextStyle;
  const text = { kind: 'text', fontSize: 12, text: 'あ', rect: [100, 681, 116, 700], rotation: 0 };
  assert.deepEqual([...style.FIELDS], ['fontSize']);
  assert.equal(style.appliesTo('fontSize', text, 24), true);
  assert.equal(style.appliesTo('fontSize', text, 13.5), true);
  assert.equal(style.appliesTo('fontSize', text, 13.3), false);
  assert.equal(style.appliesTo('fontSize', text, 201), false);
  assert.equal(style.appliesTo('fontSize', { ...text, readonly: true }, 24), false);
  assert.equal(style.appliesTo('fontSize', { kind: 'square', rect: [0, 0, 10, 10] }, 24), false);
  assert.equal(style.appliesTo('fontSize', null, 24), false);
  assert.equal(style.appliesTo('color', text, '#000000'), false, 'テキストだけの欄でなければ扱わない');
});

test('patchFor は大きさと、表示の左上を保って測り直した箱を返し、今と同じなら null', async (t) => {
  const shell = await withTextShell(t);
  const style = shell.SigK.freeTextStyle;
  const entry = placeText(shell, 100, 700, 'あいう');
  assert.equal(style.patchFor('fontSize', 12, entry), null);
  const patch = style.patchFor('fontSize', 24, entry);
  assert.equal(patch.fontSize, 24);
  // 全角 3 字 × 24 ＋ 余白 2 × 2。左上（x 100・y 700）は動かない。
  assert.equal(patch.rect[0], 100);
  assert.equal(patch.rect[3], 700);
  assert.equal(patch.rect[2] - patch.rect[0], 76);
  assert.equal(patch.quads.length, 1);
  assert.equal(style.patchFor('fontSize', 24, { ...entry, readonly: true }), null);
});

test('reframed は回したテキストでも表示の左上を保つ', async (t) => {
  const shell = await withTextShell(t);
  const style = shell.SigK.freeTextStyle;
  const entry = placeText(shell, 100, 700, 'あいう');
  const turned = { ...entry, rotation: 90, rect: [100, 700 - 52, 119, 700] };
  const origin = shell.SigK.freeTextGeometry.frameOrigin(turned.rect, 90);
  const frame = style.reframed(turned, 24);
  assert.deepEqual(plain(shell.SigK.freeTextGeometry.frameOrigin(frame.rect, 90)), plain(origin));
  assert.equal(frame.rect[3] - frame.rect[1], 76, '90° のときは縦に並ぶ');
});
