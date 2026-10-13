(function (root) {
  'use strict';

  // フラット化の画面の状態と指揮（spec-4-5 確定事項7〜11・32・34・38・40〜44）。
  //
  // 対象（source-picker.js）が決まったら、焼き込む件数をワーカー（kind: flatten-preview）で数える。
  // 焼くときと同じ判定（worker/flatten-selection.js）を通るので、画面の件数と焼く件数は食い違わない。
  // 実行は、保存ダイアログで出力先を決め（rewrite-output.js）、確認（confirm-flatten.js。既定はキャンセル）
  // のあとワーカー（kind: flatten）へ渡す。描画は tools-flatten-view.js。ファイルを読み直して焼くので、
  // 未保存の注釈は反映されない。

  const PICK_TITLE = 'フラット化する PDF を選ぶ';
  const SAVE_TITLE = 'フラット化した PDF を保存';
  // 帯の文言「<label>しています」の頭（save.js の runTask）。
  const COUNT_LABEL = '書き込みを確認';
  const RUN_LABEL = 'フラット化';

  const banner = () => root.SigK.viewBanner;
  const view = () => root.SigK.toolsFlattenView;
  const baseName = (filePath) => root.SigK.toolSource.baseName(filePath);

  // census は { path, pending, waiting, error, result }。result は flatten-preview の { baked, kept, notes, bake, keep }。
  // waiting は、ほかの処理が走っていたので数えるのを後回しにしている印（その間も pending のまま「数えています…」と見せる）。
  const state = { census: null, running: false };

  function defaultTarget(sourcePath) {
    return `${sourcePath.replace(/\.pdf$/i, '')}_フラット化.pdf`;
  }

  // ---- 対象と件数（確定事項8・32・34・38） ----

  const field = root.SigK.sourcePicker.create({
    inspect: (filePath) => root.SigK.toolSource.inspectPdf(filePath),
    pick: ({ defaultPath }) => {
      const api = root.pdfAPI;
      if (api?.available !== true || typeof api.pickToolSource !== 'function')
        return null;
      return api.pickToolSource({ defaultPath, title: PICK_TITLE });
    },
    dirtyMessage: '未保存の編集はフラット化に反映されないので、保存してからフラット化し直してください。',
    onChange: () => {
      view()?.render();
      countIfReady();
    },
  });

  const source = () => field.source();
  const { setSource, useTab, pickFile, addPaths } = field;
  // 画面が件数を読みに来たら、後回しにした数えを始める（resumeCount）。描いている最中には走らせず、今の処理を終えてから始める。
  function census() {
    if (state.census?.waiting === true)
      Promise.resolve().then(resumeCount);
    return state.census === null ? null : { ...state.census };
  }

  // 対象が読めたら数える。同じファイルはもう一度数えない。
  function countIfReady() {
    const src = source();
    if (src === null || src.pending || src.blocked !== null) {
      state.census = null;
      view()?.render();
      return;
    }
    if (state.census?.path === src.path)
      return;
    state.census = { path: src.path, pending: true, waiting: true, error: null, result: null };
    view()?.render();
    resumeCount();
  }

  // 後回しにした数えを始める。ほかの処理（結合など）が走っている間は始めない（計画外の直し）。走らせる枠（save.js の
  // runTask）は 1 つで、同時に走らせると走っている処理の記録を上書きし、まだ走っているのに「走っていない」ことになるため。
  // ほかの処理が終わると、save.js が見えているツールの画面を描き直し、画面が census() で件数を読みに来るので、そこで始まる。
  // フラット化が隠れていれば、選んで画面を描いたときに始まる。
  function resumeCount() {
    const next = state.census;
    if (next?.waiting !== true || root.SigK.save?.isBusy() === true)
      return;
    next.waiting = false;
    count(next);
  }

  async function count(next) {
    const result = await root.SigK.save.runTask({ kind: 'flatten-preview', label: COUNT_LABEL, source: next.path });
    if (state.census !== next) {
      resumeCount();   // 数えている間に差し替えられた。差し替えた先が待っていれば、ここで数え始める
      return;
    }
    next.pending = false;
    if (result?.ok === true)
      next.result = result;
    else
      next.error = result?.canceled === true ? '書き込みを数えるのを中止しました。' : (result?.error ?? '書き込みを数えられませんでした。');
    // 数え終えたら「注釈を確認しています」の帯を下げる（結果は画面の節に出る）。
    if (banner().text().startsWith(`${COUNT_LABEL}しています`))
      banner().hide();
    view()?.render();
  }

  // ---- 実行（確定事項9〜11・40〜44） ----

  // 実行できるか。戻り値は { ready, error, summary }。
  function status() {
    const src = source();
    if (src === null)
      return { ready: false, error: '焼き込む PDF を決めてください。' };
    if (src.pending)
      return { ready: false, error: '対象の PDF を読んでいます…' };
    if (src.blocked !== null)
      return { ready: false, error: '対象の PDF を選び直してください。' };
    if (state.census === null || state.census.pending)
      return { ready: false, error: '書き込みを数えています…' };
    if (state.census.error !== null)
      return { ready: false, error: state.census.error };
    if (!(state.census.result.baked > 0))
      return { ready: false, error: '焼き込める書き込みがありません。' };
    return { ready: true, error: null, summary: `書き込み ${state.census.result.baked} 件を焼き込みます` };
  }

  function canRun() {
    return !state.running && root.SigK.save?.isBusy() !== true && status().ready === true;
  }

  // 保存ダイアログ・焼き込みの確認・書いた後の始末まで実行中と数える（spec-5-1 確定事項12。結合と同じ）。
  async function run() {
    if (!canRun())
      return { error: 'フラット化できる状態ではありません。' };
    state.running = true;
    view()?.render();
    try {
      return await runConfirmed();
    } finally {
      state.running = false;
      view()?.render();
    }
  }

  async function runConfirmed() {
    const src = source();
    const counts = state.census.result;
    const chosen = await root.SigK.rewriteOutput.chooseTarget({ sourcePath: src.path, defaultPath: defaultTarget(src.path), title: SAVE_TITLE });
    if (chosen.target === undefined)
      return chosen;
    const agreed = await root.SigK.confirmFlatten.ask({ count: counts.baked, name: baseName(chosen.target), notes: counts.notes });
    if (!agreed)
      return { canceled: true };

    const result = await root.SigK.save.runTask({ kind: 'flatten', label: RUN_LABEL, source: src.path, target: chosen.target });
    return root.SigK.rewriteOutput.finish(result, chosen.target, {
      canceled: 'フラット化を中止しました。',
      failed: 'フラット化できませんでした。',
      done: `書き込み ${result?.baked ?? counts.baked} 件を焼き込みました`,
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
    PICK_TITLE, SAVE_TITLE, COUNT_LABEL, RUN_LABEL,
    init, source, census, status, canRun, defaultTarget,
    setSource, useTab, pickFile, addPaths, run,
    isRunning: () => state.running,
  };
})(typeof window !== 'undefined' ? window : globalThis);
