'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

// 見た目の欄を当てる値と、右パネルに出す形（spec-4b-3a 確定事項I）。当てる操作そのものは annotate-bulk.test.js が見る。

async function withPatch(t) {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  return shell.SigK.annotationStylePatch;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

const SQUARE = { kind: 'square', color: '#ff0000', fill: '#ffff00', lineStyle: 'solid', lineWidth: 2, opacity: 1, rect: [100, 100, 200, 200] };
const ARROW = { kind: 'arrow', color: '#0000ff', lineStyle: 'dashed', lineWidth: 3, opacity: 0.5, rect: [0, 0, 50, 50], paths: [[[0, 0], [50, 50]]] };
const INK = { kind: 'ink', color: '#0000ff', lineWidth: 2, opacity: 1, rect: [0, 0, 50, 50], paths: [[[0, 0], [50, 50]]] };
const HIGHLIGHT = { kind: 'highlight', color: '#ffff00', opacity: 1 };
const TEXT = { kind: 'text', color: '#000000', opacity: 1 };

test('appliesTo は欄ごとに当てられる種類を決める（確定事項I2 の表）。表示のみには当てない', async (t) => {
  const patch = await withPatch(t);
  assert.equal(patch.appliesTo('color', HIGHLIGHT, '#000000'), true);
  assert.equal(patch.appliesTo('color', { ...SQUARE, readonly: true }, '#000000'), false);
  assert.equal(patch.appliesTo('strokeNone', SQUARE, null), true);
  assert.equal(patch.appliesTo('strokeNone', { ...SQUARE, fill: null }, null), false, '塗りの無い四角は線なしにできない');
  assert.equal(patch.appliesTo('fill', ARROW, '#00ff00'), false);
  assert.equal(patch.appliesTo('fill', { ...SQUARE, color: null }, null), false, '線なしのまま塗りなしにはできない');
  assert.equal(patch.appliesTo('lineStyle', ARROW, 'dashed'), true);
  assert.equal(patch.appliesTo('lineStyle', ARROW, 'cloudy'), false, '直線・矢印は雲形を持てない');
  assert.equal(patch.appliesTo('lineStyle', INK, 'solid'), false, 'ペンは線種を選べない');
  assert.equal(patch.appliesTo('lineWidth', INK, 4), true);
  assert.equal(patch.appliesTo('lineWidth', TEXT, 4), false);
  assert.equal(patch.appliesTo('opacity', TEXT, 0.5), true);
  assert.equal(patch.appliesTo('opacity', HIGHLIGHT, 0.5), false);
});

test('patchFor は今と同じ値なら null。太さは /Rect も作り直す', async (t) => {
  const patch = await withPatch(t);
  assert.equal(patch.patchFor('color', '#ff0000', SQUARE), null);
  assert.deepEqual(plain(patch.patchFor('color', '#00ff00', SQUARE)), { color: '#00ff00' });
  assert.deepEqual(plain(patch.patchFor('strokeNone', null, SQUARE)), { color: null });
  assert.deepEqual(plain(patch.patchFor('fill', null, SQUARE)), { fill: null });
  assert.equal(patch.patchFor('lineStyle', 'dashed', ARROW), null);
  const width = patch.patchFor('lineWidth', 10, ARROW);
  assert.equal(width.lineWidth, 10);
  assert.ok(Array.isArray(width.rect) || typeof width.rect === 'object', '/Rect を作り直す');
  assert.equal(patch.patchFor('opacity', 0.5, ARROW), null);
  assert.equal(patch.patchFor('opacity', 0.5, HIGHLIGHT), null, '当てられない種類');
});

test('viewOf は 1 件ならそのまま、複数ならそろっていない欄を混在にし、値は主（最後）のもの（確定事項I1）', async (t) => {
  const patch = await withPatch(t);
  const one = patch.viewOf([SQUARE]);
  assert.equal(one.colorLabel, '線の色');
  assert.deepEqual(plain(one.color), { value: '#ff0000', mixed: false });
  assert.deepEqual(plain(one.lineStyle.styles), ['solid', 'dashed', 'cloudy']);
  const many = patch.viewOf([SQUARE, ARROW, INK]);
  assert.deepEqual(plain(many.color), { value: '#0000ff', mixed: true });
  assert.deepEqual(plain(many.fill), { value: '#ffff00', mixed: false }, '塗りは四角・丸だけで見る');
  assert.deepEqual(plain(many.lineStyle), { value: 'dashed', mixed: true, styles: ['solid', 'dashed', 'cloudy'] }, 'ペンは線種に数えない');
  assert.deepEqual(plain(many.lineWidth), { value: 2, mixed: true });
  assert.deepEqual(plain(many.opacity), { value: 1, mixed: true });
});

test('viewOf は持てる書き込みが無い欄を null にし、見出しが分かれたら「色」にする', async (t) => {
  const patch = await withPatch(t);
  const view = patch.viewOf([HIGHLIGHT, TEXT]);
  assert.equal(view.colorLabel, '色');
  assert.equal(view.fill, null);
  assert.equal(view.lineStyle, null);
  assert.equal(view.lineWidth, null);
  assert.deepEqual(plain(view.opacity), { value: 1, mixed: false }, 'テキストだけで見る');
  assert.equal(patch.viewOf([{ ...SQUARE, readonly: true }]), null, '表示のみだけなら行を出さない');
  assert.equal(patch.viewOf([null]), null);
});

test('viewOf のパレットの［なし］は、線なしは塗りのある四角・丸、塗りなしは線のある四角・丸があるときに選べる', async (t) => {
  const patch = await withPatch(t);
  const view = patch.viewOf([{ ...SQUARE, fill: null }, ARROW]);
  assert.equal(view.boxed, true);
  assert.equal(view.strokeNoneEnabled, false);
  assert.equal(view.fillNoneEnabled, true);
  assert.equal(patch.viewOf([ARROW]).boxed, false);
});

test('targetOf は書き込みを右パネルに渡す形にする', async (t) => {
  const patch = await withPatch(t);
  assert.deepEqual(plain(patch.targetOf({ kind: 'circle', color: '#000000', lineWidth: 2, readonly: true })), {
    kind: 'circle', readonly: true, color: '#000000', fill: null, lineStyle: 'solid', lineWidth: 2, opacity: 1, fontSize: null, bold: null, italic: null,
  });
  // テキストは文字の大きさも渡す（spec-4b-4a 確定事項G5）。
  assert.equal(patch.targetOf({ kind: 'text', color: '#222a35', fontSize: 18 }).fontSize, 18);
  assert.deepEqual([patch.targetOf({ kind: 'text', bold: true }).bold, patch.targetOf({ kind: 'text' }).italic], [true, false]);
});
