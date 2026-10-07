'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

// 欄の Esc（spec-4b-7a 確定事項E。決定68 ②）。登録した欄を、Esc の振り分けが leave で戻す・確定して抜ける。

async function withField(t) {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const { document } = shell;
  const field = document.createElement('input');
  document.body.append(field);
  return { shell, field, fieldEscape: shell.SigK.fieldEscape };
}

test('shown を渡した欄は、打ちかけを捨てて shown の値に戻し、欄から抜ける', async (t) => {
  const { shell, field, fieldEscape } = await withField(t);
  fieldEscape.bind(field, { shown: () => '12' });
  field.focus();
  field.value = '99';
  assert.equal(fieldEscape.leave(field), true);
  assert.equal(field.value, '12');
  assert.notEqual(shell.document.activeElement, field);
});

test('抜ける間に出た change は飲み、戻した値を当て直さない', async (t) => {
  const { shell, field, fieldEscape } = await withField(t);
  const changes = [];
  field.addEventListener('change', () => changes.push(field.value));
  // Chromium は blur の中で change を出すことがある（打ち始めの値と違うとき）。jsdom には無いので作る。
  field.addEventListener('blur', () => field.dispatchEvent(new shell.window.Event('change')));
  fieldEscape.bind(field, { shown: () => '12' });
  field.focus();
  field.value = '99';
  fieldEscape.leave(field);
  assert.deepEqual(changes, []);
  // 抜けたあとの change は、いつもどおり届く。
  field.dispatchEvent(new shell.window.Event('change'));
  assert.deepEqual(changes, ['12']);
});

test('commit を渡した欄は確定して抜け、どちらも無い欄は抜けるだけ', async (t) => {
  const { shell, field, fieldEscape } = await withField(t);
  const committed = [];
  fieldEscape.bind(field, { commit: () => committed.push(field.value) });
  field.focus();
  field.value = '本文';
  assert.equal(fieldEscape.leave(field), true);
  assert.deepEqual(committed, ['本文']);
  assert.equal(field.value, '本文');
  assert.notEqual(shell.document.activeElement, field);

  const other = shell.document.createElement('select');
  shell.document.body.append(other);
  fieldEscape.bind(other);
  other.focus();
  assert.equal(fieldEscape.leave(other), true);
  assert.notEqual(shell.document.activeElement, other);
});

test('登録していない欄と null は false', async (t) => {
  const { field, fieldEscape } = await withField(t);
  assert.equal(fieldEscape.leave(field), false);
  assert.equal(fieldEscape.leave(null), false);
  assert.equal(fieldEscape.bind(null), false);
  assert.equal(fieldEscape.isBound(field), false);
});
