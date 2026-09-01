'use strict';

// ワーカーを束ねる層のテスト（spec-1-6 確定事項1〜10）。
//
// utilityProcess は引数で受け取る作りなので、ここでは偽の子プロセスを渡す。
// 本物の utilityProcess が asar の中から起動できることは実測で確かめてあり
// （spec-1-6 事前調査 A）、配布物での確認は起動確認（SIGK_SMOKE_SAVE）で行う。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { PHASES, phaseStep, createTaskRunner } = require('../task-runner.js');
const { tempPathFor } = require('../pdf-write.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));

// 偽のワーカー。react(child, message) で、受け取った run への反応を決める。
function fakeUtilityProcess(react, { forkThrows = false } = {}) {
  const forked = [];
  const utilityProcess = {
    fork(workerPath) {
      if (forkThrows)
        throw new Error('ENOENT');
      const child = new EventEmitter();
      child.workerPath = workerPath;
      child.killed = false;
      child.postMessage = (message) => setImmediate(() => react(child, message));
      child.kill = () => {
        if (child.killed)
          return;
        child.killed = true;
        setImmediate(() => child.emit('exit', 0));
      };
      forked.push(child);
      setImmediate(() => child.emit('spawn'));
      return child;
    },
  };
  return { utilityProcess, forked };
}

// 5段を順に報告してから done を返す、行儀のよいワーカー。
function politeWorker(result) {
  return (child, message) => {
    if (message?.type !== 'run')
      return;
    for (const phase of PHASES)
      child.emit('message', { type: 'progress', phase });
    child.emit('message', { type: 'done', result });
  };
}

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-task-'));
  return {
    dir,
    file: (name) => path.join(dir, name),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('段の並びは read から write までの5つ', () => {
  assert.deepEqual(PHASES, ['read', 'load', 'apply', 'save', 'write']);
  assert.deepEqual(phaseStep('read'), { phase: 'read', label: '読み込んでいます', step: 1, total: 5 });
  assert.equal(phaseStep('unknown'), null);
});

test('成功したら結果をそのまま返し、進捗を順に流す', async () => {
  const { utilityProcess, forked } = fakeUtilityProcess(politeWorker({ ok: true, path: 'a.pdf' }));
  const runner = createTaskRunner({ utilityProcess, workerPath: 'worker/pdf-task.js' });
  const seen = [];
  const result = await runner.run('t1', { source: 'a.pdf', target: 'a.pdf' }, {
    onProgress: (progress) => seen.push(progress.phase),
  });
  assert.deepEqual(result, { ok: true, path: 'a.pdf' });
  assert.deepEqual(seen, PHASES);
  assert.equal(forked.length, 1);
  assert.equal(forked[0].workerPath, 'worker/pdf-task.js');
  assert.equal(forked[0].killed, true, '終わったらプロセスを落とす');
});

test('進捗には何段目かが付く', async () => {
  const { utilityProcess } = fakeUtilityProcess(politeWorker({ ok: true }));
  const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js' });
  const seen = [];
  await runner.run('t1', { target: 'a.pdf' }, { onProgress: (p) => seen.push(p.step + '/' + p.total) });
  assert.deepEqual(seen, ['1/5', '2/5', '3/5', '4/5', '5/5']);
});

test('知らない段の名前は流さない', async () => {
  const { utilityProcess } = fakeUtilityProcess((child, message) => {
    if (message?.type !== 'run')
      return;
    child.emit('message', { type: 'progress', phase: 'nonsense' });
    child.emit('message', { type: 'done', result: { ok: true } });
  });
  const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js' });
  const seen = [];
  await runner.run('t1', { target: 'a.pdf' }, { onProgress: (p) => seen.push(p) });
  assert.deepEqual(seen, []);
});

test('中止すると canceled を返し、書きかけの一時ファイルを消す', async () => {
  const ws = workspace();
  try {
    const target = ws.file('a.pdf');
    fs.writeFileSync(target, 'OLD');
    fs.writeFileSync(tempPathFor(target), '書きかけ');
    const { utilityProcess } = fakeUtilityProcess(() => {});
    const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js' });
    const promise = runner.run('t1', { source: target, target }, {});
    await tick();
    assert.equal(runner.isRunning('t1'), true);
    assert.deepEqual(runner.cancel('t1'), { ok: true });
    assert.deepEqual(await promise, { canceled: true });
    assert.equal(fs.existsSync(tempPathFor(target)), false, '一時ファイルは残さない');
    assert.equal(fs.readFileSync(target, 'utf8'), 'OLD', '元ファイルは無傷');
    assert.equal(runner.isRunning('t1'), false);
  } finally { ws.cleanup(); }
});

test('走っていないタスクの中止は空振りする', () => {
  const { utilityProcess } = fakeUtilityProcess(() => {});
  const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js' });
  assert.deepEqual(runner.cancel('いない'), { ok: false });
});

test('成功したときは一時ファイルを触らない', async () => {
  const ws = workspace();
  try {
    const target = ws.file('a.pdf');
    const stray = tempPathFor(target);
    fs.writeFileSync(stray, 'これは別物');
    const { utilityProcess } = fakeUtilityProcess(politeWorker({ ok: true }));
    const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js' });
    await runner.run('t1', { target }, {});
    assert.equal(fs.existsSync(stray), true, '成功時は rename 済みなので、ここでは消さない');
  } finally { ws.cleanup(); }
});

test('失敗したときも書きかけを消す', async () => {
  const ws = workspace();
  try {
    const target = ws.file('a.pdf');
    fs.writeFileSync(tempPathFor(target), '書きかけ');
    const { utilityProcess } = fakeUtilityProcess(politeWorker({ error: 'だめでした' }));
    const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js' });
    const result = await runner.run('t1', { target }, {});
    assert.deepEqual(result, { error: 'だめでした' });
    assert.equal(fs.existsSync(tempPathFor(target)), false);
  } finally { ws.cleanup(); }
});

test('ワーカーが黙って落ちたら、人が読める文言にしてログへ残す', async () => {
  const logged = [];
  const { utilityProcess } = fakeUtilityProcess((child, message) => {
    if (message?.type === 'run')
      child.emit('exit', 1);
  });
  const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js', onError: (e) => logged.push(e) });
  const result = await runner.run('t1', { source: 'a.pdf', target: 'a.pdf' }, {});
  assert.match(result.error, /元のファイルは変更していません/);
  assert.equal(logged.length, 1);
  assert.match(logged[0].message, /異常終了/);
});

test('ワーカーを起動できなければ、その旨を返す', async () => {
  const logged = [];
  const { utilityProcess } = fakeUtilityProcess(() => {}, { forkThrows: true });
  const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js', onError: (e) => logged.push(e) });
  const result = await runner.run('t1', { target: 'a.pdf' }, {});
  assert.deepEqual(result, { error: '保存の処理を開始できませんでした。' });
  assert.equal(logged.length, 1);
});

test('同じタスクを二重には走らせない', async () => {
  const { utilityProcess, forked } = fakeUtilityProcess(() => {});
  const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js' });
  const first = runner.run('t1', { target: 'a.pdf' }, {});
  await tick();
  const second = await runner.run('t1', { target: 'a.pdf' }, {});
  assert.deepEqual(second, { error: 'この文書はすでに保存中です。' });
  assert.equal(forked.length, 1, '2本目のプロセスは立てない');
  runner.cancel('t1');
  await first;
});

test('別のタスクなら同時に走らせる', async () => {
  const { utilityProcess, forked } = fakeUtilityProcess(() => {});
  const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js' });
  const a = runner.run('t1', { target: 'a.pdf' }, {});
  const b = runner.run('t2', { target: 'b.pdf' }, {});
  await tick();
  assert.equal(forked.length, 2);
  runner.cancelAll();
  assert.deepEqual(await a, { canceled: true });
  assert.deepEqual(await b, { canceled: true });
});

test('結果が返らないまま done が来たら、そう言う', async () => {
  const { utilityProcess } = fakeUtilityProcess((child, message) => {
    if (message?.type === 'run')
      child.emit('message', { type: 'done' });
  });
  const runner = createTaskRunner({ utilityProcess, workerPath: 'w.js' });
  const result = await runner.run('t1', { target: 'a.pdf' }, {});
  assert.match(result.error, /結果が返りませんでした/);
});
