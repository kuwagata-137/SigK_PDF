(function (root) {
  'use strict';

  // 画面の枠組みの状態を持つ層。PDF の中身には触らない。

  const MODES = ['view', 'pages', 'annot', 'tools'];
  // サイドパネルの見出し。編集モード（annot）は見出しの文字を隠し、「サムネイル」「注釈一覧」の切り替えを出す
  // （spec-4b-1a 確定事項15。spec-4-4 確定事項9 の「注釈モードは一覧」を改めた）。
  const MODE_TITLES = { view: 'サムネイル', pages: 'ページ', annot: '', tools: 'ツール' };
  // 編集モードの左に出すもの（spec-4b-1a 確定事項16・17）。settings.js の EDIT_SIDES と同じ並びであること。
  const EDIT_SIDES = ['thumbs', 'list'];
  // ページの並べ方（spec-2-3 確定事項3・5）。settings.js の PAGE_LAYOUTS と同じ
  // 並びであること。プロセスが違うので import はできない。test/shell.test.js が見張る。
  const PAGE_LAYOUTS = ['single', 'facing'];
  const SIDE_PANEL_MIN = 180;
  const SIDE_PANEL_MAX = 420;

  // 編集モードの左に出しているもの。
  let editSide = 'thumbs';
  // いま当てている幅。ドラッグが終わった時点で覚えるのに使う。
  let sidePanelWidth = 240;
  // 保存してある値を当てている最中は書き戻さない。起動のたびに
  // settings.json を触ることになるため。
  let restoring = false;

  function isValidMode(mode) {
    return MODES.includes(mode);
  }

  // 見た目の変更を覚える（spec-1-3 確定事項31〜35）。fs に触るのはメイン
  // だけなので、IPC へ投げて結果は待たない。失敗しても画面は動いてよい。
  function persist(patch) {
    if (restoring)
      return false;
    const api = root.settingsAPI;
    if (!api || api.available !== true)
      return false;
    api.setUi(patch)?.catch?.(() => {});
    return true;
  }

  // 編集モードの左の切り替え（spec-4b-1a 確定事項15〜18）。既定はサムネイルで、選んだ側を覚える。
  // 出し入れは html の data-edit-side と CSS、中身はサムネイルと一覧がそれぞれ見て描き直す。
  function setEditSide(doc, side) {
    if (!EDIT_SIDES.includes(side))
      return false;
    editSide = side;
    doc.documentElement.setAttribute('data-edit-side', side);
    for (const button of doc.querySelectorAll('#side-switch button[data-side]')) {
      const on = button.dataset.side === side;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    root.SigK.thumbnails?.refresh();
    root.SigK.annotationList?.refresh();
    persist({ editSide: side });
    return true;
  }

  function clampSidePanelWidth(px) {
    if (!Number.isFinite(px))
      return 240;
    return Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, Math.round(px)));
  }

  function setMode(doc, mode) {
    if (!isValidMode(mode))
      return false;

    doc.documentElement.setAttribute('data-mode', mode);

    for (const item of doc.querySelectorAll('.rail-item[data-mode]'))
      item.classList.toggle('active', item.dataset.mode === mode);

    const title = doc.getElementById('side-title');
    if (title !== null)
      title.textContent = MODE_TITLES[mode];

    // ページの並べ替えなどの操作は、ページモードのときだけ出す。
    const actions = doc.getElementById('side-actions');
    if (actions !== null)
      actions.hidden = mode !== 'pages';

    // サムネイルは閲覧モードのときだけ出す（spec-1-3 確定事項1）。
    // ほかのモードでは従来のプレースホルダーへ戻す。
    root.SigK.thumbnails?.refresh();

    // ツールモードでは、ツール一覧と作業画面を出す（spec-2-1 確定事項1・2）。
    // ページビューは隠すだけで捨てない。
    root.SigK.tools?.refresh();

    // パスワード付きの文書は編集できるが保存できない（spec-1-6 確定事項70）。
    // 並べ替えたあとで初めて知るのでは遅いので、入った時点で伝えておく。
    if (mode === 'pages')
      root.SigK.save?.warnIfUnsaveable();

    // 注釈モードを離れたら注釈の選択を解除する。入ったら同じ帯を出す（spec-4-1 確定事項8・9）。
    root.SigK.annotate?.onModeChanged(mode);

    // 編集モードの道具の段と右パネルの出し入れで表示域が変わる。「幅」「全体」で追従していれば倍率を計算し直す
    // （spec-4b-1a 確定事項19。今までは右パネルの 260px ぶん紙がはみ出たままになっていた）。
    root.SigK.viewer?.refit();

    persist({ mode });
    return true;
  }

  // サイドパネルの開閉と幅はページビューの幅を変える。「幅に合わせる」で
  // 表示しているときは倍率を計算し直さないと、紙がはみ出したまま残る。
  //
  // サムネイルも同じ合図で追従する。紙の幅はパネルの実幅から決まるので、
  // 幅が変われば作り直しが要る（spec-1-3 確定事項15）。畳んだときに捨てるのも
  // ここを通る（確定事項14）。
  function notifyViewportChanged() {
    root.SigK.viewer?.refit();
    root.SigK.thumbnails?.refresh();
  }

  // 閉じている間だけ、開き直す「＞」の細い帯を出す（2026-10-08 の直し）。閉じる「＜」はパネルと一緒に消えるため。
  function setSidePanelOpen(doc, open) {
    doc.documentElement.setAttribute('data-panel', open ? 'open' : 'collapsed');
    const strip = doc.getElementById('side-strip');
    if (strip !== null)
      strip.hidden = open;
    notifyViewportChanged();
    persist({ sidePanel: { open } });
    return open;
  }

  // 幅はここでは覚えない。ドラッグ中に毎回呼ばれるためである。覚えるのは
  // つまみを離した時点で1回だけ（spec-1-3 確定事項34。settings.js は一時
  // ファイル＋rename のアトミック書き込みで、毎フレーム呼ぶとディスクを叩き続ける）。
  function setSidePanelWidth(doc, px) {
    const width = clampSidePanelWidth(px);
    sidePanelWidth = width;
    doc.documentElement.style.setProperty('--side-width', `${width}px`);
    notifyViewportChanged();
    return width;
  }

  // 単ページ／見開きの切り替え（spec-2-3 確定事項3）。状態の持ち主はここで、
  // 配置はビューアに任せる。アプリ全体の設定なので、文書が無くても当たる
  // （起動時の復元がそれである）。
  function setPageLayout(doc, layout) {
    if (!PAGE_LAYOUTS.includes(layout))
      return false;
    doc.documentElement.setAttribute('data-layout', layout);
    root.SigK.viewer?.setFacing(layout === 'facing');
    persist({ pageLayout: layout });
    return true;
  }

  // 保存してあった見た目を当てる。当てる操作そのものは覚え直さない。
  function applyUi(doc, { mode, panelOpen, sidePanelWidth: width, pageLayout, editSide: side } = {}) {
    restoring = true;
    try {
      if (EDIT_SIDES.includes(side))
        setEditSide(doc, side);
      if (isValidMode(mode))
        setMode(doc, mode);
      if (typeof panelOpen === 'boolean')
        setSidePanelOpen(doc, panelOpen);
      if (Number.isFinite(width))
        setSidePanelWidth(doc, width);
      if (PAGE_LAYOUTS.includes(pageLayout))
        setPageLayout(doc, pageLayout);
    } finally {
      restoring = false;
    }
    return true;
  }

  // ステータスバーに出すファイルサイズ。1KB = 1024 で数え、小数は1桁までにする。
  function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0)
      return '–';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
    return `${rounded} ${units[unit]}`;
  }

  function setStatus(doc, status = {}) {
    const set = (id, text) => {
      const el = doc.getElementById(id);
      if (el !== null && text !== undefined)
        el.textContent = text;
    };
    set('status-file', status.file);
    set('status-pages', status.pages);
    set('status-size', status.size);
    set('status-version', status.version);
  }

  function init(doc, ui = {}) {
    if (doc.documentElement.dataset.shellReady === 'true')
      return false;
    doc.documentElement.dataset.shellReady = 'true';

    // 編集モードの左は、覚えた値が届くまでサムネイル（spec-4b-1a 確定事項17）。
    applyUi(doc, { mode: 'view', panelOpen: true, sidePanelWidth: 240, pageLayout: 'single', ...ui, editSide: ui.editSide ?? 'thumbs' });

    for (const item of doc.querySelectorAll('.rail-item[data-mode]'))
      item.addEventListener('click', () => setMode(doc, item.dataset.mode));
    for (const button of doc.querySelectorAll('#side-switch button[data-side]'))
      button.addEventListener('click', () => setEditSide(doc, button.dataset.side));

    const collapse = doc.getElementById('side-collapse');
    if (collapse !== null) {
      collapse.addEventListener('click', () => {
        const open = doc.documentElement.getAttribute('data-panel') === 'open';
        setSidePanelOpen(doc, !open);
      });
    }
    // キーボードで「＞」を押した（click の detail が 0）ときは、パネルの中へフォーカスを移す。「＞」は帯と一緒に隠れ、閉じる「＜」は
    // フォーカスを受けないので、行き場が無くなるため（spec-4b-7b 点検の直し）。
    doc.getElementById('side-expand')?.addEventListener('click', (event) => {
      setSidePanelOpen(doc, true);
      if (event.detail === 0)
        doc.getElementById('side-scroll')?.focus({ preventScroll: true });
    });

    installResizer(doc);
    return true;
  }

  function installResizer(doc) {
    const resizer = doc.getElementById('side-resizer');
    const side = doc.getElementById('side');
    if (resizer === null || side === null)
      return;

    let dragging = false;

    resizer.addEventListener('mousedown', (event) => {
      dragging = true;
      event.preventDefault();
    });
    doc.addEventListener('mousemove', (event) => {
      if (!dragging)
        return;
      setSidePanelWidth(doc, event.clientX - side.getBoundingClientRect().left);
    });
    doc.addEventListener('mouseup', () => {
      if (!dragging)
        return;
      dragging = false;
      persist({ sidePanel: { width: sidePanelWidth } });
    });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shell = {
    MODES,
    MODE_TITLES,
    EDIT_SIDES,
    PAGE_LAYOUTS,
    SIDE_PANEL_MIN,
    SIDE_PANEL_MAX,
    isValidMode,
    clampSidePanelWidth,
    formatFileSize,
    setMode,
    setSidePanelOpen,
    setSidePanelWidth,
    setPageLayout,
    setEditSide,
    getEditSide: () => editSide,
    persist,
    applyUi,
    setStatus,
    init,
  };
})(typeof window !== 'undefined' ? window : globalThis);
