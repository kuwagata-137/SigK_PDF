(function (root) {
  'use strict';

  // ドラッグ＆ドロップで開く（F-06-1・spec-1-2 確定事項5・6）。
  //
  // 受けるのはウィンドウ全体である。落とす場所を狙わせない。
  // dragover と drop の両方で preventDefault を呼ぶのは、既定の動作が
  // 「そのファイルへページ遷移する」であり、放っておくと画面が飛ぶためである
  // （main.js の will-navigate でも止めてはいるが、そこまで行かせない）。

  const state = { depth: 0 };

  let el = null;

  function tabs() {
    return root.SigK.tabs;
  }

  function isPdfName(name) {
    return typeof name === 'string' && name.toLowerCase().endsWith('.pdf');
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
      if (!isPdfName(file?.name))
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

    const pdfs = files.filter((file) => isPdfName(file?.name));
    if (pdfs.length === 0) {
      complain('PDF ファイルではありません。PDF を落としてください。');
      return false;
    }

    const paths = pathsFrom(event.dataTransfer.files);
    if (paths.length === 0) {
      complain('ファイルの場所を取得できませんでした。「開く」から選んでください。');
      return false;
    }

    // ツールモードでは結合画面が受け取る（spec-2-1 確定事項12）。
    // タブに開くのではなく、一覧の末尾へ足す。
    if (root.SigK.tools?.isToolsMode() === true && root.SigK.toolsMerge !== undefined) {
      await root.SigK.toolsMerge.addPaths(paths);
      return true;
    }

    // 1つずつ開く。まとめて走らせるとタブの並びが到着順で入れ替わる。
    for (const filePath of paths)
      await tabs().openPath(filePath);
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
  SigK.fileDrop = { init, isPdfName, carriesFiles, pathsFrom, handleDrop, depth: () => state.depth };
})(typeof window !== 'undefined' ? window : globalThis);
