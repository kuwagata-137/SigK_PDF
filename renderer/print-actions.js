(function (root) {
  'use strict';

  // 印刷画面のプレビューの更新と、ボタンで開く画面（ヘルプ(H)・注釈の一覧(T)・ページ設定(S)...）（docs/spec-7-7-print-dialog.md）。
  // 印刷画面の開閉と印刷の流れは print.js。ここは print.js から { doc, isOpen, isBusy, jobFor, close } を受け取って動く。

  const PREVIEW_DELAY = 120;
  const ctx = { host: null, timer: 0 };

  const D = () => root.SigK.printDialog;
  const S = () => root.SigK.printSettings;

  function cancelPreview() {
    root.clearTimeout(ctx.timer);
  }

  function refreshPreview(keepIndex = true) {
    cancelPreview();
    const { host } = ctx;
    if (host === null || !host.isOpen() || host.isBusy())
      return;
    if (D().getConfig() === null) {
      root.SigK.printPreview.showStatus('プリンター情報を取得しています…');
      return;
    }
    const job = host.jobFor(D().getState());
    const plan = job.error === undefined ? root.SigK.printJob.planFor(host.doc, job) : job;
    if (plan.error !== undefined) {
      root.SigK.printPreview.showStatus(plan.error);
      return;
    }
    root.SigK.printPreview.show({ plan, job, mode: job.layout.mode, keepIndex });
  }

  function schedulePreview(keepIndex = true) {
    cancelPreview();
    ctx.timer = root.setTimeout(() => refreshPreview(keepIndex), PREVIEW_DELAY);
  }

  // 複数の決まった数で、最初のページが大きく印刷される向き（Acrobat が用紙の向きを選ぶのと同じ）。
  function bestOrientation(perSheet) {
    const job = ctx.host.jobFor({ ...D().getState(), handling: 'multiple' });
    if (job.error !== undefined)
      return 'portrait';
    const pages = root.SigK.printJob.pageDescriptors(ctx.host.doc, job.pages.slice(0, 1));
    return root.SigK.printSheetPlan.bestMultipleOrientation(pages, job.paper, job.imageable, perSheet);
  }

  // ヘルプ(H): 使い方画面の「閲覧・検索・印刷」の節を開く（質問 PR3 ⑤）。使い方画面はほかの画面の上には開かないので、印刷画面を閉じる。
  function openHelp() {
    ctx.host.close();
    if (root.SigK.helpDialog?.open(ctx.host.doc) === true)
      root.SigK.helpDialog.show(ctx.host.doc, 'view');
  }

  async function askSummary() {
    const answer = await root.SigK.printProgress.askSummary();
    if (answer !== null)
      root.SigK.printDialogInput.update({ summary: answer });
  }

  // ページ設定(S)...: サイズ(Z) と印刷の向きを選ぶ（質問 PR3 ②）。用紙がプリンターの既定と同じなら、既定に従う（paperId を null）。
  async function openSetup() {
    const config = D().getConfig();
    if (config === null)
      return;
    const state = D().getState();
    const before = S().orientationOf(state) === 'landscape' ? 'landscape' : 'portrait';
    const result = await root.SigK.printPageSetup.open({ paperSizes: config.paperSizes, paperId: state.paperId ?? config.paper.id, orientation: before });
    if (result === null)
      return;
    root.SigK.printDialogInput.update({
      paperId: result.paperId === config.paper.id ? null : result.paperId,
      orientation: result.orientation === before ? state.orientation : result.orientation,
    });
  }

  function init(host) {
    ctx.host = host;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printActions = { init, refreshPreview, schedulePreview, cancelPreview, bestOrientation, openHelp, askSummary, openSetup };
})(typeof window !== 'undefined' ? window : globalThis);
