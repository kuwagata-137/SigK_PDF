(function (root) {
  'use strict';

  // ドラッグ＆ドロップで開く（F-06-1・spec-1-2 確定事項5・6）。
  //
  // 受けるのはウィンドウ全体である。落とす場所を狙わせない。どのモードで落としても PDF はタブで開き、モードは
  // 変えない（決定80）。ツールモードでは、移り期間として、選んでいるツールにも渡す（tool-handoff.js）。
  // dragover と drop の両方で preventDefault を呼ぶのは、既定の動作が
  // 「そのファイルへページ遷移する」であり、放っておくと画面が飛ぶためである
  // （main.js の will-navigate でも止めてはいるが、そこまで行かせない）。

  const state = { depth: 0 };

  let el = null;

  function handoff() {
    return root.SigK.toolHandoff;
  }

  function isPdfName(name) {
    return typeof name === 'string' && name.toLowerCase().endsWith('.pdf');
  }

  // 画像→PDF が受ける画像（spec-3-1 確定事項2・spec-3-2 確定事項33）。ここは拡張子で粗く選り分ける
  // だけで、本当にその形式かは足したあとに inspectImage が先頭バイトで判定する。
  function isImageName(name) {
    return typeof name === 'string' && /\.(png|jpe?g|bmp|gif|tiff?)$/i.test(name);
  }

  // 透かしの画面が受ける画像（spec-4-5 確定事項37。論点7）。PDF と一緒に受ける。
  function isWatermarkImageName(name) {
    return typeof name === 'string' && /\.(png|jpe?g)$/i.test(name);
  }

  // いまドロップを受けるツール。ツールモードでなければ null。
  function selectedTool() {
    return root.SigK.tools?.isToolsMode() === true ? root.SigK.tools.selected() : null;
  }

  // 受けるファイル。ツールモードでは PDF（タブで開く）と画像（画像→PDF の一覧へ）を受ける。透かしを選んで
  // いるときの画像は透かしの画像にするので、PNG・JPEG だけ（spec-4-5 確定事項37）。ツールモード以外は PDF だけ。
  function isAcceptedName(name) {
    const tool = selectedTool();
    if (tool === null)
      return isPdfName(name);
    if (tool === 'watermark')
      return isPdfName(name) || isWatermarkImageName(name);
    return isPdfName(name) || isImageName(name);
  }

  // 受けられるものが 1 つも無かったときの文言。
  function rejectionFor(tool) {
    if (tool === null)
      return 'PDF ファイルではないので、PDF を落としてください。';
    if (tool === 'watermark')
      return 'PDF でも PNG・JPEG でもないので、PDF か PNG・JPEG の画像を落としてください。';
    return 'PDF でも画像でもないので、PDF か画像（PNG・JPEG・BMP・GIF・TIFF）を落としてください。';
  }

  // ファイルを運んでいるドラッグかどうか。文字の選択をドラッグしただけで
  // 受け入れの表示が出ると、うるさいうえに紛らわしい。
  function carriesFiles(event) {
    const types = event.dataTransfer?.types;
    if (types === undefined || types === null)
      return false;
    return Array.from(types).includes('Files');
  }

  function setOverlay(visible) {
    if (el?.overlay == null)
      return;
    el.overlay.hidden = !visible;
  }

  // ドロップされた File から実際のパスを取る。File.path は Electron 32 で
  // 消えているため、preload の webUtils 経由が唯一の経路である（確定事項6）。
  function pathsFrom(fileList) {
    const api = root.pdfAPI;
    const paths = [];
    for (const file of Array.from(fileList ?? [])) {
      if (!isAcceptedName(file?.name))
        continue;
      const filePath = api?.pathForFile?.(file) ?? null;
      if (filePath !== null)
        paths.push(filePath);
    }
    return paths;
  }

  async function handleDrop(event) {
    event.preventDefault();
    state.depth = 0;
    setOverlay(false);

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0)
      return false;

    // ツールモードでは空の表示（#view-empty）が作業画面の下に隠れるので、帯で伝える。
    const complain = (text) => (root.SigK.tools?.isToolsMode() === true
      ? root.SigK.viewBanner.show(text)
      : root.SigK.viewer.setMessage(text));

    const accepted = files.filter((file) => isAcceptedName(file?.name));
    if (accepted.length === 0) {
      complain(rejectionFor(selectedTool()));
      return false;
    }

    const paths = pathsFrom(event.dataTransfer.files);
    if (paths.length === 0) {
      complain('ファイルの場所を取得できなかったので、「開く」から選んでください。');
      return false;
    }

    // ツールモードでは、PDF はタブで開いたうえで選んでいるツールにも渡し、画像は画像→PDF（透かしなら透かしの
    // 画像）へ渡す（決定80。今まではツールにだけ渡し、タブでは開かなかった。spec-2-1 確定事項12 ほかを改めた）。
    if (selectedTool() !== null) {
      const pdfs = paths.filter(isPdfName);
      await handoff().receiveDrop({ pdfs, images: paths.filter((filePath) => !isPdfName(filePath)) });
      return true;
    }

    // 1つずつ開く（tool-handoff.js の openPdfs）。まとめて走らせるとタブの並びが到着順で入れ替わる。
    await handoff().openPdfs(paths);
    return true;
  }

  function init(doc, win) {
    if (win.__sigkDropReady === true)
      return false;
    win.__sigkDropReady = true;

    el = { doc, overlay: doc.getElementById('view-drop') };

    doc.addEventListener('dragenter', (event) => {
      if (!carriesFiles(event))
        return;
      event.preventDefault();
      // dragleave は子要素をまたぐたびに飛んでくる。数えて釣り合わせる。
      state.depth += 1;
      setOverlay(true);
    });

    doc.addEventListener('dragover', (event) => {
      if (!carriesFiles(event))
        return;
      event.preventDefault();
      if (event.dataTransfer !== null)
        event.dataTransfer.dropEffect = 'copy';
    });

    doc.addEventListener('dragleave', () => {
      state.depth = Math.max(0, state.depth - 1);
      if (state.depth === 0)
        setOverlay(false);
    });

    doc.addEventListener('drop', handleDrop);
    setOverlay(false);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.fileDrop = { init, isPdfName, isImageName, carriesFiles, pathsFrom, handleDrop, depth: () => state.depth };
})(typeof window !== 'undefined' ? window : globalThis);
