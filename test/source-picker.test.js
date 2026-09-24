'use strict';

// 1 つのファイルを対象にするツールの「対象」の欄（spec-4-5 確定事項34）。
// 分割・PDF→画像の画面テスト（tools-split.test.js・tools-to-image.test.js）が、この部品を通した
// 振る舞いを変えずに見ている。ここは部品そのもの（呼び出しの順・読み合いの競り・写し・描き方）を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

// jsdom の窓の中で作られたオブジェクトは Node 側と別の世界のものなので、比べる前に写す。
const plain = (value) => structuredClone(value);

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

async function openShell(t) {
  const shell = await createShell({});
  t.after(() => shell.cleanup());
  await shell.flush();
  return shell;
}

// inspect を外から解ける約束にする（読んでいる間の差し替えを確かめるため）。
function deferredInspect() {
  const waiting = new Map();
  const inspect = (filePath) => new Promise((resolve) => waiting.set(filePath, resolve));
  return { inspect, resolve: (filePath, info) => waiting.get(filePath)(info) };
}

test('setSource は読む前に onSelect・onChange を呼び、読めたら欄を埋めてもう一度 onChange', async (t) => {
  const { SigK } = await openShell(t);
  const calls = [];
  const { inspect, resolve } = deferredInspect();
  const field = SigK.sourcePicker.create({
    inspect, pick: () => null, dirtyMessage: 'x',
    emptyFields: { sizes: null },
    fieldsOf: (info) => ({ sizes: info.sizes }),
    onSelect: (filePath) => calls.push(['select', filePath]),
    onChange: () => calls.push(['change', field.source()?.pending]),
  });
  const pending = field.setSource(A);
  assert.deepEqual(calls, [['select', A], ['change', true]]);
  assert.deepEqual(plain(field.source()), { path: A, name: 'a.pdf', pageCount: null, sizes: null, blocked: null, note: null, pending: true });
  resolve(A, { pageCount: 3, name: 'a.pdf', sizes: [{ width: 1, height: 2 }] });
  assert.equal(await pending, true);
  assert.deepEqual(calls.at(-1), ['change', false]);
  assert.deepEqual(plain(field.source()), { path: A, name: 'a.pdf', pageCount: 3, sizes: [{ width: 1, height: 2 }], blocked: null, note: null, pending: false });
});

test('source() は写しを返し、配列を書き換えても中身は変わらない', async (t) => {
  const { SigK } = await openShell(t);
  const field = SigK.sourcePicker.create({
    inspect: async () => ({ pageCount: 1, name: 'a.pdf', sizes: [{ width: 1, height: 1 }] }),
    pick: () => null, dirtyMessage: 'x', emptyFields: { sizes: null }, fieldsOf: (info) => ({ sizes: info.sizes }),
  });
  await field.setSource(A);
  const copy = field.source();
  copy.sizes.push({ width: 9, height: 9 });
  copy.name = 'changed.pdf';
  assert.equal(field.source().sizes.length, 1);
  assert.equal(field.source().name, 'a.pdf');
});

test('読んでいる間に差し替えられたら、古い結果は捨てる', async (t) => {
  const { SigK } = await openShell(t);
  const { inspect, resolve } = deferredInspect();
  const field = SigK.sourcePicker.create({ inspect, pick: () => null, dirtyMessage: 'x' });
  const first = field.setSource(A);
  const second = field.setSource(B);
  resolve(A, { pageCount: 3, name: 'a.pdf' });
  assert.equal(await first, false);
  assert.equal(field.source().path, B);
  assert.equal(field.source().pending, true);
  resolve(B, { pageCount: 5, name: 'b.pdf' });
  assert.equal(await second, true);
  assert.equal(field.source().pageCount, 5);
});

test('読めなければ「選び直してください」を付けて止める', async (t) => {
  const { SigK } = await openShell(t);
  const field = SigK.sourcePicker.create({ inspect: async () => ({ reason: 'broken', error: 'この PDF を開けません' }), pick: () => null, dirtyMessage: 'x' });
  await field.setSource(A);
  assert.equal(field.source().blocked, 'この PDF を開けません。選び直してください');
  assert.equal(field.source().pageCount, null);
});

test('pickFile は今の対象を既定の場所にして選ばせ、使えない・やめたときは何もしない', async (t) => {
  const { SigK } = await openShell(t);
  const asked = [];
  const answers = [{ path: A }, { canceled: true }, null];
  const field = SigK.sourcePicker.create({
    inspect: async (filePath) => ({ pageCount: 1, name: filePath.split('\\').pop() }),
    pick: (options) => {
      asked.push(options);
      return answers.shift();
    },
    dirtyMessage: 'x',
  });
  assert.equal(await field.pickFile(), true);
  assert.equal(await field.pickFile(), false);
  assert.equal(await field.pickFile(), false);
  assert.deepEqual(plain(asked), [{ defaultPath: undefined }, { defaultPath: A }, { defaultPath: A }]);
  assert.equal(field.source().path, A);
});

test('addPaths は空の項目を除いて先頭だけを対象にし、2 本以上なら帯で伝える', async (t) => {
  const shell = await openShell(t);
  const field = shell.SigK.sourcePicker.create({ inspect: async () => ({ pageCount: 1, name: 'b.pdf' }), pick: () => null, dirtyMessage: 'x' });
  assert.equal(await field.addPaths([]), false);
  assert.equal(await field.addPaths(['', B, A]), true);
  assert.equal(field.source().path, B);
  assert.equal(shell.SigK.viewBanner.text(), shell.SigK.sourcePicker.NOTE_FIRST_ONLY);
});

test('render は対象の有無・読んでいる間・読めないときを欄に写す', async (t) => {
  const { SigK, document: doc } = await openShell(t);
  const make = (tag) => doc.createElement(tag);
  const elements = { file: make('div'), name: make('span'), pages: make('span'), note: make('span'), empty: make('p') };
  SigK.sourcePicker.render(elements, null);
  assert.equal(elements.file.hidden, true);
  assert.equal(elements.empty.hidden, false);
  SigK.sourcePicker.render(elements, { path: A, name: 'a.pdf', pageCount: null, blocked: null, note: '未保存の編集は反映されません', pending: true });
  assert.equal(elements.file.hidden, false);
  assert.equal(elements.empty.hidden, true);
  assert.equal(elements.file.title, A);
  assert.equal(elements.pages.textContent, '…');
  assert.equal(elements.note.textContent, '未保存の編集は反映されません');
  assert.equal(elements.note.classList.contains('error'), false);
  SigK.sourcePicker.render(elements, { path: A, name: 'a.pdf', pageCount: null, blocked: '開けません。選び直してください', note: null, pending: false });
  assert.equal(elements.pages.textContent, '');
  assert.equal(elements.file.classList.contains('blocked'), true);
  assert.equal(elements.note.textContent, '開けません。選び直してください');
  assert.equal(elements.note.classList.contains('error'), true);
  SigK.sourcePicker.render(elements, { path: A, name: 'a.pdf', pageCount: 3, blocked: null, note: null, pending: false });
  assert.equal(elements.pages.textContent, '3 ページ');
  assert.equal(elements.note.hidden, true);
});
