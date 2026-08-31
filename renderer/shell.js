(function (root) {
  'use strict';

  // 画面の枠組みの状態を持つ層。PDF の中身には触らない。

  const MODES = ['view', 'pages', 'annot', 'tools'];
  const MODE_TITLES = { view: 'サムネイル', pages: 'ページ', annot: '注釈', tools: 'ツール' };
  const SIDE_PANEL_MIN = 180;
  const SIDE_PANEL_MAX = 420;

  function isValidMode(mode) {
    return MODES.includes(mode);
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

    for (const item of doc.querySelectorAll('.rail-item'))
      item.classList.toggle('active', item.dataset.mode === mode);

    const title = doc.getElementById('side-title');
    if (title !== null)
      title.textContent = MODE_TITLES[mode];

    // ページの並べ替えなどの操作は、ページモードのときだけ出す。
    const actions = doc.getElementById('side-actions');
    if (actions !== null)
      actions.hidden = mode !== 'pages';

    return true;
  }

  function setSidePanelOpen(doc, open) {
    doc.documentElement.setAttribute('data-panel', open ? 'open' : 'collapsed');
    return open;
  }

  function setSidePanelWidth(doc, px) {
    const width = clampSidePanelWidth(px);
    doc.documentElement.style.setProperty('--side-width', `${width}px`);
    return width;
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

  function init(doc, { mode = 'view', panelOpen = true, sidePanelWidth = 240 } = {}) {
    if (doc.documentElement.dataset.shellReady === 'true')
      return false;
    doc.documentElement.dataset.shellReady = 'true';

    setMode(doc, mode);
    setSidePanelOpen(doc, panelOpen);
    setSidePanelWidth(doc, sidePanelWidth);

    for (const item of doc.querySelectorAll('.rail-item'))
      item.addEventListener('click', () => setMode(doc, item.dataset.mode));

    const collapse = doc.getElementById('side-collapse');
    if (collapse !== null) {
      collapse.addEventListener('click', () => {
        const open = doc.documentElement.getAttribute('data-panel') === 'open';
        setSidePanelOpen(doc, !open);
      });
    }

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
      dragging = false;
    });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shell = {
    MODES,
    MODE_TITLES,
    SIDE_PANEL_MIN,
    SIDE_PANEL_MAX,
    isValidMode,
    clampSidePanelWidth,
    setMode,
    setSidePanelOpen,
    setSidePanelWidth,
    setStatus,
    init,
  };
})(typeof window !== 'undefined' ? window : globalThis);
