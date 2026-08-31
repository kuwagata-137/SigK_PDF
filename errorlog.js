'use strict';

// エラーのローカルログ。<userData>/logs/error.log に JSONL で追記する。
// 外部へは送信しない（spec-0 確定事項8）。
// このファイルは Electron を require しない。ディレクトリは呼び出し側が渡す。

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = new Set(['error', 'warn', 'info']);
const MESSAGE_LIMIT = 4000;
const DEFAULT_MAX_BYTES = 512 * 1024;

function toMessage(value) {
  if (value instanceof Error)
    return value.message;
  if (typeof value === 'string')
    return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// 循環参照や関数を含む context でも落ちないようにする。
function safeContext(context) {
  if (context === undefined || context === null)
    return undefined;
  const seen = new WeakSet();
  try {
    return JSON.parse(JSON.stringify(context, (_key, value) => {
      if (typeof value === 'function')
        return `[Function ${value.name || 'anonymous'}]`;
      if (typeof value === 'bigint')
        return value.toString();
      if (typeof value !== 'object' || value === null)
        return value;
      if (seen.has(value))
        return '[Circular]';
      seen.add(value);
      return value;
    }));
  } catch {
    return { unserializable: true };
  }
}

function formatEntry(input, now = new Date()) {
  const source = input instanceof Error ? { message: input.message, stack: input.stack } : (input ?? {});
  const level = LEVELS.has(source.level) ? source.level : 'error';
  const message = toMessage(source.message ?? source).slice(0, MESSAGE_LIMIT);

  const entry = { ts: now.toISOString(), level, message };
  if (typeof source.stack === 'string' && source.stack !== '')
    entry.stack = source.stack.slice(0, MESSAGE_LIMIT);
  const context = safeContext(source.context);
  if (context !== undefined)
    entry.context = context;
  return entry;
}

// 上限を超えたら、末尾から maxBytes/2 に収まる分の完全な行だけを残す。
// 古い行を捨てて最新を残す。
function trimToTail(text, maxBytes) {
  const keep = Math.floor(maxBytes / 2);
  const lines = text.split('\n').filter((line) => line !== '');
  const kept = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const lineSize = Buffer.byteLength(lines[i], 'utf8') + 1;
    if (size + lineSize > keep)
      break;
    kept.unshift(lines[i]);
    size += lineSize;
  }
  return kept.length === 0 ? '' : `${kept.join('\n')}\n`;
}

function createErrorLog({ dir, fileName = 'error.log', maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!dir)
    throw new Error('createErrorLog: dir が必要です');

  const filePath = path.join(dir, fileName);

  function trimIfNeeded() {
    if (!fs.existsSync(filePath))
      return false;
    if (fs.statSync(filePath).size <= maxBytes)
      return false;
    fs.writeFileSync(filePath, trimToTail(fs.readFileSync(filePath, 'utf8'), maxBytes), 'utf8');
    return true;
  }

  // ログの書き込み失敗でアプリを落とさない。どんな理由でも例外を外に出さない。
  function append(input) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      trimIfNeeded();
      fs.appendFileSync(filePath, `${JSON.stringify(formatEntry(input))}\n`, 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  function readAll() {
    try {
      return fs.readFileSync(filePath, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((entry) => entry !== null);
    } catch {
      return [];
    }
  }

  return { filePath, append, trimIfNeeded, readAll };
}

module.exports = { DEFAULT_MAX_BYTES, formatEntry, trimToTail, createErrorLog };
