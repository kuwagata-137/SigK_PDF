'use strict';

// 重い処理をワーカー（utilityProcess）へ出し、進捗を中継し、中止できるようにする層
// （spec-1-6 確定事項1〜10）。メインプロセス側に置く。
//
// Electron を require しないのは security-policy.js・file-io.js と同じ作法である。
// utilityProcess は引数で受け取るので、node --test から偽物を渡して試せる。
//
// タスク1本につきプロセスを1つ立て、終わったら落とす（確定事項1）。使い回さないのは、
// 1,000ページで rss 82MB を抱えたプロセスが居座るのを避けるためである。
//
// 中止は child.kill() で行う。実測では即座に効き、元ファイルは無傷のまま
// **書きかけの一時ファイルだけが残る**。子は死んでいて後始末できないので、
// ここで消す（確定事項8・16）。

const fs = require('node:fs');
const { tempPathFor } = require('./pdf-write.js');

// 進捗の段。save() に進捗の口が無いため、段の切り替わりでしか報告できない
// （確定事項5）。段の中では進まない。
const PHASES = ['read', 'load', 'apply', 'save', 'write'];

const PHASE_LABELS = {
  read: '読み込んでいます',
  load: '解析しています',
  apply: 'ページを組み立てています',
  save: '書き出しています',
  write: '保存しています',
};

function phaseStep(phase) {
  const index = PHASES.indexOf(phase);
  return index < 0 ? null : { phase, label: PHASE_LABELS[phase], step: index + 1, total: PHASES.length };
}

function createTaskRunner({ utilityProcess, workerPath, fsLike = fs, onError = () => {} }) {
  const running = new Map();

  async function removeLeftovers(target) {
    if (typeof target !== 'string')
      return;
    try {
      await fsLike.promises.rm(tempPathFor(target), { force: true });
    } catch {
      // 消せなくても、タスクの結果は変えない。
    }
  }

  function isRunning(taskId) {
    return running.has(taskId);
  }

  // 実行して、終わるまで待つ。進捗は onProgress へ流す。
  // 戻り値は docs/02 第5章の形に揃える。
  //   成功       { ok: true, ... }
  //   中止       { canceled: true }
  //   外部で変更 { changed: true, current }
  //   失敗       { error: '人が読める文言' }
  function run(taskId, spec, { onProgress = () => {} } = {}) {
    if (running.has(taskId))
      return Promise.resolve({ error: 'この文書はすでに保存中です。' });

    return new Promise((resolve) => {
      let child = null;
      try {
        child = utilityProcess.fork(workerPath);
      } catch (error) {
        onError({ message: 'ワーカーを起動できませんでした', stack: error?.stack, context: { workerPath } });
        resolve({ error: '保存の処理を開始できませんでした。' });
        return;
      }

      const entry = { child, spec, canceled: false, settled: false };
      running.set(taskId, entry);

      async function settle(result) {
        if (entry.settled)
          return;
        entry.settled = true;
        running.delete(taskId);
        try { child.kill(); } catch { /* すでに死んでいることがある */ }
        // 成功以外は書きかけが残り得る。中止でも失敗でも消す。
        if (result.ok !== true)
          await removeLeftovers(spec?.target);
        resolve(result);
      }

      child.on('spawn', () => {
        try { child.postMessage({ type: 'run', taskId, spec }); }
        catch (error) { settle({ error: '保存の処理を開始できませんでした。' }); }
      });

      child.on('message', (message) => {
        if (message?.type === 'progress') {
          const step = phaseStep(message.phase);
          if (step !== null)
            onProgress({ taskId, ...step });
          return;
        }
        if (message?.type === 'done')
          settle(message.result ?? { error: 'ワーカーから結果が返りませんでした。' });
      });

      // 子が落ちたとき。settle の中で kill() を呼ぶので、正常に終わった直後にも
      // ここへ来る。settled を先に見ないと、済んだタスクのぶんまでログに残る。
      child.on('exit', () => {
        if (entry.settled)
          return;
        if (entry.canceled) {
          settle({ canceled: true });
          return;
        }
        onError({ message: 'ワーカーが異常終了しました', context: { taskId, source: spec?.source } });
        settle({ error: '保存中に問題が起きたため、中止しました。元のファイルは変更していません。' });
      });
    });
  }

  function cancel(taskId) {
    const entry = running.get(taskId);
    if (entry === undefined)
      return { ok: false };
    entry.canceled = true;
    try { entry.child.kill(); } catch { /* すでに死んでいる */ }
    return { ok: true };
  }

  function cancelAll() {
    for (const taskId of [...running.keys()])
      cancel(taskId);
  }

  return { run, cancel, cancelAll, isRunning, PHASES };
}

module.exports = { PHASES, PHASE_LABELS, phaseStep, createTaskRunner };
