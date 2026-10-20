'use strict';

// ワーカーの失敗の形（worker/task-failure.js。spec-6-1 タスク B の B3）。画面に出す文はそのままに、記録に残す例外の中身（detail）を添える。
// task-runner.js が detail を記録に書き、画面へ返す結果からは外す。

const test = require('node:test');
const assert = require('node:assert/strict');

const { failure, errorDetail, STACK_LINES } = require('../worker/task-failure.js');

test('failure は画面に出す文と、例外の名前・中身・stack の先頭を返す', () => {
  const error = new TypeError('読めない');
  const result = failure('保存できません。', error);

  assert.equal(result.error, '保存できません。');
  assert.equal(result.detail.name, 'TypeError');
  assert.equal(result.detail.message, '読めない');
  assert.match(result.detail.stack, /^TypeError: 読めない/);
});

test(`stack は先頭の ${STACK_LINES} 行まで`, () => {
  const error = new Error('深い');
  error.stack = ['Error: 深い', ...Array.from({ length: 30 }, (_, index) => `    at f${index} (x.js:${index}:1)`)].join('\n');
  assert.equal(errorDetail(error).stack.split('\n').length, STACK_LINES);
});

test('Error でないもの（pdf-lib の embedPng は素の文字列を投げる）も、中身を文字にして残す', () => {
  assert.deepEqual(errorDetail('Not a PNG'), { name: 'string', message: 'Not a PNG' });
  assert.deepEqual(errorDetail({ code: 'EBUSY' }), { name: 'object', message: '{"code":"EBUSY"}' });
});

test('ワーカーの最後の受け口まで来た例外には unexpected の印を付ける（記録の level を error にする）', () => {
  assert.equal(failure('x', new Error('y'), { unexpected: true }).detail.unexpected, true);
  assert.equal('unexpected' in failure('x', new Error('y')).detail, false);
});

test('例外が無ければ detail を付けない', () => {
  assert.deepEqual(failure('書けません'), { error: '書けません' });
});
