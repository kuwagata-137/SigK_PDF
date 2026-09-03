'use strict';

// 出力先の同名確認の3択（spec-2-1 確定事項26〜28）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

async function open(shell, name = 'a_結合.pdf') {
  const promise = shell.SigK.confirmReplace.ask({ name });
  await shell.flush();
  return promise;
}

test('3つのボタンがそれぞれの答えを返す', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const { document: doc, SigK } = shell;

  let promise = open(shell);
  assert.equal(SigK.confirmReplace.isOpen(), true);
  assert.equal(doc.getElementById('confirm-replace-text').textContent, '「a_結合.pdf」は既にあります。上書きしますか。');
  doc.getElementById('confirm-replace-ok').click();
  assert.equal(await promise, 'replace');

  promise = open(shell);
  doc.getElementById('confirm-replace-rename').click();
  assert.equal(await promise, 'rename');

  promise = open(shell);
  doc.getElementById('confirm-replace-cancel').click();
  assert.equal(await promise, 'cancel');
  assert.equal(SigK.confirmReplace.isOpen(), false);
});

test('同名が複数あるときは、最初の1つと件数で1回だけ聞く（spec-2-2 確定事項22）', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const { document: doc, SigK } = shell;

  const promise = SigK.confirmReplace.ask({ name: 'a_001.pdf', count: 3 });
  await shell.flush();
  assert.equal(doc.getElementById('confirm-replace-text').textContent, '「a_001.pdf」など 3 件のファイルが既にあります。上書きしますか。');
  doc.getElementById('confirm-replace-ok').click();
  assert.equal(await promise, 'replace');

  const single = SigK.confirmReplace.ask({ name: 'a_001.pdf', count: 1 });
  await shell.flush();
  assert.equal(doc.getElementById('confirm-replace-text').textContent, '「a_001.pdf」は既にあります。上書きしますか。');
  doc.getElementById('confirm-replace-cancel').click();
  await single;
});

test('既定のフォーカスは「中止」にあり、「上書き」だけが danger', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const { document: doc } = shell;

  const promise = open(shell);
  assert.equal(doc.activeElement, doc.getElementById('confirm-replace-cancel'));
  assert.equal(doc.getElementById('confirm-replace-ok').classList.contains('danger'), true);
  assert.equal(doc.getElementById('confirm-replace-rename').classList.contains('danger'), false);
  assert.equal(doc.getElementById('confirm-replace-cancel').classList.contains('danger'), false);
  doc.getElementById('confirm-replace-cancel').click();
  await promise;
});

test('Esc（cancel イベント）は中止と同じ', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const promise = open(shell);
  shell.document.getElementById('confirm-replace').dispatchEvent(new shell.window.Event('cancel'));
  assert.equal(await promise, 'cancel');
});

test('開いている間にもう一度聞いても同じ答えを待つ', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const first = open(shell);
  const second = shell.SigK.confirmReplace.ask({ name: 'b.pdf' });
  shell.document.getElementById('confirm-replace-ok').click();
  assert.equal(await first, 'replace');
  assert.equal(await second, 'replace');
});
