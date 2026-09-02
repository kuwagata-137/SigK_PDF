(function (root) {
  'use strict';

  // 画面の組み立ての入口。

  function fillIcons(doc) {
    for (const holder of doc.querySelectorAll('[data-icon]')) {
      const name = holder.dataset.icon;
      if (!root.SigK.icons.has(name))
        continue;
      const size = Number(holder.dataset.iconSize ?? 17);
      const strokeWidth = Number(holder.dataset.iconStroke ?? root.SigK.icons.DEFAULT_STROKE_WIDTH);
      holder.replaceChildren(root.SigK.icons.create(doc, name, { size, strokeWidth }));
    }
  }

  async function showAppVersion(doc) {
    const api = root.appInfoAPI;
    if (!api || api.available !== true)
      return null;
    try {
      const info = await api.get();
      if (!info || info.ok !== true)
        return null;
      root.SigK.shell.setStatus(doc, { version: `${info.name} ${info.version}` });
      return info;
    } catch {
      return null;
    }
  }

  // 前回のモード・サイドパネルの開閉と幅を当てる（spec-1-3 確定事項31）。
  //
  // shell.init は既定値で先に組み、設定は届いた時点で重ねる。IPC の往復を
  // 待つと、ビューアやタブの初期化まで揃って遅れるためである。
  async function restoreUi(doc) {
    const api = root.settingsAPI;
    if (!api || api.available !== true)
      return null;
    try {
      const result = await api.getUi();
      if (!result || result.ok !== true)
        return null;
      root.SigK.shell.applyUi(doc, {
        mode: result.ui.mode,
        panelOpen: result.ui.sidePanel.open,
        sidePanelWidth: result.ui.sidePanel.width,
      });
      return result.ui;
    } catch {
      return null;
    }
  }

  function init(doc, win) {
    if (win.__sigkReady === true)
      return false;
    win.__sigkReady = true;

    root.SigK.log.install(win);
    fillIcons(doc);
    root.SigK.shell.init(doc);
    // 帯はビューアが失敗を伝えるのに使う。先に用意しておく。
    root.SigK.viewBanner.init(doc, win);
    // サムネイルはビューアが文書を開いたときに差し替えられる。先に用意しておく。
    root.SigK.thumbnails.init(doc, win);
    // ページモードの選択とドラッグは、サムネイルのクリックから呼ばれる。
    // 先に用意しておく。
    root.SigK.pageGrid.init(doc, win);
    root.SigK.pageEdit.init(doc, win);
    // 未保存の確認は、タブを閉じるときと終了するときに呼ばれる。
    // タブ層より先に用意しておく。
    root.SigK.confirmDiscard.init(doc, win);
    root.SigK.confirmOverwrite.init(doc, win);
    // 保存は、未保存の確認（3択の「保存」）からも呼ばれる。確認より先に用意する。
    root.SigK.save.init(doc, win);
    root.SigK.viewer.init(doc, win);
    // 検索バーと印刷は、ツールバーの結線とキー操作から呼ばれる。先に用意しておく。
    root.SigK.findBar.init(doc, win);
    root.SigK.print.init(doc, win);
    // タブは開く経路の入口であり、ドロップ・履歴・ツールバーの結線より先に要る。
    root.SigK.docInfo.init(doc, win);
    root.SigK.tabs.init(doc, win);
    root.SigK.recentPanel.init(doc, win);
    root.SigK.fileDrop.init(doc, win);
    root.SigK.viewerControls.init(doc, win);
    showAppVersion(doc);
    restoreUi(doc);

    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.app = { init, fillIcons, restoreUi };

  // 読み込みの途中なら DOMContentLoaded を待ち、すでに終わっていれば即座に始める。
  // 後から読み込まれた場合に init が一度も走らない、という取りこぼしを防ぐ。
  if (typeof root.document !== 'undefined') {
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => init(root.document, root));
    else
      init(root.document, root);
  }
})(typeof window !== 'undefined' ? window : globalThis);
