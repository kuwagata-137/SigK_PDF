'use strict';

// 画面で起きたエラーをメインの記録へ流す口（renderer/log.js）。spec-6-1 タスク B の B9 で、formatClientError・report・warn の
// 単体のテストを足した（今までは shell.test.js の「二度 install しない」だけだった）。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/log.js');

const { formatClientError, report, warn } = globalThis.SigK.log;

// appLogAPI の代わりを置いて fn を回し、届いた中身を返す。
async function withApi(fn, { fails = false } = {}) {
  const sent = [];
  const saved = globalThis.appLogAPI;
  globalThis.appLogAPI = {
    available: true,
    error: async (entry) => {
      if (fails)
        throw new Error('IPC が切れた');
      sent.push(entry);
      return { ok: true };
    },
  };
  try {
    const result = await fn();
    return { sent, result };
  } finally {
    globalThis.appLogAPI = saved;
  }
}

test('formatClientError は unhandledrejection の reason から message と stack を取る', () => {
  const reason = new Error('拒否された');
  const entry = formatClientError('unhandledrejection', { reason });
  assert.equal(entry.level, 'error');
  assert.equal(entry.message, '拒否された');
  assert.match(entry.stack, /Error: 拒否された/);
  assert.deepEqual(entry.context, { source: 'unhandledrejection' });
});

test('formatClientError は window の error から、場所（url・行・桁）も取る', () => {
  const error = new Error('落ちた');
  const entry = formatClientError('window.error', { message: '落ちた', error, filename: 'app://sigk/x.js', lineno: 3, colno: 7 });
  assert.equal(entry.message, '落ちた');
  assert.deepEqual(entry.context, { source: 'window.error', url: 'app://sigk/x.js', line: 3, column: 7 });
});

test('formatClientError は長すぎる message を 4,000 字で切る', () => {
  assert.equal(formatClientError('x', 'あ'.repeat(5000)).message.length, 4000);
});

test('report は appLogAPI へ渡し、IPC が失敗しても投げずに { ok: false } を返す', async () => {
  const { sent, result } = await withApi(() => report({ level: 'warn', message: 'm' }));
  assert.deepEqual(sent, [{ level: 'warn', message: 'm' }]);
  assert.deepEqual(result, { ok: true });
  const failed = await withApi(() => report({ message: 'm' }), { fails: true });
  assert.deepEqual(failed.result, { ok: false });
});

test('warn は、出どころ・何が起きたか・握った例外の中身を、level warn の 1 行にする', async () => {
  const error = new TypeError('読めない');
  const { sent } = await withApi(() => warn('annotation-import', '3 ページ目の書き込みを読めませんでした', error, { page: 2 }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].level, 'warn');
  assert.equal(sent[0].message, '3 ページ目の書き込みを読めませんでした');
  assert.match(sent[0].stack, /TypeError: 読めない/);
  assert.deepEqual(sent[0].context, { source: 'annotation-import', page: 2, error: '読めない' });
});

test('warn は Error でないもの（文字列・undefined）も受ける', async () => {
  const { sent } = await withApi(async () => {
    await warn('app', '設定を読めませんでした', 'not-json');
    await warn('app', '理由なし');
  });
  assert.deepEqual(sent[0].context, { source: 'app', error: 'not-json' });
  assert.equal('stack' in sent[0], false);
  assert.deepEqual(sent[1].context, { source: 'app' });
});
