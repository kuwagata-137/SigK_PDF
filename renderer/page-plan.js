(function (root) {
  'use strict';

  // ページ編集の純粋層（spec-1-5 A〜C・E・F）。DOM にも pdf.js にも触れない。
  // Node から require() して直接テストできるようにするためである（docs/07 第4章）。
  //
  // 編集の状態は plan という配列1本で持つ。要素は { src, rotate } で、
  // src は元ファイルの 0 始まりページ番号、rotate は元ページの /Rotate に
  // 足す相対角度（0/90/180/270）である（確定事項1）。
  //
  // 「操作の列」ではなく「結果の並び」で持つ理由は4つある（確定事項2）。
  // ① 時点の曖昧さが消える（配列は常に「いま」を表す。delete の後の rotate が
  // 削除前の番号か削除後の番号か、という問いが生まれない）② undo がスナップ
  // ショット列で書ける ③ 適用が冪等 ④ 並べ替え・回転・削除がすべて配列の操作に落ちる。
  //
  // その undo の履歴そのものは renderer/edit-history.js にある（塊④ の page-history.js を
  // 注釈と 1 本にした）。編集の状態を受け取って返すだけで、この層の関数を1つも呼ばないためである。

  // 要素は2種類ある（spec-1-6 確定事項65）。{ src, rotate } は元ファイルの
  // ページ、{ insert, rotate } は差し込んだページである。**両方とも運ぶ。**
  // 落とすと、undo で戻したときに差し込みが元ページ 0 に化ける。
  function copyPage(page) {
    return Number.isInteger(page?.insert)
      ? { insert: page.insert, rotate: page.rotate }
      : { src: page.src, rotate: page.rotate };
  }

  function clonePlan(plan) {
    return (plan ?? []).map(copyPage);
  }

  // 文書を開いた時点の並び（確定事項5）。編集していない状態も plan で表し、
  // 特別扱いを作らない。
  function createPlan(pageCount) {
    if (!Number.isInteger(pageCount) || pageCount <= 0)
      return [];
    return Array.from({ length: pageCount }, (_unused, index) => ({ src: index, rotate: 0 }));
  }

  // 回転の正規化は、このアプリで1か所だけここで行う（確定事項4）。
  // pdf.js は 360 で剰余して負値に +360 するが、pdf-lib の setRotation は
  // 何も正規化しない。両方へ同じ値を渡せるよう、持つ時点で丸めておく。
  function normalizeRotation(degrees) {
    if (!Number.isFinite(degrees))
      return 0;
    const step = Math.round(degrees / 90) * 90;
    return ((step % 360) + 360) % 360;
  }

  // 表示 index の集合を、重複なし・昇順・範囲内に整える。
  function normalizeIndices(indices, length) {
    const kept = new Set();
    for (const index of indices ?? []) {
      if (Number.isInteger(index) && index >= 0 && index < length)
        kept.add(index);
    }
    return [...kept].sort((a, b) => a - b);
  }

  // ---- 回転（確定事項38） ----

  function rotatePages(plan, indices, delta) {
    const targets = new Set(normalizeIndices(indices, plan.length));
    return plan.map((page, index) => (targets.has(index)
      ? { src: page.src, rotate: normalizeRotation(page.rotate + delta) }
      : copyPage(page)));
  }

  // ---- 並べ替え（確定事項30・34） ----

  // to は「いまの並びの、その位置の手前へ入れる」という意味の 0..length である。
  // 掴んだ枚をまとめて動かし、選ばれていない紙どうしの前後関係は変えない。
  function movePages(plan, indices, to) {
    const targets = normalizeIndices(indices, plan.length);
    if (targets.length === 0)
      return { plan: clonePlan(plan), selection: [], changed: false };

    const picked = new Set(targets);
    const moving = targets.map((index) => plan[index]);
    const rest = plan.filter((_page, index) => !picked.has(index));

    // to より手前にあった紙を抜いたぶん、挿入位置は手前へずれる。
    const removedBefore = targets.filter((index) => index < to).length;
    const at = Math.min(rest.length, Math.max(0, to - removedBefore));

    const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)].map(copyPage);
    // 並べ替えでは選択を移動先へ付け替える（確定事項14）。掴んだ紙を見失わない。
    const selection = moving.map((_page, offset) => at + offset);
    // 選ばれた紙の位置が1つも変わらなければ、ほかも動いていない。
    const changed = targets.some((index, offset) => index !== selection[offset]);
    return { plan: next, selection, changed };
  }

  // ---- 削除（確定事項41・42） ----

  // 最後の1ページは消せない。pdf-lib の save() が既定で白紙 A4 を生やす
  // （addDefaultPage:true）件を、そもそも起こさないためである。
  function canDelete(plan, indices) {
    const targets = normalizeIndices(indices, plan.length);
    return targets.length > 0 && targets.length < plan.length;
  }

  function deletePages(plan, indices) {
    const targets = normalizeIndices(indices, plan.length);
    if (!canDelete(plan, indices))
      return { plan: clonePlan(plan), selection: targets, changed: false };

    const removed = new Set(targets);
    const next = plan.filter((_page, index) => !removed.has(index)).map(copyPage);
    // 消した位置に来たページを選び直す。末尾を消したなら最後のページ。
    // 選択が空にならないので、続けて Delete を押せる。
    const at = Math.min(next.length - 1, targets[0]);
    return { plan: next, selection: [at], changed: true };
  }

  // ---- 未保存の判定（確定事項6） ----

  // 2つの並びが同じか。保存したあとの未保存判定に使う（spec-1-6「穴1」）。
  function samePlan(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((page, index) =>
      page.src === b[index].src && page.insert === b[index].insert && page.rotate === b[index].rotate);
  }

  // plan の要素から「どの文書の何ページ目を描くか」を返す（spec-1-6 確定事項93）。
  //
  // src なら元の文書、insert なら差し込んだ文書である。引けなければ null。
  // ページビュー（page-render.js）・サムネイル・検索・印刷がここを共有するので、
  // 差し込みの見え方が1か所で決まる。
  function sourceOf(plan, index, { doc = null, inserts = [] } = {}) {
    const entry = plan?.[index];
    if (Number.isInteger(entry?.insert)) {
      const added = inserts[entry.insert];
      return added?.doc === undefined || added?.doc === null
        ? null
        : { doc: added.doc, number: (added.page ?? 0) + 1 };
    }
    return doc === null || doc === undefined ? null : { doc, number: (entry?.src ?? index) + 1 };
  }

  // 操作した回数では決めない。3回回して元に戻したら dirty ではない。
  //
  // 開いたまま一度も保存していない文書のための判定である。保存したあとは
  // 「保存した並びと同じか」で決めるので samePlan を使う（spec-1-6 確定事項27）。
  function isDirty(plan, pageCount) {
    if (!Array.isArray(plan) || plan.length !== pageCount)
      return true;
    return plan.some((page, index) => page.src !== index || page.rotate !== 0);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pagePlan = {
    createPlan,
    clonePlan,
    normalizeRotation,
    normalizeIndices,
    rotatePages,
    movePages,
    canDelete,
    deletePages,
    isDirty,
    samePlan,
    sourceOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
