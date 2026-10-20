(function (root) {
  'use strict';

  // フラット化の状態と指揮（spec-4-5 確定事項7〜11・40〜44、spec-2-5 確定事項E5。決定80 ㉞）。
  //
  // 対象は選んでいる帯（strip-target.js）。対象が替わったら件数をページごとに数え（flatten-census.js）、チェックした種類と
  // 選んだページの分を足し合わせる（flatten-choice.js）。焼くときと同じ判定（worker/flatten-selection.js）を通るので、画面の件数と
  // 焼く件数は食い違わない。実行は、保存していない帯の確かめ（run-guard.js）・出力先（rewrite-output.js）・確認（confirm-flatten.js。
  // 既定はキャンセル）のあと、選んだ種類とページをワーカー（kind: flatten）へ渡す。描画は tools-flatten-view.js。

  const SAVE_TITLE = 'フラット化した PDF を保存';
  // 通知バーの文言「<label>しています」の頭（save.js の runTask）。
  const RUN_LABEL = 'フラット化';

  const banner = () => root.SigK.viewBanner;
  const view = () => root.SigK.toolsFlattenView;
  const choice = () => root.SigK.flattenChoice;
  const baseName = (filePath) => root.SigK.toolSource.baseName(filePath);

  // owner は選び方の持ち主（帯）。帯を替えたら選び方を全部チェック・［すべて］に戻す（spec-2-5 確定事項E5-5）。
  const state = { running: false, owner: null };
  const picks = root.SigK.flattenChoice.createChoices();
  const counts = root.SigK.flattenCensus.create({ onDone: () => view()?.render() });

  function defaultTarget(sourcePath) {
    return `${sourcePath.replace(/\.pdf$/i, '')}_フラット化.pdf`;
  }

  // ---- 対象 ----

  // 対象の帯が替わったか、同じ帯を保存して読み直した。帯が替わったときだけ選び方を戻し、どちらも数える相手を決め直す。
  function onTargetChanged(src) {
    const owner = src === null ? null : `${src.tabId}|${src.path}`;
    if (owner !== state.owner) {
      state.owner = owner;
      picks.reset();
    }
    counts.setTarget(src);
  }

  const target = root.SigK.stripTarget.create({ encryptedError: '焼き込めません', onChange: onTargetChanged });
  const source = () => target.source();

  // ---- 選び方（spec-2-5 確定事項E5-1・E5-2） ----

  // 変えたら描き直す。
  const changing = (apply) => (...args) => {
    const done = apply(...args);
    if (done)
      view()?.render();
    return done;
  };
  const setKind = changing(picks.setKind);
  const setPageMode = changing(picks.setPageMode);
  const setRange = changing(picks.setRange);

  // 選んだページ（{ pages } か { error }）と、チェックした種類・選んだページの件数（tally）。数え終えていなければ tally は null。
  // 範囲の欄が誤りの間は、ファイル全体の件数にする（打っている途中で種類の行が消えないように。確定事項E5-1。点検の直し）。
  function selection() {
    const pages = choice().pagesOf(picks.state, source()?.pageCount ?? 0);
    const result = counts.current()?.result ?? null;
    const chosen = pages.error !== undefined ? null : pages.pages;
    return { ...pages, tally: result === null ? null : choice().tally(result, { kinds: picks.state.kinds, pages: chosen }) };
  }

  // 実行できるか。戻り値は { ready, error, summary }。error は要約の欄に出す文（対象が無い・使えないときは状態の文が出るので空。
  // 範囲の誤りは欄の下に出るので空）。
  function status() {
    const src = source();
    const census = counts.current();
    if (src === null || src.blocked !== null)
      return { ready: false, error: '' };
    if (census === null || census.pending)
      return { ready: false, error: '書き込みを数えています…' };
    if (census.error !== null)
      return { ready: false, error: census.error };
    if (!(census.result.baked > 0))
      return { ready: false, error: '焼き込める書き込みがありません。' };
    const chosen = selection();
    if (chosen.error !== undefined)
      return { ready: false, error: '' };
    if (!(chosen.tally.baked > 0))
      return { ready: false, error: '焼き込む書き込みを選んでください。' };
    return { ready: true, error: null, summary: `書き込み ${chosen.tally.baked} 件を焼き込みます` };
  }

  function canRun() {
    return !state.running && root.SigK.save?.isBusy() !== true && status().ready === true;
  }

  // ---- 実行（spec-4-5 確定事項9〜11・40〜44） ----

  // 保存していない帯の確かめ・保存ダイアログ・焼き込みの確認・書いた後の始末まで実行中と数える（spec-5-1 確定事項12）。
  async function run() {
    if (!canRun())
      return { error: 'フラット化できる状態ではありません。' };
    state.running = true;
    view()?.render();
    try {
      // 帯のファイルがほかのアプリで書き換えられていたら止める（決定81 ⑫）。
      const guard = await root.SigK.runGuard.confirmUnsaved([source().tabId], { verb: RUN_LABEL });
      if (!guard.go)
        return guard.error === undefined ? { canceled: true } : { error: guard.error };
      // 上書き保存したら、ファイルの中身が変わっている。数え直しを待ってから確かめる（spec-2-5 確定事項F。PR-2 の起草者の判断）。
      if (guard.saved) {
        target.sync();
        counts.resume();
        await counts.done();
        if (status().ready !== true) {
          const error = status().error || 'フラット化できる状態ではありません。';
          banner().show(error);
          return { error };
        }
      }
      return await runConfirmed();
    } finally {
      state.running = false;
      view()?.render();
    }
  }

  async function runConfirmed() {
    const src = source();
    const chosen = selection();
    const output = await root.SigK.rewriteOutput.chooseTarget({ sourcePath: src.path, defaultPath: defaultTarget(src.path), title: SAVE_TITLE });
    if (output.target === undefined)
      return output;
    const agreed = await root.SigK.confirmFlatten.ask({ count: chosen.tally.baked, name: baseName(output.target), notes: chosen.tally.notes });
    if (!agreed)
      return { canceled: true };
    // ワーカーも読む前に、タブで開いたときの印を照らす（保存ダイアログと確認の窓の間の書き換え。spec-6-1 確定事項C-9）。
    const spec = { kind: 'flatten', label: RUN_LABEL, source: src.path, target: output.target, kinds: picks.current().kinds, expectSource: root.SigK.runGuard.expectOf(src.tabId) };
    if (chosen.pages !== null)
      spec.pages = chosen.pages;
    const result = await root.SigK.save.runTask(spec);
    return root.SigK.rewriteOutput.finish(result, output.target, {
      canceled: 'フラット化を中止しました。',
      changed: { name: src.name, verb: RUN_LABEL },
      failed: 'フラット化できませんでした。',
      done: `書き込み ${result?.baked ?? chosen.tally.baked} 件を焼き込みました`,
    });
  }

  function init(doc, win) {
    if (win.__sigkToolsFlattenReady === true)
      return false;
    if (doc.getElementById('fl-run') === null)
      return false;
    win.__sigkToolsFlattenReady = true;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsFlatten = {
    SAVE_TITLE, COUNT_LABEL: root.SigK.flattenCensus.COUNT_LABEL, RUN_LABEL,
    init, source, census: counts.census, choices: picks.current, selection, status, canRun, defaultTarget,
    setKind, setPageMode, setRange, run,
    sync: () => target.sync(), stateText: () => target.stateText(),
    isRunning: () => state.running,
  };
})(typeof window !== 'undefined' ? window : globalThis);
