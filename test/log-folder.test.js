'use strict';

// メニュー「ヘルプ」→「エラーの記録のフォルダを開く」（log-folder.js。spec-6-1 タスク B の B7・docs/07 決定81 ⑧）。
// Electron の shell と fs は偽物を渡し、作る・開く・開けなかったときの記録を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { openLogFolder } = require('../log-folder.js');

const DIR = 'logs-dir';

function fakes({ openResult = '', openThrows = null, mkdirThrows = null } = {}) {
  const made = [];
  const opened = [];
  const logged = [];
  return {
    made, opened, logged,
    fsLike: { mkdirSync: (dir, options) => { if (mkdirThrows) throw mkdirThrows; made.push([dir, options]); } },
    shell: { openPath: async (dir) => { opened.push(dir); if (openThrows) throw openThrows; return openResult; } },
    logError: (entry) => logged.push(entry),
  };
}

test('記録のフォルダを（無ければ作ってから）エクスプローラーで開く', async () => {
  const f = fakes();
  assert.deepEqual(await openLogFolder({ dir: DIR, ...f }), { ok: true, dir: DIR });
  assert.deepEqual(f.made, [[DIR, { recursive: true }]]);
  assert.deepEqual(f.opened, [DIR]);
  assert.deepEqual(f.logged, []);
});

test('shell.openPath が理由の文を返したら、開けなかったことを記録に残す（窓は出さない）', async () => {
  const f = fakes({ openResult: 'Failed to open path' });
  assert.deepEqual(await openLogFolder({ dir: DIR, ...f }), { ok: false, dir: DIR });
  assert.equal(f.logged[0].message, 'エラーの記録のフォルダを開けませんでした');
  assert.deepEqual(f.logged[0].context, { dir: DIR, problem: 'Failed to open path' });
});

test('shell.openPath が投げても、フォルダを作れなくても、投げずに記録に残す', async () => {
  const thrown = fakes({ openThrows: new Error('boom') });
  assert.equal((await openLogFolder({ dir: DIR, ...thrown })).ok, false);
  assert.equal(thrown.logged[0].context.problem, 'boom');

  const blocked = fakes({ mkdirThrows: new Error('EACCES') });
  assert.equal((await openLogFolder({ dir: DIR, ...blocked })).ok, false);
  assert.deepEqual(blocked.opened, [], '作れなければ開きに行かない');
  assert.equal(blocked.logged[0].context.problem, 'EACCES');
});
