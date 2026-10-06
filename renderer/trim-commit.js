(function (root) {
  'use strict';

  // トリミングを当てる・外す（spec-4b-6a 確定事項14・18・19。決定64 ②③）。plan の crop を作り替え、pageEdit.commit で 1 世代にする。
  //
  // 枠を引くのは annotate-trim.js、右パネルは trim-props.js。ここは plan を作り替えるだけで、DOM に触れない（切ったあとの帯と表示の
  // 寄せは annotate-trim.js）。紙全体（MediaBox）は page-boxes.js が読み終えたものを使い、読めていなければファイルの見える範囲で代える。

  function viewer() {
    return root.SigK.viewer;
  }

  function crop() {
    return root.SigK.pageCrop;
  }

  // plan の要素の { view（ファイルの見える範囲）, rotation（/Rotate に plan の回転を足した絶対角）, visible（今の見える範囲）}。
  // 差し込んだページ（src を持たない）は null。
  function pageOf(entry) {
    if (!Number.isInteger(entry?.src))
      return null;
    const base = viewer().getBasePage(entry.src);
    if (base === null)
      return null;
    return { view: base.view, rotation: base.rotate + (entry.rotate ?? 0), visible: crop().visibleOf(entry, base.view) };
  }

  // 元ページ src の紙全体。読めていなければ、ファイルの見える範囲。
  function paperOf(src, page) {
    return root.SigK.pageBoxes?.mediaBoxOf(viewer().getState().file, src) ?? crop().normalizeBox(page.view);
  }

  // すべてのページ（確定事項18）: 枠を引いたページの余白（表示の向き）を、ほかの元のページの見える範囲からも切る。
  function allPages(plan, margins, result) {
    plan.forEach((entry, at) => {
      const page = pageOf(entry);
      if (page === null) {
        result.inserted += 1;
        return;
      }
      const next = crop().shrinkBy(page.visible, margins, page.rotation);
      if (next === null)
        result.small += 1;
      else if (!crop().sameBox(next, page.visible))
        result.crops.set(at, (copy) => crop().withCrop(copy, next, page.view));
    });
  }

  // index のページを box で切る作り替え { crops（位置 → 要素を作り替える関数）, small, inserted }。scope が 'all' なら全部の元のページ。
  // box が今の見える範囲と同じなら crops は空。
  function cropsFor(plan, index, box, scope) {
    const result = { crops: new Map(), small: 0, inserted: 0 };
    const own = pageOf(plan[index]);
    const target = own === null ? null : crop().intersectBox(box, own.visible);
    if (target === null || crop().sameBox(target, own.visible))
      return result;
    if (scope === 'all')
      allPages(plan, crop().marginsOf(own.visible, target, own.rotation), result);
    else
      result.crops.set(index, (copy) => crop().withCrop(copy, target, own.view));
    return result;
  }

  function commit(plan, crops) {
    const at = [...crops.keys()];
    root.SigK.pageEdit.commit(root.SigK.pagePlan.cropPages(plan, crops), { before: at, after: at });
  }

  // 切る。{ count（切ったページの数）, small（小さすぎてそのままにした数）, inserted（差し込んだページの数）} を返す。count が 0 なら積まない。
  function apply(index, box, scope) {
    const plan = viewer().getPlan();
    const { crops, small, inserted } = cropsFor(plan, index, box, scope);
    if (crops.size > 0)
      commit(plan, crops);
    return { count: crops.size, small, inserted };
  }

  // 紙全体に戻す作り替え。scope が 'page' なら index のページ、'all' なら元のページ全部。
  function removalsFor(plan, index, scope) {
    const crops = new Map();
    const targets = scope === 'all' ? plan.map((_entry, at) => at) : [index];
    for (const at of targets) {
      const page = pageOf(plan[at]);
      const paper = page === null ? null : paperOf(plan[at].src, page);
      if (paper !== null && !crop().sameBox(page.visible, paper))
        crops.set(at, (copy) => crop().withCrop(copy, paper, page.view));
    }
    return crops;
  }

  // 紙全体に戻す（確定事項19）。戻したページの数を返す。0 なら積まない。
  function remove(index, scope) {
    const plan = viewer().getPlan();
    const crops = removalsFor(plan, index, scope);
    if (crops.size > 0)
      commit(plan, crops);
    return crops.size;
  }

  // 右パネルに出すこと。count は外せる（＝紙全体より狭い）ページの数、page は index のページの { cropped, box, rotation }
  // （差し込んだページなら null）。
  function statusOf(index, scope) {
    const plan = viewer()?.getPlan() ?? [];
    const page = pageOf(plan[index]);
    const count = removalsFor(plan, index, scope).size;
    if (page === null)
      return { count, page: null };
    const cropped = !crop().sameBox(page.visible, paperOf(plan[index].src, page));
    return { count, page: { cropped, box: page.visible, rotation: page.rotation } };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.trimCommit = { apply, remove, statusOf };
})(typeof window !== 'undefined' ? window : globalThis);
