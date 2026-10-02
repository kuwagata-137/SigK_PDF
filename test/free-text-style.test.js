'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, placeText, plain } = require('./text-helpers.js');

// テキストの書式の欄（spec-4b-4a 確定事項A・G5）。いまは文字の大きさだけ。

test('appliesTo はテキストの欄を、表示のみでないテキストに、8〜200・0.5 刻みの大きさと、真偽値の太字・斜体のときだけ当てる', async (t) => {
  const { SigK } = await withTextShell(t);
  const style = SigK.freeTextStyle;
  const text = { kind: 'text', fontSize: 12, text: 'あ', rect: [100, 681, 116, 700], rotation: 0 };
  assert.deepEqual([...style.FIELDS], ['fontSize', 'bold', 'italic']);
  assert.equal(style.appliesTo('bold', text, true), true);
  assert.equal(style.appliesTo('italic', text, false), true);
  assert.equal(style.appliesTo('bold', text, 'yes'), false);
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

test('patchFor は回したテキストでも表示の左上を保つ', async (t) => {
  const shell = await withTextShell(t);
  const style = shell.SigK.freeTextStyle;
  const entry = placeText(shell, 100, 700, 'あいう');
  const turned = { ...entry, rotation: 90, rect: [100, 700 - 52, 119, 700] };
  const origin = shell.SigK.freeTextGeometry.frameOrigin(turned.rect, 90);
  const patch = style.patchFor('fontSize', 24, turned);
  assert.deepEqual(plain(shell.SigK.freeTextGeometry.frameOrigin(patch.rect, 90)), plain(origin));
  assert.equal(patch.rect[3] - patch.rect[1], 76, '90° のときは縦に並ぶ');
});

test('patchFor は固定の幅を保ち、新しい大きさの 1 字を下回るときだけ 1 字に広げる（確定事項C4）', async (t) => {
  const shell = await withTextShell(t);
  const style = shell.SigK.freeTextStyle;
  const entry = { ...placeText(shell, 100, 700, 'あいうえお'), width: 30 };
  const kept = style.patchFor('fontSize', 20, entry);
  assert.equal('width' in kept, false);
  assert.equal(kept.rect[2] - kept.rect[0], 30 + 4, '固定の幅＋余白');
  const widened = style.patchFor('fontSize', 48, entry);
  assert.equal(widened.width, 48);
  assert.equal(widened.rect[2] - widened.rect[0], 48 + 4);
});

test('patchFor は自動の幅を新しい大きさの 12 字で組み直す', async (t) => {
  const shell = await withTextShell(t);
  const style = shell.SigK.freeTextStyle;
  const entry = placeText(shell, 100, 700, 'あいうえおかきくけこさしすせそ');
  assert.equal(entry.width, 'auto');
  assert.equal(entry.rect[2] - entry.rect[0], 12 * 12 + 4);
  const patch = style.patchFor('fontSize', 10, entry);
  assert.equal(patch.rect[2] - patch.rect[0], 12 * 10 + 4);
  assert.equal(patch.rect[3], 700, '上端（表示の左上）は動かない');
});

// ---- 太字・斜体（spec-4b-4a 確定事項A2・G3） ----

test('patchFor は太字を付け外しし、今と同じなら null。新しい形はそのままの幅で箱を組み直す', async (t) => {
  const shell = await withTextShell(t);
  const style = shell.SigK.freeTextStyle;
  const entry = placeText(shell, 100, 700, 'あいう');
  assert.equal(style.patchFor('bold', false, entry), null);
  const bold = style.patchFor('bold', true, entry);
  assert.equal(bold.bold, true);
  assert.equal('width' in bold, false, '自動の幅のまま');
  assert.deepEqual(plain(bold.rect), plain(entry.rect), 'この見積もりでは太字でも字幅は同じ');
  assert.equal(style.patchFor('bold', true, { ...entry, bold: true }), null);
});

test('patchFor の斜体は中身の左上を動かさず、箱を左に 0.08em・右に 0.25em 広げる', async (t) => {
  const shell = await withTextShell(t);
  const style = shell.SigK.freeTextStyle;
  const entry = placeText(shell, 100, 700, 'あいう');
  const italic = style.patchFor('italic', true, entry);
  assert.equal(italic.italic, true);
  assert.deepEqual(plain(italic.rect), [100 - 0.96, entry.rect[1], entry.rect[2] + 3, 700]);
});

test('今までの形に太字を付けると、太字で測った最長の段落の幅を固定にした新しい形へ移り、行は変わらない', async (t) => {
  const shell = await withTextShell(t);
  const style = shell.SigK.freeTextStyle;
  const old = { src: 0, kind: 'text', color: '#222a35', opacity: 1, text: 'abc\nあいうえおかきくけこさしすせそ', fontSize: 10, rotation: 0, rect: [100, 671, 255, 700], quads: [[100, 700, 255, 700, 100, 671, 255, 671]] };
  const patch = style.patchFor('bold', true, old);
  assert.equal(patch.width, 150, '15 字 × 10pt。12 字で折り返さない');
  assert.equal(style.fixedWidthOf({ ...old, bold: true }), 150);
  assert.deepEqual(plain(patch.rect), [100, 671, 254, 700], '左上は動かず、今までの形の 1pt の伸びは無くなる');
  assert.deepEqual(plain(shell.SigK.freeTextMetrics.layoutOfEntry({ ...old, ...patch }).lines), ['abc', 'あいうえおかきくけこさしすせそ']);
  // 幅は 1 字を下回らない。
  assert.equal(style.fixedWidthOf({ ...old, text: 'a', bold: true }), 10);
});
