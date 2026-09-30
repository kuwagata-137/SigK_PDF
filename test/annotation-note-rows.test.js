'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

// 右パネルの「本文」「作成者」の行（annotation-note-rows.js。spec-4-4 確定事項3〜5）。annotation-props.js から
// 移した（spec-4b-1a 確定事項36）。道具やノートを選んだときの出し入れは annotate-note.test.js が通しで見ており、
// ここは行そのものの振る舞いを見る。

async function withShell(t) {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  return shell;
}

function rows(shell) {
  const byId = (id) => shell.document.getElementById(id);
  return { contentsRow: byId('props-contents-row'), contents: byId('props-contents'), authorRow: byId('props-author-row'), author: byId('props-author') };
}

test('render は本文と作成者の行を出し入れし、作成者は editable のときだけ書き換えられる', async (t) => {
  const shell = await withShell(t);
  const noteRows = shell.SigK.annotationNoteRows;
  const el = rows(shell);

  assert.equal(noteRows.render({ text: '1行目\n2行目', author: '総務', editable: false }), true);
  assert.equal(el.contentsRow.hidden, false);
  assert.equal(el.contents.value, '1行目\n2行目');
  assert.equal(el.authorRow.hidden, false);
  assert.equal(el.author.value, '総務');
  assert.equal(el.author.readOnly, true);

  noteRows.render({ text: null, author: '経理', editable: true });
  assert.equal(el.contentsRow.hidden, true);
  assert.equal(el.author.readOnly, false);
  assert.equal(el.author.value, '経理');

  noteRows.render();
  assert.equal(el.contentsRow.hidden, true);
  assert.equal(el.authorRow.hidden, true);
});

test('書いている最中の欄の値は render で上書きしない', async (t) => {
  const shell = await withShell(t);
  const noteRows = shell.SigK.annotationNoteRows;
  const el = rows(shell);

  noteRows.render({ text: '元の本文', author: '総務', editable: true });
  el.contents.focus();
  el.contents.value = '書きかけ';
  noteRows.render({ text: '元の本文', author: '総務', editable: true });
  assert.equal(el.contents.value, '書きかけ');
});

test('本文は欄の外・Ctrl+Enter・Esc で、作成者は変えたときに annotate へ流す', async (t) => {
  const shell = await withShell(t);
  const noteRows = shell.SigK.annotationNoteRows;
  const el = rows(shell);
  const contents = [];
  const authors = [];
  shell.SigK.annotate.setContents = (text) => contents.push(text);
  shell.SigK.annotate.setAuthor = (author) => authors.push(author);

  noteRows.render({ text: '', author: '', editable: true });
  el.contents.focus();
  el.contents.value = 'Ctrl+Enter で確定';
  el.contents.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(contents[0], 'Ctrl+Enter で確定');
  assert.notEqual(shell.document.activeElement, el.contents, '確定したら欄を離れる');

  // Enter だけでは改行で、確定しない。Esc は欄を離れる（＝確定）。
  el.contents.focus();
  el.contents.value = 'Esc で確定';
  el.contents.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(contents.includes('Esc で確定'), false);
  el.contents.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(contents.at(-1), 'Esc で確定');
  assert.notEqual(shell.document.activeElement, el.contents);

  // 欄の外を押した（blur）ときも確定する。
  el.contents.focus();
  el.contents.value = '外を押して確定';
  el.contents.blur();
  assert.equal(contents.at(-1), '外を押して確定');

  el.author.value = '法務';
  el.author.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
  assert.deepEqual(authors, ['法務']);
});

test('focusContents は本文の行が出ているときだけ欄へ移る', async (t) => {
  const shell = await withShell(t);
  const noteRows = shell.SigK.annotationNoteRows;
  const el = rows(shell);

  noteRows.render({ text: null, author: null });
  assert.equal(noteRows.focusContents(), false);
  noteRows.render({ text: 'メモ', author: '', editable: false });
  assert.equal(noteRows.focusContents(), true);
  assert.equal(shell.document.activeElement, el.contents);
  // 右パネルの口からも同じく移れる（annotate-note.js が使う）。
  el.contents.blur();
  assert.equal(shell.SigK.annotationProps.focusContents(), true);
});
