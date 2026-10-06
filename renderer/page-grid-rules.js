(function (root) {
  'use strict';

  // ページ編集の格子の選択と並べ替えの当たり判定（spec-1-5 確定事項14〜18・33・36）。DOM にも pdf.js にも触れない純粋層。
  //
  // 295 行になった page-plan.js から移した（spec-4b-6a a0。中身は変えていない）。page-plan.js は plan（結果の並び）そのものの
  // 操作だけを持ち、ここは格子（page-grid.js）が押した点・引いた点からどのページを選ぶか、どこへ入れるかを決める。

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

  // ドラッグ中、パネルの端に寄せたときのスクロール量（確定事項36）。
  // 長い文書で、掴んだ紙を画面の外まで運べないのを防ぐ。
  //
  // タイマーの結線ではなく1回ぶんの量だけをここに置くのは、jsdom で
  // 時間を進めずに規則そのものを確かめられるようにするためである。
  function autoScrollStep({ y, viewportHeight, edge, step }) {
    if (!(viewportHeight > 0) || !(edge > 0))
      return 0;
    if (y < edge)
      return -step;
    if (y > viewportHeight - edge)
      return step;
    return 0;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageGridRules = {
    resolveClick,
    selectAll,
    dropIndex,
    autoScrollStep,
  };
})(typeof window !== 'undefined' ? window : globalThis);
