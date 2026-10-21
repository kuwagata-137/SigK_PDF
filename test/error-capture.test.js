'use strict';

// メインのエラーの記録の受け口（error-capture.js。spec-6-1 タスク B）。errorlog.js へ書く前に、出どころと版を付け、
// 記録の準備ができる前（app ready の前）に来たものはためておく。画面から届いた中身は形を確かめる。画面の処理や子プロセスが
// 落ちたときの記録の中身もここで作る（main.js には単体テストが無いので、判定をこちらに置く）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { EventEmitter } = require('node:events');

const {
  createErrorCapture, rendererEntry, renderGoneEntry, childGoneEntry, preloadErrorEntry, watchWebContents, watchChildren, PENDING_LIMIT,
} = require('../error-capture.js');

// errorlog.js の createErrorLog の代わり。append に来たものを控える。
function fakeLog(ok = true) {
  const lines = [];
  return { lines, append: (entry) => { lines.push(entry); return ok; } };
}

test('record は出どころと版を付けて記録に書く。出どころの既定は main', () => {
  const capture = createErrorCapture({ version: '1.0.0' });
  const log = fakeLog();
  capture.attach(log);

  assert.equal(capture.record({ message: 'x', context: { a: 1 } }), true);
  assert.equal(capture.record({ message: 'y' }, 'worker'), true);
  assert.deepEqual(log.lines, [
    { message: 'x', context: { a: 1 }, proc: 'main', version: '1.0.0' },
    { message: 'y', proc: 'worker', version: '1.0.0' },
  ]);
});

test('record は Error を受け取ると message と stack を取り出す', () => {
  const capture = createErrorCapture({ version: '1.0.0' });
  const log = fakeLog();
  capture.attach(log);
  capture.record(new Error('壊れました'));

  assert.equal(log.lines[0].message, '壊れました');
  assert.match(log.lines[0].stack, /Error: 壊れました/);
  assert.equal(log.lines[0].proc, 'main');
});

test('記録の準備ができる前の分はためておき、attach で古い順に書く。ためる間は console にも出す', () => {
  const shown = [];
  const capture = createErrorCapture({ version: '1.0.0', fallback: (entry) => shown.push(entry.message) });

  assert.equal(capture.record({ message: '1 件目' }), false, '書けていないので偽');
  capture.record({ message: '2 件目' });
  assert.equal(capture.pendingCount(), 2);
  assert.deepEqual(shown, ['1 件目', '2 件目']);

  const log = fakeLog();
  assert.equal(capture.attach(log), 2);
  assert.deepEqual(log.lines.map((entry) => entry.message), ['1 件目', '2 件目']);
  assert.equal(capture.pendingCount(), 0);
});

test('ためておいた分は、起きた時刻（ts）を持ったまま書く（attach した時刻にしない。点検の直し）', () => {
  const capture = createErrorCapture({ version: '1.0.0', fallback: () => {}, now: () => new Date('2026-10-20T01:02:03.000Z') });
  capture.record({ message: '準備の前' });
  const log = fakeLog();
  capture.attach(log);
  assert.equal(log.lines[0].ts, '2026-10-20T01:02:03.000Z');
  capture.record({ message: '準備のあと' });
  assert.equal('ts' in log.lines[1], false, '準備のあとは errorlog.js が書くときの時刻を付ける');
});

test(`ためておくのは ${PENDING_LIMIT} 件まで（それより後は console に出すだけ）`, () => {
  const capture = createErrorCapture({ version: '1.0.0', fallback: () => {} });
  for (let index = 0; index < PENDING_LIMIT + 5; index += 1)
    capture.record({ message: `${index}` });
  assert.equal(capture.pendingCount(), PENDING_LIMIT);
});

test('fromRenderer は画面から届いた中身の形を確かめ、出どころを renderer に決める', () => {
  const capture = createErrorCapture({ version: '1.0.0' });
  const log = fakeLog();
  capture.attach(log);

  capture.fromRenderer({ level: 'warn', message: 'm', stack: 's', context: { source: 'tip' }, proc: 'main', extra: 1 });
  assert.deepEqual(log.lines[0], { level: 'warn', message: 'm', stack: 's', context: { source: 'tip' }, proc: 'renderer', version: '1.0.0' },
    '画面は出どころを main と名乗れない。知らないキーは捨てる');
});

test('rendererEntry は、型の違う値を落とし、中身が無ければ「（中身の無い記録）」にする', () => {
  assert.deepEqual(rendererEntry({ level: 'fatal', message: 42, stack: {}, context: 'x' }), { level: 'error', message: '42' });
  assert.deepEqual(rendererEntry(null), { level: 'error', message: '（中身の無い記録）' });
  assert.deepEqual(rendererEntry('文字だけ'), { level: 'error', message: '文字だけ' });
  assert.deepEqual(rendererEntry({ level: 'info', message: '' }), { level: 'info', message: '（中身の無い記録）' });
});

test('renderGoneEntry は画面の処理が止まった理由と終わりのコードを残す。ふつうに閉じた（clean-exit）ときは記録しない', () => {
  assert.deepEqual(renderGoneEntry({ reason: 'crashed', exitCode: -1073741819 }), {
    level: 'error', message: '画面の処理が止まりました', context: { reason: 'crashed', exitCode: -1073741819 },
  });
  assert.equal(renderGoneEntry({ reason: 'clean-exit', exitCode: 0 }), null);
});

test('childGoneEntry は GPU などの子プロセスの異常を残し、ワーカー（ユーティリティの Node）とふつうの終わりは記録しない', () => {
  assert.deepEqual(childGoneEntry({ type: 'GPU', reason: 'crashed', exitCode: 3 }), {
    level: 'error', message: '子プロセスが止まりました', context: { type: 'GPU', reason: 'crashed', exitCode: 3 },
  });
  assert.equal(childGoneEntry({ type: 'Utility', serviceName: 'node.mojom.NodeService', reason: 'crashed', exitCode: 1 }), null,
    'ワーカーの異常終了は task-runner.js が記録する（二重に残さない）');
  assert.equal(childGoneEntry({ type: 'GPU', reason: 'clean-exit', exitCode: 0 }), null);
  assert.equal(childGoneEntry({ type: 'GPU', reason: 'killed', exitCode: 0 }), null, 'アプリが終わるときに落とした分');
  assert.equal(childGoneEntry({ type: 'Utility', serviceName: 'network.mojom.NetworkService', reason: 'crashed' }).context.serviceName,
    'network.mojom.NetworkService', 'ワーカーでないユーティリティは残す');
});

test('preloadErrorEntry は preload の失敗を、ファイルの名前と例外の中身で残す', () => {
  const error = new Error('読めない');
  const entry = preloadErrorEntry('C:/app/preload.js', error);
  assert.equal(entry.level, 'error');
  assert.equal(entry.message, 'preload の読み込みに失敗しました: 読めない');
  assert.match(entry.stack, /Error: 読めない/);
  assert.deepEqual(entry.context, { preload: 'preload.js' });
});

test('record は、中身が worker と名乗れば worker、それ以外は main として書く（画面は fromRenderer だけ）', () => {
  const capture = createErrorCapture({ version: '1.0.0' });
  const log = fakeLog();
  capture.attach(log);
  capture.record({ message: 'a', proc: 'worker' });
  capture.record({ message: 'b', proc: 'renderer' });
  assert.deepEqual(log.lines.map((entry) => entry.proc), ['worker', 'main']);
});

test('watchWebContents は、画面の処理が止まった・応答しない・応答を取り戻した・preload の失敗を記録し、止まったときは onGone を呼ぶ', () => {
  const contents = new EventEmitter();
  const written = [];
  const gone = [];
  watchWebContents(contents, (entry) => written.push(entry), (details) => gone.push(details.reason));

  contents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 1 });
  contents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  contents.emit('unresponsive');
  contents.emit('responsive');
  contents.emit('preload-error', {}, 'C:/app/preload.js', new Error('x'));

  assert.deepEqual(written.map((entry) => [entry.level, entry.message]), [
    ['error', '画面の処理が止まりました'],
    ['warn', '画面の処理が応答しません'],
    ['info', '画面の処理が応答を取り戻しました'],
    ['error', 'preload の読み込みに失敗しました: x'],
  ]);
  assert.deepEqual(gone, ['oom'], 'ふつうに閉じたとき（clean-exit）は onGone を呼ばない');
});

test('watchChildren は、記録する子プロセスの異常だけを書く', () => {
  const app = new EventEmitter();
  const written = [];
  watchChildren(app, (entry) => written.push(entry));

  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 3 });
  app.emit('child-process-gone', {}, { type: 'Utility', serviceName: 'node.mojom.NodeService', reason: 'crashed' });
  assert.equal(written.length, 1);
  assert.equal(written[0].context.type, 'GPU');
});
