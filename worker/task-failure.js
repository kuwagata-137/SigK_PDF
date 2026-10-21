'use strict';

// ワーカーの失敗の形（spec-6-1 タスク B の B3）。画面に出す文（error）はそのままに、握った例外の中身（detail）を添える。
// task-runner.js が detail をエラーの記録に書き、画面へ返す結果からは外す。今までは例外を文に置き換えて捨てていたので、
// 保存や変換に失敗しても記録が空だった。

// 記録に残す stack の行数。
const STACK_LINES = 8;

// 例外の名前・中身・stack の先頭。Error でないもの（pdf-lib の embedPng は素の文字列を投げる）は、型の名前と中身の文字。
function errorDetail(error) {
  if (error instanceof Error) {
    const detail = { name: error.name, message: error.message };
    if (typeof error.stack === 'string')
      detail.stack = error.stack.split('\n').slice(0, STACK_LINES).join('\n');
    return detail;
  }
  let message;
  try {
    message = typeof error === 'string' ? error : JSON.stringify(error);
  } catch {
    message = String(error);
  }
  return { name: typeof error, message: String(message) };
}

// 画面に出す文 message と、握った例外 error（無ければ detail を付けない）。unexpected は、どこでも握られずに
// ワーカーの最後の受け口まで来た例外（記録の level を error にする。ほかは warn）。
function failure(message, error, { unexpected = false } = {}) {
  if (error === undefined)
    return { error: message };
  const detail = errorDetail(error);
  if (unexpected)
    detail.unexpected = true;
  return { error: message, detail };
}

// 下の段の失敗 result を上へ渡す（文は message に替えてよい）。detail があれば落とさない。
function passFailure(result, message = result?.error) {
  return result?.detail === undefined ? { error: message } : { error: message, detail: result.detail };
}

module.exports = { STACK_LINES, errorDetail, failure, passFailure };
