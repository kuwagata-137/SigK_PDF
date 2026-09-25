(function (root) {
  'use strict';

  // エクスプローラーからの起動要求の受け口（spec-1-6 確定事項77・spec-5-1 確定事項8〜13・docs/03 3-3）。
  //
  // **購読を始めてから ready() を送る。**順番を逆にすると取りこぼす。実測では
  // `did-finish-load` を合図に送った分まで消えた（7通中5通）。理由は「読み込みが
  // 終わる前だから」ではなく、`contextBridge` 経由の `onLaunch` を呼ぶまで購読が
  // 始まらないからである。メイン側は ready を受けるまで要求を溜めている。
  //
  // 要求は { intent, paths, batch: { id, first } } の形で 1 件ずつ届く（main.js の queueLaunch。
  // 右クリックで N 個選ぶと N 件）。ここは届いた順に 1 件ずつ画面へ渡すだけで、束の中の並びと
  // 一覧の置き換えは受け取る画面が決める（tools-merge.js・tools-convert.js・tools-split.js）。
  //
  // **手が空いていなければ当てずに預かる**（論点4）。結合と画像→PDF は保存ダイアログから
  // 戻ってから一覧を読むので、その間に束が入ると出力に混ざるためである。

  const HOLD_POLL_MS = 250;
  // run() の途中（保存ダイアログ・3 択・確認を含む）を実行中と数える道具（spec-5-1 確定事項12）。
  const TOOLS = ['toolsMerge', 'toolsSplit', 'toolsConvert', 'toolsToImage', 'toolsWatermark', 'toolsFlatten'];

  const queue = [];
  let draining = false;
  let timer = null;
  let el = null;
  let openBatch = null;

  const SigKOf = () => root.SigK;
  const docOf = () => el?.doc ?? root.document;
  const openBatches = () => (openBatch ??= SigKOf().launchIntake.createBatchTracker());

  // `open` の束（確定事項9・13）。束の最初で、ツールモードなら閲覧モードへ移る（ページ・注釈モードは
  // 文書が見えているのでそのまま）。1本ずつ順に開く。まとめて投げると、同じファイルが2枚のタブに
  // なる経路（tabs.js の重複判定は開き終わってから効く）を作ってしまう。
  async function openAll(paths, batch) {
    const { starts } = openBatches().enter(batch);
    const doc = docOf();
    if (starts && doc.documentElement.getAttribute('data-mode') === 'tools')
      SigKOf().shell.setMode(doc, 'view');

    const tabs = SigKOf().tabs;
    let opened = 0;
    for (const filePath of paths) {
      if (tabs.count() >= tabs.MAX_TABS && tabs.findByPath(filePath) === null) {
        if (openBatches().once('tabs'))
          SigKOf().viewBanner.show(`タブが多すぎます。${tabs.MAX_TABS} 個まで開けます。使わないタブを閉じてください。`);
        continue;
      }
      if (await tabs.openPath(filePath))
        opened += 1;
    }
    return opened;
  }

  const APPLY = {
    open: (paths, batch) => openAll(paths, batch),
    merge: (paths, batch) => SigKOf().toolsMerge.addFromLaunch(paths, { batch }),
    toPdf: (paths, batch) => SigKOf().toolsConvert.addFromLaunch(paths, { batch }),
    split: (paths, batch) => SigKOf().toolsSplit.useFromLaunch(paths, { batch }),
  };

  function isRequest(request) {
    return request !== null && typeof request === 'object'
      && Object.hasOwn(APPLY, request.intent)
      && Array.isArray(request.paths) && request.paths.length > 0;
  }

  // 手が空いているか（確定事項11）。道具の run() の途中、保存やツールの処理の途中、
  // 画面のダイアログ（<dialog>）が開いている間は空いていない。
  function isIdle() {
    const SigK = SigKOf();
    if (TOOLS.some((name) => SigK[name]?.isRunning?.() === true))
      return false;
    if (SigK.save?.isBusy?.() === true)
      return false;
    return docOf()?.querySelector('dialog[open]') == null;
  }

  async function applySafely(request) {
    try {
      return await APPLY[request.intent](request.paths, request.batch ?? null);
    } catch (error) {
      SigKOf().log?.report({
        level: 'error',
        message: error?.message ?? String(error),
        stack: error?.stack,
        context: { source: 'launch', intent: request.intent },
      });
      return 0;
    }
  }

  function hold() {
    if (timer !== null)
      return;
    timer = root.setTimeout(() => {
      timer = null;
      drain();
    }, HOLD_POLL_MS);
  }

  async function drain() {
    if (draining)
      return;
    draining = true;
    try {
      while (queue.length > 0) {
        if (!isIdle()) {
          hold();
          return;
        }
        const { request, resolve } = queue.shift();
        resolve(await applySafely(request));
      }
    } finally {
      draining = false;
    }
  }

  // 当て終えたら、その要求の結果（open は開いた数）で解ける。預かっている間は解けない。
  function handle(request) {
    if (!isRequest(request))
      return Promise.resolve(0);
    return new Promise((resolve) => {
      queue.push({ request, resolve });
      drain();
    });
  }

  function init(doc, win) {
    if (win.__sigkLaunchReady === true)
      return false;
    win.__sigkLaunchReady = true;
    el = { doc, win };

    const api = root.shellAPI;
    if (api?.available !== true)
      return false;

    api.onLaunch?.((request) => handle(request));
    api.ready?.();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.launch = { HOLD_POLL_MS, init, handle, isIdle, pending: () => queue.length };
})(typeof window !== 'undefined' ? window : globalThis);
