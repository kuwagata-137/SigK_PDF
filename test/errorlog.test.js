'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { formatEntry, trimToTail, createErrorLog } = require('../errorlog.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-errorlog-'));
}

test('formatEntry は ISO 8601 の時刻と既定の level を付ける', () => {
  const entry = formatEntry({ message: '失敗しました' }, new Date('2026-08-31T01:02:03.000Z'));

  assert.equal(entry.ts, '2026-08-31T01:02:03.000Z');
  assert.equal(entry.level, 'error');
  assert.equal(entry.message, '失敗しました');
});

test('formatEntry は知らない level を error に寄せる', () => {
  assert.equal(formatEntry({ level: 'warn', message: 'x' }).level, 'warn');
  assert.equal(formatEntry({ level: 'info', message: 'x' }).level, 'info');
  assert.equal(formatEntry({ level: 'fatal', message: 'x' }).level, 'error');
  assert.equal(formatEntry({ level: 42, message: 'x' }).level, 'error');
});

test('formatEntry は Error からメッセージとスタックを取る', () => {
  const entry = formatEntry(new Error('壊れました'));

  assert.equal(entry.message, '壊れました');
  assert.ok(entry.stack.includes('Error: 壊れました'));
});

test('formatEntry は長すぎるメッセージを切る', () => {
  const entry = formatEntry({ message: 'あ'.repeat(9000) });

  assert.equal(entry.message.length, 4000);
});

test('formatEntry は循環参照を含む context でも落ちない', () => {
  const context = { name: 'loop' };
  context.self = context;

  const entry = formatEntry({ message: 'x', context });

  assert.equal(entry.context.name, 'loop');
  assert.equal(entry.context.self, '[Circular]');
});

test('formatEntry は関数を含む context でも落ちない', () => {
  const entry = formatEntry({ message: 'x', context: { cb: function handler() {} } });

  assert.equal(entry.context.cb, '[Function handler]');
});

test('append した行はすべて JSONL として読み戻せる', () => {
  const log = createErrorLog({ dir: makeTempDir() });

  assert.equal(log.append({ message: '1件目' }), true);
  assert.equal(log.append({ level: 'warn', message: '2件目' }), true);

  const lines = fs.readFileSync(log.filePath, 'utf8').split('\n').filter((line) => line !== '');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).message, '1件目');
  assert.equal(JSON.parse(lines[1]).level, 'warn');
});

test('readAll は壊れた行を読み飛ばす', () => {
  const log = createErrorLog({ dir: makeTempDir() });
  log.append({ message: '正常' });
  fs.appendFileSync(log.filePath, 'これは JSON ではない\n', 'utf8');
  log.append({ message: 'その後' });

  const entries = log.readAll();

  assert.equal(entries.length, 2);
  assert.equal(entries[1].message, 'その後');
});

test('trimToTail は上限内に収め、最新の行を残す', () => {
  const text = ['1行目', '2行目', '3行目', '4行目'].map((line) => `{"m":"${line}"}`).join('\n') + '\n';

  const trimmed = trimToTail(text, 60);

  assert.ok(Buffer.byteLength(trimmed, 'utf8') <= 30);
  assert.ok(trimmed.includes('4行目'), '最新の行が残っていない');
  assert.equal(trimmed.includes('1行目'), false, '最も古い行が残っている');
});

test('上限を超えたら古い行を捨てて書き込みを続ける', () => {
  const log = createErrorLog({ dir: makeTempDir(), maxBytes: 2048 });

  for (let i = 0; i < 200; i += 1)
    log.append({ message: `${i}件目のエラー`.padEnd(60, '_') });

  assert.ok(fs.statSync(log.filePath).size <= 2048 + 200);
  const entries = log.readAll();
  assert.ok(entries.length > 0);
  assert.ok(entries[entries.length - 1].message.startsWith('199件目'), '最新の行が残っていない');
});

test('書き込めなくても例外を投げず false を返す', () => {
  const dir = makeTempDir();
  // ログのディレクトリと同じ名前のファイルを先に置き、mkdir を失敗させる。
  const blocked = path.join(dir, 'logs');
  fs.writeFileSync(blocked, 'ここはファイル', 'utf8');
  const log = createErrorLog({ dir: blocked });

  assert.equal(log.append({ message: '届かない' }), false);
  assert.deepEqual(log.readAll(), []);
});

test('createErrorLog は dir が無いと落ちる', () => {
  assert.throws(() => createErrorLog({}), /dir/);
});
