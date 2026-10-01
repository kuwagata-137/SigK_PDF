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
        // 見開き（spec-2-3 確定事項5）。古い settings.json には無いことがある。
        pageLayout: result.ui.pageLayout,
        // 編集モードの左に出すもの（spec-4b-1a 確定事項17）。
        editSide: result.ui.editSide,
      });
      // 注釈の色と文字の大きさ（spec-4-1 確定事項34、spec-4-2 確定事項21）。古い settings.json には無いことがある。
      root.SigK.annotate?.applyColors(result.ui.annotColors);
      // 図形の塗り・線なし・線種（spec-4b-1b 確定事項23〜25）。
      root.SigK.annotate?.applyFills(result.ui.annotFills);
      root.SigK.annotate?.applyStrokeNone(result.ui.annotStrokeNone);
      root.SigK.annotate?.applyLineStyles(result.ui.annotLineStyles);
      root.SigK.annotate?.applyFontSize(result.ui.annotFontSize);
      root.SigK.annotateShape?.applyLineWidth(result.ui.annotLineWidth);
      root.SigK.annotateShape?.applyShapeKind(result.ui.annotShapeKind);
      // 不透明度と作成者（spec-4-4 確定事項21）。作成者が空ならメインが OS のユーザー名で埋めている。
      root.SigK.annotateOpacity?.applyOpacities(result.ui.annotOpacity);
      root.SigK.annotateNote?.applyAuthor(result.ui.annotAuthor);
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
    root.SigK.confirmExtract.init(doc, win);
    root.SigK.confirmReplace.init(doc, win);
    // ツールモードの枠組みと結合画面（spec-2-1）。shell.setMode から refresh が
    // 呼ばれるので、モードの復元（restoreUi）より先に用意しておく。
    root.SigK.tools.init(doc, win);
    root.SigK.toolsMerge.init(doc, win);
    root.SigK.toolsMergeList.init(doc, win);
    root.SigK.toolsSplit.init(doc, win);
    root.SigK.toolsSplitView.init(doc, win);
    root.SigK.toolsConvert.init(doc, win);
    root.SigK.toolsConvertList.init(doc, win);
    root.SigK.toolsConvertView.init(doc, win);
    root.SigK.toolsToImage.init(doc, win);
    root.SigK.toolsToImageView.init(doc, win);
    root.SigK.toolsWatermark.init(doc, win);
    root.SigK.toolsWatermarkView.init(doc, win);
    root.SigK.watermarkPreview.init(doc, win);
    root.SigK.confirmFlatten.init(doc, win);
    root.SigK.toolsFlatten.init(doc, win);
    root.SigK.toolsFlattenView.init(doc, win);
    // パスワードの入力は viewer.open() の途中から呼ばれる。先に用意しておく。
    root.SigK.passwordPrompt.init(doc, win);
    // 保存は、未保存の確認（3択の「保存」）からも呼ばれる。確認より先に用意する。
    root.SigK.save.init(doc, win);
    root.SigK.viewer.init(doc, win);
    // 検索バーと印刷は、ツールバーの結線とキー操作から呼ばれる。先に用意しておく。
    root.SigK.findBar.init(doc, win);
    root.SigK.print.init(doc, win);
    // 注釈モード（spec-4-1・spec-4-2、画面では「編集」）。道具の段・マークアップ・テキストの入力欄・
    // ページビューの押し離し・右のプロパティ。
    root.SigK.annotate.init(doc, win);
    root.SigK.annotateMarkup.init(doc, win);
    root.SigK.freeTextEditor.init(doc, win);
    root.SigK.annotateText.init(doc, win);
    root.SigK.annotateShape.init(doc, win);
    // 道具の段（spec-4b-1a 確定事項1〜7）。図形の種類を読むので annotateShape の後。
    root.SigK.editBar.init(doc, win);
    root.SigK.annotateOpacity.init(doc, win);
    root.SigK.annotateNote.init(doc, win);
    root.SigK.annotateTransform.init(doc, win);
    root.SigK.annotatePointer.init(doc, win);
    root.SigK.annotationMenu.init(doc, win);
    root.SigK.annotateRightButton.init(doc, win);
    root.SigK.annotationProps.init(doc, win);
    root.SigK.annotationList.init(doc, win);
    // タブは開く経路の入口であり、ドロップ・履歴・ツールバーの結線より先に要る。
    root.SigK.docInfo.init(doc, win);
    root.SigK.tabs.init(doc, win);
    root.SigK.recentPanel.init(doc, win);
    root.SigK.fileDrop.init(doc, win);
    root.SigK.viewerControls.init(doc, win);
    root.SigK.viewerWheel.init(doc, win);
    showAppVersion(doc);
    // 起動要求の受け口は**タブ層より後**、かつ**前回の見た目の復元が返った後**に結線する。
    // 購読を始めた時点でメインが溜めていた要求を流してくる（確定事項77）が、復元より先に
    // 結線すると、その要求で切り替えたモードを、後から返る復元が保存されたモードへ戻して
    // しまう（spec-5-1 確定事項14）。復元は失敗しても受け口は結線する。
    root.SigK.app.ready = restoreUi(doc)
      .catch(() => null)
      .then(() => root.SigK.launch.init(doc, win));

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
