'use strict';

// メインのエラーの記録の受け口（spec-6-1 タスク B）。main.js が使う。
//   ・errorlog.js へ書く前に、出どころ（main・renderer・worker）と版を付ける
//   ・記録の準備ができる前（app ready の前。errorlog.js はユーザーのデータのフォルダが決まってから作る）に来た分はためておき、
//     attach で古い順に書く
//   ・画面から届いた中身（IPC log:error）は形を確かめる。画面は出どころを名乗れない
//   ・画面の処理・子プロセス・preload が落ちたときの記録の中身を作る
// このファイルは Electron を読まない（テストのため）。

const path = require('node:path');

const PENDING_LIMIT = 50;
const LEVELS = new Set(['error', 'warn', 'info']);
const EMPTY_MESSAGE = '（中身の無い記録）';
// ワーカー（utilityProcess.fork）の子プロセスの名前。異常終了は task-runner.js が記録するので、child-process-gone では残さない。
const WORKER_SERVICE = 'node.mojom.NodeService';
// 記録しない終わり方。clean-exit はふつうに閉じた、killed はアプリが終わるときに落とした分。
const QUIET_CHILD_REASONS = new Set(['clean-exit', 'killed']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Error・文字列・そのほかを、記録の中身の形 { message, stack?, ... } にする。
function toEntry(input) {
  if (input instanceof Error)
    return { message: input.message, stack: input.stack };
  if (isPlainObject(input))
    return input;
  return { message: input === undefined || input === null ? EMPTY_MESSAGE : String(input) };
}

// 画面から届いた中身の形を確かめる。使うのは level・message・stack・context だけで、型の違う値は落とす。
function rendererEntry(raw) {
  if (!isPlainObject(raw))
    return { level: 'error', message: raw === undefined || raw === null ? EMPTY_MESSAGE : String(raw) };
  const entry = { level: LEVELS.has(raw.level) ? raw.level : 'error' };
  const message = typeof raw.message === 'string' ? raw.message : (raw.message === undefined || raw.message === null ? '' : String(raw.message));
  entry.message = message === '' ? EMPTY_MESSAGE : message;
  if (typeof raw.stack === 'string' && raw.stack !== '')
    entry.stack = raw.stack;
  if (isPlainObject(raw.context))
    entry.context = raw.context;
  return entry;
}

// 画面の処理が止まった（render-process-gone）。ふつうに閉じたときは null。
function renderGoneEntry(details) {
  if (details?.reason === 'clean-exit')
    return null;
  return { level: 'error', message: '画面の処理が止まりました', context: { reason: details?.reason ?? null, exitCode: details?.exitCode ?? null } };
}

// 子プロセスが止まった（app の child-process-gone）。ワーカーとふつうの終わりは null。
function childGoneEntry(details) {
  if (QUIET_CHILD_REASONS.has(details?.reason))
    return null;
  if (details?.type === 'Utility' && details?.serviceName === WORKER_SERVICE)
    return null;
  const context = { type: details?.type ?? null, reason: details?.reason ?? null, exitCode: details?.exitCode ?? null };
  if (typeof details?.serviceName === 'string')
    context.serviceName = details.serviceName;
  if (typeof details?.name === 'string')
    context.name = details.name;
  return { level: 'error', message: '子プロセスが止まりました', context };
}

// preload の読み込みに失敗した（preload-error）。場所はファイルの名前だけを残す。
function preloadErrorEntry(preloadPath, error) {
  return {
    level: 'error',
    message: `preload の読み込みに失敗しました: ${error?.message ?? String(error)}`,
    stack: error?.stack,
    context: { preload: typeof preloadPath === 'string' ? path.basename(preloadPath) : null },
  };
}

// 画面の処理（webContents）を見張る。止まった・応答しない・応答を取り戻した・preload の失敗を記録し、止まったとき
// （ふつうに閉じたときを除く）は onGone(details) を呼ぶ（spec-6-1 タスク B の B1・B2）。
function watchWebContents(contents, logError, onGone = () => {}) {
  contents.on('render-process-gone', (_event, details) => {
    const entry = renderGoneEntry(details);
    if (entry === null)
      return;
    logError(entry);
    onGone(details);
  });
  contents.on('unresponsive', () => logError({ level: 'warn', message: '画面の処理が応答しません' }));
  contents.on('responsive', () => logError({ level: 'info', message: '画面の処理が応答を取り戻しました' }));
  contents.on('preload-error', (_event, preloadPath, error) => logError(preloadErrorEntry(preloadPath, error)));
}

// アプリの子プロセス（GPU など）を見張る。
function watchChildren(app, logError) {
  app.on('child-process-gone', (_event, details) => {
    const entry = childGoneEntry(details);
    if (entry !== null)
      logError(entry);
  });
}

// 中身が名乗る出どころ。メインの処理の中から書くのは main か worker だけ（renderer は fromRenderer で付ける）。
function procOf(entry) {
  return entry?.proc === 'worker' ? 'worker' : 'main';
}

// version は app.getVersion()。fallback は、記録の準備ができる前に中身を見せる口（既定は console.error）。
function createErrorCapture({ version, fallback = (entry) => console.error(entry) } = {}) {
  let log = null;
  const pending = [];

  function stamp(input, proc) {
    return { ...toEntry(input), proc, version };
  }

  // 記録に書く。書けたら真。準備ができる前はためて偽（ためるのは PENDING_LIMIT 件まで）。proc を渡さなければ中身の名乗り（procOf）。
  function record(input, proc) {
    const entry = stamp(input, proc ?? procOf(toEntry(input)));
    if (log === null) {
      fallback(entry);
      if (pending.length < PENDING_LIMIT)
        pending.push(entry);
      return false;
    }
    return log.append(entry);
  }

  // 記録の準備ができた。ためていた分を古い順に書き、その件数を返す。
  function attach(errorLog) {
    log = errorLog;
    const flushed = pending.splice(0);
    for (const entry of flushed)
      log.append(entry);
    return flushed.length;
  }

  return {
    record,
    attach,
    fromRenderer: (raw) => record(rendererEntry(raw), 'renderer'),
    pendingCount: () => pending.length,
  };
}

module.exports = {
  PENDING_LIMIT, createErrorCapture, rendererEntry, renderGoneEntry, childGoneEntry, preloadErrorEntry, watchWebContents, watchChildren,
};
