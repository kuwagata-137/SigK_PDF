'use strict';

// 画面の記録の口（window.appLogAPI）の代わりを据え、届いた中身を控える（spec-6-1 タスク B のテストで使う）。
// t.after で元に戻す。SigK.log（renderer/log.js）は呼ぶ側のテストで読み込んでおく。

require('../renderer/log.js');

function captureLogs(t) {
  const sent = [];
  const saved = globalThis.appLogAPI;
  globalThis.appLogAPI = {
    available: true,
    error: async (entry) => {
      sent.push(entry);
      return { ok: true };
    },
  };
  t.after(() => { globalThis.appLogAPI = saved; });
  return sent;
}

module.exports = { captureLogs };
