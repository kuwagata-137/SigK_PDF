(function (root) {
  'use strict';

  // 印刷画面の設定と、印刷の指定への組み立て（docs/spec-7-7-print-dialog.md 確定事項C3・C4）。DOM に触らない。
  //
  // 選んだ設定は SigK PDF を閉じるまで覚える。印刷するページは毎回「すべて」、部数は毎回 1、注釈の一覧(T) は毎回なしに戻す。
  // グレースケールと両面の null は「プリンターの既定に従う」（プリンターを選ぶたびに、取得した既定の値を入れる）。

  const HANDLINGS = Object.freeze(['size', 'poster', 'multiple', 'booklet']);
  const PER_SHEET = Object.freeze([2, 4, 6, 9, 16, 'custom']);

  function defaults() {
    return {
      printer: null,
      copies: 1,
      grayscale: null,
      inkSave: false,
      range: 'all',
      text: '',
      moreOpen: false,
      parity: 'all',
      reverse: false,
      handling: 'size',
      size: { fit: 'fit', scale: 100, choosePaper: false },
      poster: { scale: 100, overlap: 0, tileMarks: false, labels: false, largeOnly: false },
      multiple: { perSheet: 2, cols: 2, rows: 1, order: 'horizontal', border: false },
      booklet: { method: 'both', from: 1, to: null, binding: 'left' },
      duplex: null,
      flip: 'longEdge',
      orientation: 'auto',
      autoRotate: false,
      comments: 'markups',
      summary: false,
      paperId: null,
    };
  }

  // 印刷画面を開く時の設定。覚えた設定のうち、毎回戻すものだけを戻す。
  function forOpen(remembered) {
    const base = remembered ?? defaults();
    return { ...base, range: 'all', text: '', copies: 1, summary: false, booklet: { ...base.booklet, from: 1, to: null } };
  }

  // プリンターを替えた時: ページ設定の用紙と、プリンターの既定に従う値を戻す。
  function forPrinter(state, name) {
    return { ...state, printer: name, paperId: null, grayscale: null, duplex: null };
  }

  function paperFor(state, config) {
    const chosen = state.paperId === null ? null : (config.paperSizes ?? []).find((paper) => paper.id === state.paperId) ?? null;
    if (chosen === null)
      return { paper: config.paper, imageable: config.imageable };
    return { paper: chosen, imageable: root.SigK.printSheetGeometry.imageableFor(chosen, config.paper, config.imageable) };
  }

  function grayscaleOf(state, config) {
    return state.grayscale ?? (config?.color?.value === false);
  }

  function duplexOf(state, config) {
    if (config?.duplex?.supported === false)
      return false;
    return state.duplex ?? (config?.duplex?.mode !== undefined && config.duplex.mode !== 'simplex');
  }

  // 複数・小冊子・ポスターの向きは縦か横だけ（自動は縦にする）。
  function orientationOf(state) {
    if (state.handling === 'size')
      return state.orientation;
    return state.orientation === 'landscape' ? 'landscape' : 'portrait';
  }

  function layoutOf(state) {
    return {
      mode: state.handling,
      size: { ...state.size },
      poster: { ...state.poster },
      multiple: { ...state.multiple },
      booklet: { ...state.booklet, to: state.booklet.to ?? undefined },
      orientation: orientationOf(state),
      autoRotate: state.handling !== 'size' && state.autoRotate === true,
    };
  }

  // 印刷するページ。小冊子では、偶数または奇数ページと逆順に印刷を使わない（spec-7-7「配置の計算」）。
  function pagesOf(state, { pageCount, current }) {
    const booklet = state.handling === 'booklet';
    return root.SigK.printPages.resolvePages({
      mode: state.range,
      text: state.text,
      pageCount,
      current,
      parity: booklet ? 'all' : state.parity,
      reverse: booklet ? false : state.reverse,
    });
  }

  // 印刷の指定（print-job.js の planFor・buildImages と print-send.js の send に渡すもの）。
  function toJob(state, { config, pageCount, current }) {
    const resolved = pagesOf(state, { pageCount, current });
    if (resolved.error !== undefined)
      return { error: resolved.error };
    const { paper, imageable } = paperFor(state, config);
    return {
      pages: resolved.pages,
      visibleOnly: state.range === 'view',
      summary: state.summary === true,
      layout: layoutOf(state),
      paper,
      imageable,
      paperSizes: config.paperSizes ?? [],
      grayscale: grayscaleOf(state, config),
      inkSave: state.inkSave === true,
      annotations: state.comments,
      send: {
        deviceName: state.printer,
        copies: state.copies,
        collate: config.collate !== false,
        color: !grayscaleOf(state, config),
        duplexMode: duplexOf(state, config) ? state.flip : 'simplex',
        defaultPaper: config.paper,
      },
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printSettings = { HANDLINGS, PER_SHEET, defaults, forOpen, forPrinter, paperFor, grayscaleOf, duplexOf, orientationOf, layoutOf, pagesOf, toJob };
})(typeof window !== 'undefined' ? window : globalThis);
