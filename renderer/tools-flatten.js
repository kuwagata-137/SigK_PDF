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
  const COUNT_LABEL = '注釈を確認';
  const RUN_LABEL = 'フラット化';

  const banner = () => root.SigK.viewBanner;
  const view = () => root.SigK.toolsFlattenView;
  const baseName = (filePath) => root.SigK.toolSource.baseName(filePath);

  // census は { path, pending, error, result }。result は flatten-preview の { baked, kept, notes, bake, keep }。
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
    dirtyMessage: '未保存の編集はフラット化に反映されません。保存してからフラット化し直してください。',
    onChange: () => {
      view()?.render();
      countIfReady();
    },
  });

  const source = () => field.source();
  const { setSource, useOpenTab, pickFile, addPaths } = field;
  const census = () => (state.census === null ? null : { ...state.census });

  // 対象が読めたら数える。同じファイルはもう一度数えない。
  async function countIfReady() {
    const src = source();
    if (src === null || src.pending || src.blocked !== null) {
      state.census = null;
      view()?.render();
      return;
    }
    if (state.census?.path === src.path)
      return;
    const next = { path: src.path, pending: true, error: null, result: null };
    state.census = next;
    view()?.render();
    const result = await root.SigK.save.runTask({ kind: 'flatten-preview', label: COUNT_LABEL, source: src.path });
    if (state.census !== next)
      return;   // 数えている間に差し替えられた
    next.pending = false;
    if (result?.ok === true)
      next.result = result;
    else
      next.error = result?.canceled === true ? '注釈を数えるのを中止しました。' : (result?.error ?? '注釈を数えられませんでした。');
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
      return { ready: false, error: '注釈を数えています…' };
    if (state.census.error !== null)
      return { ready: false, error: state.census.error };
    if (!(state.census.result.baked > 0))
      return { ready: false, error: '焼き込める注釈がありません。' };
    return { ready: true, error: null, summary: `注釈 ${state.census.result.baked} 件を焼き込みます` };
  }

  function canRun() {
    return !state.running && root.SigK.save?.isBusy() !== true && status().ready === true;
  }

  async function run() {
    if (!canRun())
      return { error: 'フラット化できる状態ではありません。' };
    const src = source();
    const counts = state.census.result;
    const chosen = await root.SigK.rewriteOutput.chooseTarget({ sourcePath: src.path, defaultPath: defaultTarget(src.path), title: SAVE_TITLE });
    if (chosen.target === undefined)
      return chosen;
    const agreed = await root.SigK.confirmFlatten.ask({ count: counts.baked, name: baseName(chosen.target), notes: counts.notes });
    if (!agreed)
      return { canceled: true };

    state.running = true;
    view()?.render();
    let result;
    try {
      result = await root.SigK.save.runTask({ kind: 'flatten', label: RUN_LABEL, source: src.path, target: chosen.target });
    } finally {
      state.running = false;
      view()?.render();
    }
    return root.SigK.rewriteOutput.finish(result, chosen.target, {
      canceled: 'フラット化を中止しました。',
      failed: 'フラット化できませんでした。',
      done: `注釈 ${result?.baked ?? counts.baked} 件を焼き込みました`,
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
    setSource, useOpenTab, pickFile, addPaths, run,
    isRunning: () => state.running,
  };
})(typeof window !== 'undefined' ? window : globalThis);
