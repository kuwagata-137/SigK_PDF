(function (root) {
  'use strict';

  // サイドパネルの注釈一覧（spec-4-4 確定事項9・29〜31）。
  //
  // 注釈モードのとき、#side-scroll の中の #annot-list に annotation-index.js の行を描く。合図
  // （viewer.setAnnotations／setImported／applyPlan／resetView、モードの切り替え、annotate.select）の
  // たびに全部組み直す（2,000 行でも 40ms。事前調査 E）。行を押すと選んで該当箇所へ寄せる。
  // ページがまだ描かれていなければ goToPage して、描かれた合図（onPageRendered）で寄せる
  // （検索の pendingReveal と同じ流儀）。紙の上で選ぶと行が光り、その行まで一覧を動かす。

  const state = { doc: null, pendingReveal: null };
  let el = null;

  function viewer() {
    return root.SigK.viewer;
  }

  function annotate() {
    return root.SigK.annotate;
  }

  function index() {
    return root.SigK.annotationIndex;
  }

  function isVisible() {
    const html = state.doc?.documentElement;
    // 編集モードで、左の切り替えが「注釈一覧」のときだけ（spec-4b-1a 確定事項16）。
    return html?.getAttribute('data-mode') === 'annot' && html.getAttribute('data-panel') === 'open' && html.getAttribute('data-edit-side') === 'list';
  }

  function iconOf(doc, row) {
    const holder = doc.createElement('span');
    holder.className = 'ic';
    holder.style.color = row.color;
    if (root.SigK.icons?.has(row.icon))
      holder.append(root.SigK.icons.create(doc, row.icon, { size: 16, strokeWidth: 1.9 }));
    return holder;
  }

  // 1 行。アイコン（注釈の色）・p.N・本文の先頭行（無ければ種類名を灰色で）・表示のみの印。
  function rowElement(doc, row) {
    const node = doc.createElement('button');
    node.type = 'button';
    node.className = `annot-row${row.readonly ? ' readonly' : ''}`;
    node.dataset.key = row.key;
    node.title = `${row.label}（p.${row.page}）${row.title ? `: ${row.title}` : ''}`;
    const page = doc.createElement('span');
    page.className = 'pg';
    page.textContent = `p.${row.page}`;
    const text = doc.createElement('span');
    text.className = row.title ? 'tx' : 'tx kind';
    text.textContent = row.title || row.label;
    node.append(iconOf(doc, row), page, text);
    if (row.readonly) {
      const mark = doc.createElement('span');
      mark.className = 'ro';
      mark.textContent = '表示のみ';
      node.append(mark);
    }
    node.addEventListener('click', () => reveal(row.key));
    return node;
  }

  // 出し入れと描き直し。注釈モードでなければ隠すだけ。
  function refresh() {
    if (el === null)
      return false;
    const visible = isVisible();
    el.list.hidden = !visible;
    if (!visible)
      return false;
    const view = viewer();
    const open = view?.getState().open === true;
    const rows = open ? index().rowsOf(view.getAnnotations(), view.getImported(), view.getPlan()) : [];
    el.rows.replaceChildren(...rows.map((row) => rowElement(el.doc, row)));
    el.empty.textContent = open ? '書き込みはありません' : '文書を開くと書き込みの一覧が出ます';
    el.empty.hidden = rows.length > 0;
    // サムネイルの「文書を開くと…」の案内はここでは出さない（ツールモードと同じ）。
    const placeholder = el.doc.getElementById('thumbs-empty');
    if (placeholder !== null)
      placeholder.hidden = true;
    syncSelected(annotate()?.getSelection() ?? []);
    return true;
  }

  // 選んでいる注釈の行を全部同じ色で光らせ、主（並びの最後）の行を見えるところまで一覧を動かす（spec-4b-3a 確定事項K4）。
  // keys は鍵の並び（今までの 1 件の鍵や null も受ける）。
  function syncSelected(keys) {
    if (el === null)
      return false;
    const list = root.SigK.annotationSelection.keysOf(keys);
    const primary = list.at(-1) ?? null;
    let found = null;
    for (const row of el.rows.children) {
      row.classList.toggle('on', list.includes(row.dataset.key));
      if (row.dataset.key === primary)
        found = row;
    }
    found?.scrollIntoView?.({ block: 'nearest' });
    return found !== null;
  }

  // 描かれたページの層にある注釈（表示のみは枠。枠は紙の外の層にある。spec-4b-2 確定事項9）へ寄せる。無ければ false。
  function scrollToTarget(pageIndex) {
    if (state.pendingReveal === null)
      return false;
    const layer = state.doc.querySelector(`.pdf-page[data-page="${pageIndex + 1}"] .annot-layer`);
    const frame = root.SigK.annotationFrame?.shown()?.index === pageIndex ? state.doc.querySelector('.annot-frame-layer .annot-frame') : null;
    const target = layer?.querySelector(`g[data-annot="${state.pendingReveal}"]`) ?? frame ?? null;
    if (target === null)
      return false;
    state.pendingReveal = null;
    target.scrollIntoView?.({ block: 'center' });
    return true;
  }

  // 行を押した。選んで、該当ページへ飛び、注釈を画面の中央に寄せる（確定事項30）。
  function reveal(key) {
    const view = viewer();
    if (view === undefined || annotate()?.select(key) !== key)
      return false;
    const entry = annotate().selectedEntry();
    const pageIndex = view.getPlan().findIndex((page) => page.src === entry.src);
    if (pageIndex < 0)
      return false;
    state.pendingReveal = key;
    if (!scrollToTarget(pageIndex))
      view.goToPage(pageIndex);
    return true;
  }

  // page-render.js が注釈の層を描き終えた合図。
  function onPageRendered(pageIndex) {
    return scrollToTarget(pageIndex);
  }

  function init(doc, win) {
    if (win.__sigkAnnotationListReady === true)
      return false;
    const list = doc.getElementById('annot-list');
    const rows = doc.getElementById('annot-rows');
    const empty = doc.getElementById('annot-list-empty');
    if (list === null || rows === null || empty === null)
      return false;
    win.__sigkAnnotationListReady = true;
    state.doc = doc;
    el = { doc, list, rows, empty };
    refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationList = { init, refresh, syncSelected, reveal, onPageRendered, isPendingReveal: () => state.pendingReveal !== null };
})(typeof window !== 'undefined' ? window : globalThis);
