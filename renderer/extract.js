(function (root) {
  'use strict';

  // 抽出の指揮（spec-1-6 確定事項47〜52）。
  //
  // 選択中のページだけを別のファイルへ書き出す。書くのはワーカーで、走らせるのは
  // `save.js` の runTask である（進捗の帯・中止・二重起動の防止を1か所に持たせる
  // ため。確定事項9）。ここが受け持つのは
  //   ① 選択を plan の並びへ写す
  //   ② 失うものを確認させる（確定事項48）
  //   ③ 出力先を決める（確定事項49・96）
  //   ④ 終わったあと**何もしない**（確定事項50）
  // の4つである。
  //
  // ④ が肝心である。抽出は「取り出して渡す」操作であり、作業の場を移す操作では
  // ない。タブは開いたまま、書き出したファイルは開かず、未保存の印も動かさない。

  function viewer() {
    return root.SigK.viewer;
  }

  function grid() {
    return root.SigK.pageGrid;
  }

  function banner() {
    return root.SigK.viewBanner;
  }

  function selection() {
    return grid()?.getSelection() ?? [];
  }

  // ページモードで選択中のページがあるときだけ押せる（確定事項51）。
  // 保存中は塞ぐ（ワーカーを回す枠は1つしかない）。
  function canExtract() {
    return viewer()?.getState().open === true
      && root.SigK.save?.isBusy() !== true
      && selection().length > 0;
  }

  // 既定の出力名は `<元の名前>_抽出.pdf`（確定事項49）。同じフォルダーを既定にし、
  // 同名の確認は OS のダイアログに委ねる（確定事項22 と同じ）。元のファイル自身と
  // タブで開いているファイルは、選ばれたあとで断る（確定事項96）。
  function defaultTargetFor(file) {
    const source = file?.path;
    if (typeof source !== 'string' || source === '')
      return undefined;
    return `${source.replace(/\.pdf$/i, '')}_抽出.pdf`;
  }

  async function run() {
    if (root.SigK.save?.isBusy() === true)
      return { error: 'いま保存しています。' };
    // 入力中のテキストは確定してから抽出する（spec-4-2 確定事項8）。
    root.SigK.annotate?.finishEditing();

    const view = viewer().getState();
    if (!view.open)
      return { error: '文書が開かれていません。' };

    // 画面の並び（plan）から選択の位置を引く。src は元ファイルのページ番号なので、
    // 並べ替えたあとでも「いま見えている順」で取り出せる。
    const plan = viewer().getPlan();
    const pages = selection().map((index) => plan[index]).filter((entry) => entry !== undefined);
    if (pages.length === 0)
      return { error: '抽出するページが選ばれていません。' };

    if (await root.SigK.confirmExtract.ask({ count: pages.length }) !== true)
      return { canceled: true };

    const picked = await root.pdfAPI.pickSavePath({
      defaultPath: defaultTargetFor(view.file),
      title: 'ページを抽出',
    });
    if (picked?.canceled === true)
      return { canceled: true };
    if (typeof picked?.path !== 'string')
      return { error: picked?.error ?? '保存先を決められませんでした。' };
    // 元のファイル自身と、タブで開いているファイルへは書かない（確定事項96）。元へ書くと
    // 選んだページだけに置き換わり（.bak も作らない）、ほかのタブは古い内容のまま残る。
    const refused = root.SigK.outputTarget.refusalFor(picked.path, { source: view.file.path });
    if (refused !== null) {
      banner().show(refused);
      return { error: refused };
    }

    const result = await root.SigK.save.runTask({
      kind: 'extract',
      source: view.file.path,
      target: picked.path,
      pages,
      // 選んだページに付いた注釈も一緒に出す（spec-4-1 確定事項21）。
      // 新しい形のテキストは画面で決めた行を添える（spec-4b-4a 確定事項I1）。
      annotations: root.SigK.annotationState.toSaveSpec(viewer().getAnnotations(), { layoutOf: root.SigK.freeTextMetrics.layoutOfEntry }),
      // 元ファイルを触らないので、退避も外部変更の照合も要らない（確定事項18・21）。
      makeBackup: false,
      expect: null,
      label: '抽出',
    });

    if (result?.canceled === true) {
      // 自分で止めたので赤く塗らない（決定49）。
      banner().show('抽出を中止しました。', { tone: 'info' });
      return result;
    }
    if (result?.ok !== true) {
      banner().show(result?.error ?? '抽出できませんでした。');
      return result ?? { error: '抽出できませんでした。' };
    }

    // 成功は失敗ではないので赤く塗らない（決定48）。帯の既定の色は失敗の赤である。
    banner().show(`${result.pages} ページを抽出しました。`, { autoHideMs: 2500, tone: 'info' });
    return result;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.extract = { run, canExtract, defaultTargetFor };
})(typeof window !== 'undefined' ? window : globalThis);
