'use strict';

// 出力が複数あるタスク（分割）の後始末（spec-2-2 確定事項25）。
// task-runner.test.js と同じ偽のワーカーで、targets の一時ファイルだけを消し、
// 書き終えた出力は残すことを見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { createTaskRunner } = require('../task-runner.js');
const { tempPathFor } = require('../pdf-write.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeUtilityProcess(react) {
  return {
    fork() {
      const child = new EventEmitter();
      child.killed = false;
      child.postMessage = (message) => setImmediate(() => react(child, message));
      child.kill = () => {
        if (child.killed)
          return;
        child.killed = true;
        setImmediate(() => child.emit('exit', 0));
      };
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  };
}

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-task-split-'));
  return { dir, file: (name) => path.join(dir, name), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('中止すると targets それぞれの書きかけを消し、書き終えた出力は残す', async () => {
  const ws = workspace();
  try {
    const done = ws.file('a_001.pdf');
    const half = ws.file('a_002.pdf');
    fs.writeFileSync(done, 'DONE');
    fs.writeFileSync(tempPathFor(half), '書きかけ');
    fs.writeFileSync(tempPathFor(done), '別の書きかけ');
    const runner = createTaskRunner({ utilityProcess: fakeUtilityProcess(() => {}), workerPath: 'w.js' });
    const promise = runner.run('t1', { kind: 'split', source: ws.file('a.pdf'), targets: [done, half] }, {});
    await tick();
    runner.cancel('t1');
    assert.deepEqual(await promise, { canceled: true });
    assert.equal(fs.existsSync(tempPathFor(half)), false);
    assert.equal(fs.existsSync(tempPathFor(done)), false);
    assert.equal(fs.readFileSync(done, 'utf8'), 'DONE', '書き終えた出力は残す');
  } finally { ws.cleanup(); }
});

test('失敗したときも targets の書きかけを消す', async () => {
  const ws = workspace();
  try {
    const target = ws.file('a_001.pdf');
    fs.writeFileSync(tempPathFor(target), '書きかけ');
    const runner = createTaskRunner({
      utilityProcess: fakeUtilityProcess((child) => child.emit('message', { type: 'done', result: { error: 'だめ' } })),
      workerPath: 'w.js',
    });
    const result = await runner.run('t1', { kind: 'split', targets: [target] }, {});
    assert.equal(result.error, 'だめ');
    assert.equal(fs.existsSync(tempPathFor(target)), false);
  } finally { ws.cleanup(); }
});

test('targets が配列でなくても落ちない', async () => {
  const runner = createTaskRunner({
    utilityProcess: fakeUtilityProcess((child) => child.emit('message', { type: 'done', result: { error: 'だめ' } })),
    workerPath: 'w.js',
  });
  assert.equal((await runner.run('t1', { kind: 'split', targets: 'x' }, {})).error, 'だめ');
  assert.equal((await runner.run('t2', { kind: 'split' }, {})).error, 'だめ');
});
