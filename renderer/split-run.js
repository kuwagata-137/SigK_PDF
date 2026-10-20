(function (root) {
  'use strict';

  // 分割の実行（spec-2-2 確定事項20〜32・42、spec-2-2b 確定事項H1〜H4、spec-2-5 確定事項G7・G11）。
  //
  // tools-split.js の run() から、保存していない帯の確かめ（run-guard.js）のあとで呼ばれる。書き換わりを照らし、盤の位置（帯の今の並びの位置）を
  // ファイルのページへ読み替え、出力先を確かめ（元のファイル・タブで開いている出力先・同名の 3 択）、ワーカーへ渡し、終わったら通知バーに出す。

  const banner = () => root.SigK.viewBanner;
  const split = () => root.SigK.toolsSplit;
  const baseName = (filePath) => root.SigK.toolSource.baseName(filePath);

  async function countExisting(targets) {
    const api = root.pdfAPI;
    if (typeof api?.exists !== 'function')
      return [];
    const found = [];
    for (const target of targets) {
      const answer = await api.exists(target);
      if (answer?.exists === true)
        found.push(target);
    }
    return found;
  }

  // 戻り値は { targets } / { canceled } / { error }。3択は1回だけ出し、「別名で保存」は
  // フォルダーを選び直してもう一度確かめる。タブで開いている出力先は3択より前に断る
  // （spec-2-2 確定事項42）。3択のあとで見ると、置き換えてよいかを聞いておいて断ることになる。
  async function resolveTargets(targets) {
    const refused = root.SigK.outputTarget.refusalForFolder(targets);
    if (refused !== null)
      return { error: refused };
    const found = await countExisting(targets);
    if (found.length === 0)
      return { targets };
    const confirm = root.SigK.confirmReplace;
    const answer = await confirm.ask({ name: baseName(found[0]), count: found.length });
    if (answer === confirm.REPLACE)
      return { targets };
    if (answer !== confirm.RENAME)
      return { canceled: true };
    if (!(await split().pickFolder()))
      return { canceled: true };
    const next = split().currentPlan();
    return next.ready ? resolveTargets(next.targets) : { canceled: true };
  }

  function refuse(message) {
    banner().show(message);
    return { error: message };
  }

  async function execute() {
    const src = split().source();
    const peeked = root.SigK.tabs.peek(src.tabId);
    // ほかのアプリの書き換えは、実行の前の確かめ（run-guard.js）が照らした（spec-2-5 G11。決定81 ⑫）。ワーカーも読む前に照らす（確定事項H4）。
    const expectSource = root.SigK.save.signatureOf(peeked?.file);
    // 盤の位置はファイルのページと同じでなければならない（並び・削除・差し込みを保存していない帯は、確認の窓で止めている。G7）。
    if (!split().matchesFile(peeked))
      return refuse(split().NOTE_ORDER);
    const current = split().currentPlan();
    if (!current.ready)
      return { error: '分割できる状態ではありません。' };
    const sourceKey = split().pathKey(src.path);
    if (current.targets.some((target) => split().pathKey(target) === sourceKey))
      return refuse('出力先に元のファイルと同じファイルは選べません。');

    const resolved = await resolveTargets(current.targets);
    if (resolved.canceled === true)
      return { canceled: true };
    if (resolved.error !== undefined)
      return refuse(resolved.error);
    const { targets } = resolved;

    const result = await root.SigK.save.runTask({
      kind: 'split',
      label: '分割',
      source: src.path,
      name: src.name,
      // 盤の位置 i は、並びがファイルと同じなので plan[i].src（＝i）のページ。
      parts: current.parts.map((pages, index) => ({ pages: pages.map((page) => peeked.plan[page].src), target: targets[index] })),
      targets,
      // ワーカーも読む前に照らす（確定事項H4）。
      expectSource,
    });
    return finish(result, targets, src.name);
  }

  // 中止までに書き終えた本数。出力先の有無で数えると、上書きする前から
  // あったファイルまで数えてしまうので、ワーカーの進捗（write の done）を見る。
  function writtenBeforeCancel() {
    const progress = root.SigK.save?.lastProgress?.() ?? null;
    return progress?.phase === 'write' && Number.isInteger(progress.done) ? progress.done : 0;
  }

  function finish(result, targets, name) {
    // ワーカーが読む前に書き換えに気づいた（実行の前の確かめのあとの書き換え。決定81 ⑫）。
    const changed = root.SigK.runGuard.changedResult(result, name, '分割');
    if (changed !== null)
      return changed;
    if (result?.canceled === true) {
      const written = writtenBeforeCancel();
      // 自分で止めたので赤く塗らない（決定49）。
      banner().show(written > 0 ? `分割を中止しましたが、${written} ファイルは書き出し済みです。` : '分割を中止しました。', { tone: 'info' });
      return result;
    }
    if (result?.ok !== true) {
      banner().show(result?.error ?? '分割できませんでした。');
      return result ?? { error: '分割できませんでした。' };
    }
    banner().show(`${result.written} ファイルに分割しました`, {
      autoHideMs: 0,
      tone: 'info',
      action: { label: 'フォルダを開く', onClick: () => root.shellAPI?.showInFolder?.(targets[0]) },
    });
    return result;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitRun = { execute, resolveTargets };
})(typeof window !== 'undefined' ? window : globalThis);
