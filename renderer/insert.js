(function (root) {
  'use strict';

  // 挿入の指揮（spec-1-6 確定事項53〜65・93〜95）。
  //
  // 押されたら**その場でワーカーに1ページの PDF を組み立てさせ**、返ってきた
  // バイト列を pdf.js で開いて `viewer` に控える（確定事項93）。plan には
  // `{ insert: <番号>, rotate: 0 }` を入れるだけで、元ファイルへ差し込むのは
  // 保存のときである（確定事項65）。
  //
  // **画面に出るものと保存されるものは、同じ `worker/op-insert.js` から出る。**
  // 別々に組み立てると、紙の大きさや余白が必ずどこかで食い違う。
  //
  // 形式の判定はここでしない。拡張子は中身と食い違うことがあるので、
  // ワーカーが先頭バイトで見て断る（確定事項53）。ここは断り文句を帯へ出すだけ。

  function viewer() {
    return root.SigK.viewer;
  }

  function grid() {
    return root.SigK.pageGrid;
  }

  function banner() {
    return root.SigK.viewBanner;
  }

  function canInsert() {
    return viewer()?.getState().open === true && root.SigK.save?.isBusy() !== true;
  }

  // 選択中のページの**直前**。選択が無ければ末尾（確定事項64）。
  function insertAt() {
    const selected = grid()?.getSelection() ?? [];
    return selected.length > 0
      ? Math.min(...selected)
      : viewer().getState().pageCount;
  }

  // 差し込む紙の大きさは、**挿入した時点の**直前のページに合わせる
  // （確定事項60・95）。先頭へ挿すときは直後のページ。ここで決めた寸法を
  // 控えるので、あとで並べ替えても紙の大きさは変わらない。
  //
  // viewer の sizes は plan の回転を当てたあとの「見えている寸法」なので、
  // 回転しているページが基準でも幅と高さの入れ替えが済んでいる。
  function baseSizeAt(at) {
    const sizes = viewer().getSizes();
    return sizes[at - 1] ?? sizes[at] ?? null;
  }

  // 組み立てたバイト列を pdf.js で開く。画面へ出すのはこの文書である。
  async function openPreview(bytes) {
    if (root.SigK.pdfjs?.available !== true)
      return null;
    try {
      return await root.SigK.pdfjs.getDocument({ data: bytes }).promise;
    } catch (error) {
      return null;
    }
  }

  async function run() {
    if (root.SigK.save?.isBusy() === true)
      return { error: 'いま保存しています。' };
    if (viewer().getState().open !== true)
      return { error: '文書が開かれていません。' };

    const picked = await root.pdfAPI.pickInsertSource({});
    if (picked?.canceled === true)
      return { canceled: true };
    if (typeof picked?.path !== 'string')
      return { error: picked?.error ?? '差し込むファイルを決められませんでした。' };

    const at = insertAt();
    const built = await root.SigK.save.runTask({
      kind: 'insert-preview',
      path: picked.path,
      base: baseSizeAt(at),
      label: '差し込み',
    });

    if (built?.canceled === true) {
      banner().show('差し込みを中止しました。');
      return built;
    }
    if (built?.ok !== true) {
      banner().show(built?.error ?? '差し込めませんでした。');
      return built ?? { error: '差し込めませんでした。' };
    }

    const doc = await openPreview(built.bytes);
    if (doc === null) {
      banner().show('差し込むページを表示できませんでした。');
      return { error: '差し込むページを表示できませんでした。' };
    }

    // 1つの PDF から複数ページ来ることがある。控えはページごとに作り、
    // pdf.js の文書は共有する（畳むのは viewer が実体ごとに1回だけ行う）。
    const numbers = viewer().addInserts(built.pages.map((size, index) => ({
      path: picked.path,
      page: index,
      size,
      doc,
    })));

    const plan = viewer().getPlan();
    const next = [
      ...plan.slice(0, at),
      ...numbers.map((insert) => ({ insert, rotate: 0 })),
      ...plan.slice(at),
    ];
    // 1回の操作で1世代（spec-1-5 確定事項13）。undo で戻せる。
    const after = numbers.map((_number, index) => at + index);
    root.SigK.pageEdit.commit(next, { before: [], after });

    banner().show(`${numbers.length} ページを差し込みました。`, 2500);
    return { ok: true, pages: numbers.length, at };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.insert = { run, canInsert, insertAt, baseSizeAt };
})(typeof window !== 'undefined' ? window : globalThis);
