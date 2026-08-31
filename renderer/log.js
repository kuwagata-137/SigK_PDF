(function (root) {
  'use strict';

  // レンダラーで起きたエラーをメイン側のログへ流す唯一の経路。
  // appLogAPI が無い環境（テスト・素のブラウザ）では console に落とし、何も投げない。

  const MESSAGE_LIMIT = 4000;

  function toText(value) {
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

  function formatClientError(source, detail) {
    const entry = { level: 'error', message: '', context: { source } };

    if (detail && typeof detail === 'object' && 'reason' in detail) {
      const reason = detail.reason;
      entry.message = toText(reason?.message ?? reason);
      if (typeof reason?.stack === 'string')
        entry.stack = reason.stack;
    } else if (detail && typeof detail === 'object' && 'message' in detail) {
      entry.message = toText(detail.message);
      if (typeof detail.error?.stack === 'string')
        entry.stack = detail.error.stack;
      entry.context.url = detail.filename ?? null;
      entry.context.line = detail.lineno ?? null;
      entry.context.column = detail.colno ?? null;
    } else {
      entry.message = toText(detail);
    }

    entry.message = entry.message.slice(0, MESSAGE_LIMIT);
    return entry;
  }

  function report(entry) {
    const api = root.appLogAPI;
    if (!api || api.available !== true) {
      console.error('[SigK PDF]', entry);
      return Promise.resolve({ ok: false });
    }
    return Promise.resolve(api.error(entry)).catch(() => ({ ok: false }));
  }

  function install(win) {
    if (win.__sigkLogInstalled === true)
      return false;
    win.__sigkLogInstalled = true;

    win.addEventListener('error', (event) => {
      report(formatClientError('window.error', event));
    });
    win.addEventListener('unhandledrejection', (event) => {
      report(formatClientError('unhandledrejection', event));
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.log = { formatClientError, report, install };
})(typeof window !== 'undefined' ? window : globalThis);
