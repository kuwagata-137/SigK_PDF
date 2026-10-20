'use strict';

// メニュー「ヘルプ」→「エラーの記録のフォルダを開く」（spec-6-1 タスク B の B7・docs/07 決定81 ⑧）。
// エクスプローラーで記録のフォルダ（<userData>/logs）を開く。まだ一度も書いていなくて無ければ、作ってから開く。
// Electron の shell は外から渡す（テストでは偽物を渡す）。開けなかったら窓は出さず、記録に残す（既定のアプリの設定と同じ扱い）。

const fs = require('node:fs');

// shell.openPath は、開けたら空の文字列、開けなければ理由の文を返す。
async function openLogFolder({ dir, shell, logError, fsLike = fs }) {
  let problem = '';
  try {
    fsLike.mkdirSync(dir, { recursive: true });
    problem = await shell.openPath(dir);
  } catch (error) {
    problem = error?.message ?? String(error);
  }
  if (!problem)
    return { ok: true, dir };
  logError({ message: 'エラーの記録のフォルダを開けませんでした', context: { dir, problem } });
  return { ok: false, dir };
}

module.exports = { openLogFolder };
