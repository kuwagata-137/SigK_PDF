'use strict';

// 段の中の進み（spec-2-1 確定事項22）。結合は入力が複数あるので、
// read と apply をファイル単位で刻む。偽の子プロセスは task-runner.test.js と同じ形。

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { phaseStep, createTaskRunner } = require('../task-runner.js');

function fakeUtilityProcess(react) {
  return {
    fork() {
      const child = new EventEmitter();
      child.postMessage = (message) => setImmediate(() => react(child, message));
      child.kill = () => {};
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  };
}

test('phaseStep は done / total を受けると of を添える', () => {
  assert.deepEqual(phaseStep('read', { done: 2, total: 5 }), {
    phase: 'read', label: '読み込んでいます', step: 1, total: 5, done: 2, of: 5,
  });
  // 付いていなければ従来どおり。半端な値も無視する。
  const plain = { phase: 'read', label: '読み込んでいます', step: 1, total: 5 };
  assert.deepEqual(phaseStep('read'), plain);
  assert.deepEqual(phaseStep('read', { done: 1 }), plain);
  assert.deepEqual(phaseStep('read', { done: 0, total: 0 }), plain);
});

test('ワーカーの progress に done / total が付いていれば帯まで通す', async () => {
  const utilityProcess = fakeUtilityProcess((child, message) => {
    if (message?.type !== 'run')
      return;
    child.emit('message', { type: 'progress', phase: 'read', done: 1, total: 3 });
    child.emit('message', { type: 'progress', phase: 'apply' });
    child.emit('message', { type: 'done', result: { ok: true } });
  });
  const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js' });
  const seen = [];
  await runner.run('t1', { target: 'a.pdf' }, { onProgress: (p) => seen.push(p) });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].done, 1);
  assert.equal(seen[0].of, 3);
  assert.equal(seen[1].done, undefined);
});
