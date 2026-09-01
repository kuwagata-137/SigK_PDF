(function (root) {
  'use strict';

  // 検索を文書へ当てる層。テキストの取り出し・ヒットの保持・ハイライトの
  // 描き当て・ヒットへの移動を持つ（spec-1-4 A・C）。文字そのものの処理は
  // renderer/find-text.js にある。
  //
  // 状態はタブごとである（確定事項3・27）。映しているタブのぶんだけをここが
  // 抱え、タブが移るときは viewer.js の detach()／attach() に相乗りして session
  // へ退避する。canvas と違ってテキストは軽いので、タブを戻すたびに読み直す
  // 理由がない。

  const state = {
    term: '',
    matchCase: false,
    // ページごとの item 文字列。文書につき1度だけ取る（確定事項2）。
    pages: null,
    pending: null,
    loading: false,
    matches: [],
    byPage: new Map(),
    current: -1,
    // ハイライトを当てた span の番号。次に当て直すとき元へ戻すために持つ。
    painted: new Map(),
    // まだ描かれていないページのヒットへ飛んだとき、描けた時点で寄せる。
    pendingReveal: -1,
    // 取り出しの世代。文書が変わったら飛んでいる取り出しを捨てる。
    textToken: 0,
    // 検索の世代。語や大文字小文字の切り替えのたびに上がる。
    searchToken: 0,
  };

  function viewer() {
    return root.SigK.viewer;
  }

  function text() {
    return root.SigK.findText;
  }

  function report(error) {
    root.SigK.log?.report({
      level: 'warn',
      message: error?.message ?? String(error),
      stack: error?.stack,
      context: { source: 'find' },
    });
  }

  function view() {
    const match = state.current < 0 ? null : state.matches[state.current];
    return {
      term: state.term,
      matchCase: state.matchCase,
      loading: state.loading,
      total: state.matches.length,
      current: state.current,
      page: match === undefined || match === null ? -1 : match.page,
      ready: state.pages !== null,
    };
  }

  function notify() {
    root.SigK.findBar?.render(view());
    return view();
  }

  // ---- テキストの取り出し ----

  // 検索を始めた時に全ページ分をまとめて取る（確定事項2）。開くたびに全ページ
  // 読むのは、検索しない大多数の場面で無駄になる。
  //
  // 打つたびに読み直さないよう、飛んでいる取り出しは1本にまとめる。確定事項5
  // が捨てよと言っているのは「古い結果を当てないこと」であり、読みかけの
  // ページを毎打鍵で捨てることではない。取り出しの生死は textToken、結果を
  // 当てるかどうかは searchToken で見る。
  function ensureText() {
    if (state.pages !== null)
      return Promise.resolve(state.pages);
    if (state.pending !== null)
      return state.pending;

    const token = state.textToken;
    const pageCount = viewer().getState().pageCount;
    state.loading = true;
    notify();

    state.pending = (async () => {
      const pages = [];
      try {
        for (let number = 1; number <= pageCount; number += 1) {
          const page = await viewer().getPage(number);
          if (page === null || token !== state.textToken)
            return null;
          const content = await page.getTextContent();
          if (token !== state.textToken)
            return null;
          pages.push((content?.items ?? []).map((item) => (typeof item?.str === 'string' ? item.str : '')));
        }
      } catch (error) {
        report(error);
        return null;
      }
      if (token !== state.textToken)
        return null;
      state.pages = pages;
      return pages;
    })().finally(() => {
      if (token === state.textToken) {
        state.pending = null;
        state.loading = false;
      }
    });

    return state.pending;
  }

  // ---- ヒットの列挙 ----

  function dropMatches() {
    state.matches = [];
    state.byPage = new Map();
    state.current = -1;
    state.pendingReveal = -1;
  }

  function indexMatches(matches) {
    const byPage = new Map();
    for (let ordinal = 0; ordinal < matches.length; ordinal += 1) {
      const match = matches[ordinal];
      const list = byPage.get(match.page) ?? [];
      list.push({ match, ordinal });
      byPage.set(match.page, list);
    }
    return byPage;
  }

  async function run(term, options = {}) {
    state.term = typeof term === 'string' ? term : '';
    state.matchCase = options.matchCase ?? state.matchCase;
    state.searchToken += 1;
    const token = state.searchToken;

    const needle = text().prepareTerm(state.term, { matchCase: state.matchCase });
    if (needle === null || viewer().getState().open !== true) {
      dropMatches();
      repaint();
      return notify();
    }

    const pages = await ensureText();
    if (token !== state.searchToken)
      return view();
    if (pages === null) {
      dropMatches();
      repaint();
      return notify();
    }

    const matches = [];
    for (let index = 0; index < pages.length; index += 1) {
      for (const hit of text().matchesInPage({ items: pages[index], term: needle, matchCase: state.matchCase }))
        matches.push({ page: index, ...hit });
    }
    state.matches = matches;
    state.byPage = indexMatches(matches);
    state.current = matches.length === 0 ? -1 : 0;
    repaint();
    if (state.current >= 0)
      reveal(state.current);
    return notify();
  }

  function step(delta) {
    if (state.matches.length === 0)
      return notify();
    state.current = text().stepIndex(state.current, state.matches.length, delta);
    repaint();
    reveal(state.current);
    return notify();
  }

  // ---- ハイライト ----

  // ヒットの範囲だけを span で包み直す。span を丸ごと作り直さず中身を組み替え
  // るのは、pdf.js が span へ書いた位置と変形（--font-height・--scale-x・
  // transform）を壊さないためである。
  function rebuildDiv(div, source, pieces) {
    const doc = div.ownerDocument;
    const sorted = [...pieces].sort((a, b) => a.from - b.from);
    const nodes = [];
    let at = 0;

    for (const piece of sorted) {
      // 重なったヒットは先に見つけたほうを採る。
      if (piece.from < at)
        continue;
      if (piece.from > at)
        nodes.push(doc.createTextNode(source.slice(at, piece.from)));
      const span = doc.createElement('span');
      // appended は position:initial を当てる印である（text-layer.css）。
      // これが無いと、包んだ span が絶対配置になって行から浮く。
      span.className = piece.className + ' appended';
      span.append(doc.createTextNode(source.slice(piece.from, piece.to)));
      nodes.push(span);
      at = piece.to;
    }
    if (at < source.length)
      nodes.push(doc.createTextNode(source.slice(at)));
    div.replaceChildren(...nodes);
  }

  function restorePainted(index, divs, items) {
    const touched = state.painted.get(index);
    if (touched === undefined)
      return;
    for (const divIndex of touched) {
      const div = divs[divIndex];
      if (div !== undefined)
        div.textContent = items[divIndex] ?? '';
    }
    state.painted.delete(index);
  }

  // ページ1枚のハイライトを当て直す。まだ描いていないページは span が無いので
  // 何もしない。描いた時点で page-render.js がここを呼ぶ（確定事項17・20）。
  function paintPage(index) {
    const handle = viewer().getTextLayer(index);
    if (handle === null || handle === undefined)
      return false;

    const divs = handle.textDivs?.() ?? null;
    const items = handle.textItems?.() ?? null;
    if (!Array.isArray(divs) || !Array.isArray(items))
      return false;

    restorePainted(index, divs, items);

    const list = state.byPage.get(index) ?? [];
    if (list.length === 0)
      return true;

    // 同じ span に複数のヒットが落ちることがある。span ごとにまとめてから1度で
    // 組み替える。分けて当てると、後の当て込みが前を消す。
    const perDiv = new Map();
    for (const entry of list) {
      const count = entry.match.segments.length;
      for (let position = 0; position < count; position += 1) {
        const segment = entry.match.segments[position];
        const base = text().segmentClass(position, count);
        const className = entry.ordinal === state.current ? base + ' selected' : base;
        const pieces = perDiv.get(segment.index) ?? [];
        pieces.push({ from: segment.from, to: segment.to, className });
        perDiv.set(segment.index, pieces);
      }
    }

    for (const [divIndex, pieces] of perDiv) {
      const div = divs[divIndex];
      if (div !== undefined)
        rebuildDiv(div, items[divIndex] ?? '', pieces);
    }
    state.painted.set(index, [...perDiv.keys()]);
    return true;
  }

  // いま描いてあるページに当て直す。現在のヒットが移れば緑の位置も移るので、
  // 表示中のページはまとめて塗り直す。
  function repaint() {
    for (const index of viewer().getState().rendered)
      paintPage(index);
  }

  // ---- 移動 ----

  function scrollToSelected(index) {
    if (state.pendingReveal !== index)
      return false;
    const handle = viewer().getTextLayer(index);
    const node = handle?.node?.querySelector?.('.highlight.selected') ?? null;
    if (node === null || node === undefined)
      return false;
    state.pendingReveal = -1;
    // ページの先頭ではなくヒットの位置へ寄せる（確定事項18）。長いページで
    // 「飛んだのに見えない」を防ぐ。
    node.scrollIntoView?.({ block: 'center' });
    return true;
  }

  function reveal(ordinal) {
    const match = state.matches[ordinal];
    if (match === undefined)
      return false;
    state.pendingReveal = match.page;
    viewer().goToPage(match.page);
    return scrollToSelected(match.page);
  }

  // page-render.js がテキストレイヤーを貼り終えた合図。
  function onPageRendered(index) {
    const painted = paintPage(index);
    scrollToSelected(index);
    return painted;
  }

  // ---- 出し入れ ----

  // 検索バーを閉じたとき。ハイライトは消し、検索語は覚えたままにする（確定事項21）。
  function dismiss() {
    state.searchToken += 1;
    dropMatches();
    repaint();
    return notify();
  }

  // 文書が閉じた／別の文書へ移った。
  function clear() {
    state.textToken += 1;
    state.searchToken += 1;
    state.pending = null;
    state.pages = null;
    state.loading = false;
    state.term = '';
    state.matchCase = false;
    state.painted = new Map();
    dropMatches();
    root.SigK.findBar?.close({ silent: true });
    return true;
  }

  // 映すのをやめる直前に持ち出すもの。painted は DOM ごと捨てられるので持たない。
  function capture() {
    return {
      term: state.term,
      matchCase: state.matchCase,
      pages: state.pages,
      matches: state.matches,
      current: state.current,
      open: root.SigK.findBar?.isOpen() ?? false,
    };
  }

  function restore(session) {
    if (session === null || session === undefined)
      return false;
    state.term = typeof session.term === 'string' ? session.term : '';
    state.matchCase = session.matchCase === true;
    state.pages = session.pages ?? null;
    state.matches = Array.isArray(session.matches) ? session.matches : [];
    state.byPage = indexMatches(state.matches);
    state.current = Number.isInteger(session.current) ? session.current : -1;
    state.painted = new Map();
    state.pendingReveal = -1;
    if (session.open === true)
      root.SigK.findBar?.open({ restore: true });
    notify();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.find = {
    run,
    step,
    dismiss,
    clear,
    capture,
    restore,
    paintPage,
    repaint,
    onPageRendered,
    getState: view,
    getMatches: () => state.matches,
    getPages: () => state.pages,
  };
})(typeof window !== 'undefined' ? window : globalThis);
