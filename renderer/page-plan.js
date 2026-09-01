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

  // 履歴として持つ世代の数（確定事項9）。plan 1本は 1,000 ページでも要素 1,000 個
  // なので、50 世代持っても数MBに収まる。
  const MAX_HISTORY = 50;

  function copyPage(page) {
    return { src: page.src, rotate: page.rotate };
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

  // 操作した回数では決めない。3回回して元に戻したら dirty ではない。
  function isDirty(plan, pageCount) {
    if (!Array.isArray(plan) || plan.length !== pageCount)
      return true;
    return plan.some((page, index) => page.src !== index || page.rotate !== 0);
  }

  // ---- 元に戻す・やり直し（確定事項8〜13） ----

  // plan のスナップショット列で持つ。逆操作を書かないので、操作の種類が
  // 増えても undo の実装は増えない。
  //
  // 各世代は before と after を持つ。before は「この操作をする前の並びにおける
  // 対象の位置」、after は「した後の位置」である。戻した直後に、その世代で
  // 操作の対象だったページを選び直すのに使う（確定事項12。何が戻ったかを示す）。
  function createHistory(plan) {
    return { stack: [{ plan: clonePlan(plan), before: [], after: [] }], at: 0 };
  }

  function canUndo(history) {
    return history.at > 0;
  }

  function canRedo(history) {
    return history.at < history.stack.length - 1;
  }

  function pushHistory(history, plan, { before = [], after = [] } = {}) {
    // 戻した状態から新しい操作をしたら、先の履歴は捨てる（確定事項10）。
    const stack = history.stack.slice(0, history.at + 1);
    stack.push({ plan: clonePlan(plan), before: [...before], after: [...after] });
    // 上限を超えたら古いほうから捨てる。
    while (stack.length > MAX_HISTORY)
      stack.shift();
    return { stack, at: stack.length - 1 };
  }

  function undo(history) {
    if (!canUndo(history))
      return { history, plan: clonePlan(history.stack[history.at].plan), selection: [], changed: false };

    // 取り消すのは「いま居る世代」を作った操作である。
    const undoing = history.stack[history.at];
    const at = history.at - 1;
    return {
      history: { stack: history.stack, at },
      plan: clonePlan(history.stack[at].plan),
      selection: [...undoing.before],
      changed: true,
    };
  }

  function redo(history) {
    if (!canRedo(history))
      return { history, plan: clonePlan(history.stack[history.at].plan), selection: [], changed: false };

    const at = history.at + 1;
    const redoing = history.stack[at];
    return {
      history: { stack: history.stack, at },
      plan: clonePlan(redoing.plan),
      selection: [...redoing.after],
      changed: true,
    };
  }

  // ---- 選択（確定事項14〜18） ----

  function sortedFrom(set) {
    return [...set].sort((a, b) => a - b);
  }

  function rangeBetween(from, to) {
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const range = [];
    for (let index = start; index <= end; index += 1)
      range.push(index);
    return range;
  }

  // クリック1回で選択と起点がどう動くかを決める。選択は表示 index の集合で
  // 持ち、src では持たない（並べ替えで選択が飛ばないようにするため）。
  function resolveClick({ selection = [], anchor = null, index, ctrl = false, shift = false }) {
    if (!Number.isInteger(index))
      return { selection: [...selection], anchor };

    // Shift は起点からの範囲。起点は動かさない。Ctrl+Shift なら範囲を足す。
    if (shift) {
      const from = Number.isInteger(anchor) ? anchor : index;
      const range = rangeBetween(from, index);
      const next = ctrl ? sortedFrom(new Set([...selection, ...range])) : range;
      return { selection: next, anchor: from };
    }

    // Ctrl は押した1枚の選択を反転する。起点はそこへ移る。
    if (ctrl) {
      const kept = new Set(selection);
      if (kept.has(index))
        kept.delete(index);
      else
        kept.add(index);
      return { selection: sortedFrom(kept), anchor: index };
    }

    return { selection: [index], anchor: index };
  }

  function selectAll(count) {
    if (!Number.isInteger(count) || count <= 0)
      return [];
    return Array.from({ length: count }, (_unused, index) => index);
  }

  // ---- 挿入位置（確定事項33） ----

  // ドラッグ中の座標から「何番目の手前へ入れるか」を出す。
  //
  // elementFromPoint を使わないのは、jsdom が持たないためである。純粋関数に
  // しておけば、多列グリッドの当たり判定を依存なしで検証できる。
  function groupRows(pages) {
    const rows = [];
    for (const page of pages) {
      const row = rows.find((candidate) => candidate.top === page.top);
      if (row === undefined) {
        rows.push({ top: page.top, bottom: page.top + page.height, items: [page] });
        continue;
      }
      row.items.push(page);
      row.bottom = Math.max(row.bottom, page.top + page.height);
    }
    return rows;
  }

  function pickRow(rows, y) {
    const hit = rows.find((row) => y >= row.top && y < row.bottom);
    if (hit !== undefined)
      return hit;
    // 行と行の隙間に落ちた場合。近いほうの行で判定する。
    return y < rows[0].top ? rows[0] : rows[rows.length - 1];
  }

  function dropIndex({ layout, columns = 1, x, y }) {
    const pages = layout?.pages ?? [];
    if (pages.length === 0)
      return 0;

    const rows = groupRows(pages);
    // 並びの外側は端へ寄せる。いちばん下に落としたら末尾、上なら先頭。
    if (y >= rows[rows.length - 1].bottom)
      return pages.length;
    if (y < rows[0].top)
      return 0;

    const row = pickRow(rows, y);

    // 1列のときは上下で決める。左右で決めると、紙の右半分に置いただけで
    // 「次のページの手前」になってしまう。
    if (columns <= 1) {
      const item = row.items[0];
      return y < item.top + item.height / 2 ? item.index : item.index + 1;
    }

    const items = row.items;
    const last = items[items.length - 1];
    if (x < items[0].left)
      return items[0].index;
    if (x >= last.left + last.width)
      return last.index + 1;
    for (const item of items) {
      if (x < item.left + item.width / 2)
        return item.index;
    }
    return last.index + 1;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pagePlan = {
    MAX_HISTORY,
    createPlan,
    clonePlan,
    normalizeRotation,
    normalizeIndices,
    rotatePages,
    movePages,
    canDelete,
    deletePages,
    isDirty,
    createHistory,
    canUndo,
    canRedo,
    pushHistory,
    undo,
    redo,
    resolveClick,
    selectAll,
    dropIndex,
  };
})(typeof window !== 'undefined' ? window : globalThis);
