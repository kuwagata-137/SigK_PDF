'use strict';

// 一覧の行のポインタドラッグ（spec-3-1 確定事項36）。
//
// 結合の一覧から切り出した層で、結合と変換が共用する。ここでは結合・変換の画面に
// 頼らず、その場で作った素の一覧に結線して、掴む・落とす・止めるの筋だけを見る。
// 画面ごしの動きは tools-merge.test.js と tools-convert.test.js が見ている。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

// 素の一覧を1つ作って結線する。行は data-id を持つだけの div で、
// 範囲欄の代わりに input と button を1つずつ持たせる（掴まない証拠に使う）。
async function createList(t, { count = 3, isLocked } = {}) {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const doc = shell.document;

  const list = doc.createElement('div');
  list.id = 'drag-list';
  for (let i = 0; i < count; i += 1) {
    const row = doc.createElement('div');
    row.className = 'test-row';
    row.dataset.id = `row-${i}`;
    const input = doc.createElement('input');
    input.type = 'text';
    const button = doc.createElement('button');
    button.type = 'button';
    row.append(input, button);
    list.append(row);
  }
  doc.body.append(list);

  const drops = [];
  const handle = shell.SigK.rowDrag.attachRowDrag({
    doc,
    list,
    rowSelector: '.test-row',
    onDrop: (id, at) => drops.push({ id, at }),
    ...(isLocked === undefined ? {} : { isLocked }),
  });
  t.after(() => handle.detach());

  return { shell, doc, list, handle, drops };
}

const rowNodes = (list) => [...list.querySelectorAll('.test-row')];
const firstRow = (list) => rowNodes(list)[0];

test('しきい値より小さい動きでは掴まない', async (t) => {
  const { shell, doc, list, handle } = await createList(t);
  shell.firePointer(firstRow(list), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 10 + shell.SigK.rowDrag.DRAG_THRESHOLD - 1 });
  assert.equal(handle.isDragging(), false);
  assert.equal(list.querySelector('.drop-line'), null);
});

test('しきい値を超えると掴み、落とすと onDrop が呼ばれる', async (t) => {
  const { shell, doc, list, handle, drops } = await createList(t);
  shell.firePointer(firstRow(list), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });

  assert.equal(handle.isDragging(), true);
  assert.equal(firstRow(list).classList.contains('dragging'), true);
  assert.notEqual(list.querySelector('.drop-line'), null);

  shell.firePointer(list, 'pointerup', { x: 5, y: 40 });

  // jsdom では rect がすべて 0 なので、y > 0 で落とすと末尾（行数）になる。
  assert.deepEqual(drops, [{ id: 'row-0', at: 3 }]);
  assert.equal(handle.isDragging(), false);
  assert.equal(list.querySelector('.drop-line'), null);
  assert.equal(firstRow(list).classList.contains('dragging'), false);
});

test('一覧の外で離すと落とさない', async (t) => {
  const { shell, doc, list, drops } = await createList(t);
  shell.firePointer(firstRow(list), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  shell.firePointer(doc.body, 'pointerup', { x: 5, y: 400 });
  assert.deepEqual(drops, []);
  assert.equal(list.querySelector('.drop-line'), null);
});

test('Esc で取り消すと、そのまま離しても落ちない', async (t) => {
  const { shell, doc, list, handle, drops } = await createList(t);
  shell.firePointer(firstRow(list), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  doc.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  assert.equal(handle.isDragging(), false);
  shell.firePointer(list, 'pointerup', { x: 5, y: 40 });
  assert.deepEqual(drops, []);
});

test('入力欄・ボタンの上で押しても掴まない', async (t) => {
  const { shell, doc, list, handle } = await createList(t);
  for (const selector of ['input', 'button']) {
    shell.firePointer(firstRow(list).querySelector(selector), 'pointerdown', { x: 5, y: 10 });
    shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
    assert.equal(handle.isDragging(), false, `${selector} の上では掴まない`);
    shell.firePointer(list, 'pointerup', { x: 5, y: 40 });
  }
});

test('右ボタンでは掴まない', async (t) => {
  const { shell, doc, list, handle } = await createList(t);
  shell.firePointer(firstRow(list), 'pointerdown', { x: 5, y: 10, button: 2 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  assert.equal(handle.isDragging(), false);
});

test('isLocked が真なら始まらない（実行中は並べ替えさせない）', async (t) => {
  let locked = true;
  const { shell, doc, list, handle, drops } = await createList(t, { isLocked: () => locked });

  shell.firePointer(firstRow(list), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  assert.equal(handle.isDragging(), false);
  shell.firePointer(list, 'pointerup', { x: 5, y: 40 });
  assert.deepEqual(drops, []);

  // 解けば掴める。
  locked = false;
  shell.firePointer(firstRow(list), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  assert.equal(handle.isDragging(), true);
  shell.firePointer(list, 'pointerup', { x: 5, y: 40 });
  assert.equal(drops.length, 1);
});

test('dropIndexFor は行の中心より下を数える', async (t) => {
  const { list, handle } = await createList(t);
  // jsdom の rect はすべて 0。y が 0 以上なら全行の中心を越えるので末尾になる。
  assert.equal(handle.dropIndexFor(0), rowNodes(list).length);
  assert.equal(handle.dropIndexFor(-1), 0);
});

test('detach すると反応しなくなる', async (t) => {
  const { shell, doc, list, handle, drops } = await createList(t);
  handle.detach();
  shell.firePointer(firstRow(list), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  shell.firePointer(list, 'pointerup', { x: 5, y: 40 });
  assert.equal(handle.isDragging(), false);
  assert.deepEqual(drops, []);
});

test('2つの一覧に結線しても状態が混ざらない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const doc = shell.document;

  const make = (id) => {
    const list = doc.createElement('div');
    list.id = id;
    const row = doc.createElement('div');
    row.className = `${id}-row`;
    row.dataset.id = `${id}-0`;
    list.append(row);
    doc.body.append(list);
    const drops = [];
    const handle = shell.SigK.rowDrag.attachRowDrag({
      doc,
      list,
      rowSelector: `.${id}-row`,
      onDrop: (rowId, at) => drops.push({ id: rowId, at }),
    });
    t.after(() => handle.detach());
    return { list, handle, drops };
  };

  const left = make('left');
  const right = make('right');

  shell.firePointer(left.list.querySelector('.left-row'), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  assert.equal(left.handle.isDragging(), true);
  assert.equal(right.handle.isDragging(), false);

  shell.firePointer(left.list, 'pointerup', { x: 5, y: 40 });
  assert.equal(left.drops.length, 1);
  assert.deepEqual(right.drops, []);
});
