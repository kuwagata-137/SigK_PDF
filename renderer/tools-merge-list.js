(function (root) {
  'use strict';

  // 結合画面の描画（spec-2-1 確定事項14・15・41・42）。
  //
  // 状態は tools-merge.js が持つ。ここは rows() を読んで DOM に写し、操作を
  // あちらの関数へ返すだけである。範囲欄の入力ごとに全体を描き直すとフォーカスが
  // 飛ぶので、行の見た目だけを直す syncRow を分けて持つ。
  //
  // 行のドラッグは row-drag.js が持つ（spec-3-1 確定事項36。変換の一覧と共用する）。
  // dropIndexFor・isDragging は結線して得た handle をそのまま素通しで公開する。

  let el = null;
  let dragHandle = null;

  const merge = () => root.SigK.toolsMerge;

  function icon(name, size = 14, stroke = 2) {
    return root.SigK.icons?.has(name) ? root.SigK.icons.create(el.doc, name, { size, strokeWidth: stroke }) : el.doc.createTextNode('');
  }

  function button(className, iconName, title, onClick) {
    const node = el.doc.createElement('button');
    node.type = 'button';
    node.className = className;
    node.title = title;
    node.setAttribute('aria-label', title);
    node.append(icon(iconName, iconName === 'close' ? 13 : 14));
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') !== 'true')
        onClick();
    });
    return node;
  }

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  function buildRow(row, index, count) {
    const node = el.doc.createElement('div');
    node.className = 'merge-row';
    node.dataset.id = row.id;
    node.title = row.path;

    const grip = el.doc.createElement('span');
    grip.className = 'grip';
    grip.append(icon('grip', 14, 1.75));

    const name = el.doc.createElement('span');
    name.className = 'name';
    name.textContent = row.name;

    const pages = el.doc.createElement('span');
    pages.className = 'pages';

    const range = el.doc.createElement('input');
    range.type = 'text';
    range.className = 'range';
    range.placeholder = '例: 1-3, 5, 8-';
    range.setAttribute('aria-label', `${row.name} のページ範囲`);
    range.value = row.range;
    range.addEventListener('input', () => merge().setRange(row.id, range.value));

    const up = button('rbtn', 'chevronUp', '上へ', () => merge().move(row.id, -1));
    const down = button('rbtn', 'chevronDown', '下へ', () => merge().move(row.id, 1));
    const off = button('rbtn danger', 'close', '外す', () => merge().remove(row.id));
    setDisabled(up, index === 0);
    setDisabled(down, index === count - 1);

    const note = el.doc.createElement('p');
    note.className = 'note';

    node.append(grip, name, pages, range, up, down, off, note);
    applyRowState(node, row);
    return node;
  }

  // 行の見た目を状態へ合わせる。ページ数・誤り・注意・使えない印。
  function applyRowState(node, row) {
    const pages = node.querySelector('.pages');
    const range = node.querySelector('.range');
    const note = node.querySelector('.note');
    pages.textContent = row.pending ? '…' : (row.pageCount ?? '–');
    range.disabled = row.blocked !== null || merge().isRunning();
    node.classList.toggle('invalid', row.error !== null);
    node.classList.toggle('blocked', row.blocked !== null);
    const text = row.blocked ?? row.error ?? row.note;
    note.textContent = text ?? '';
    note.hidden = text === null || text === undefined;
    note.classList.toggle('error', row.blocked !== null || row.error !== null);
    for (const control of node.querySelectorAll('.rbtn'))
      if (merge().isRunning())
        control.setAttribute('aria-disabled', 'true');
  }

  function syncRow(id) {
    if (el === null)
      return false;
    const row = merge().find(id);
    const node = el.list.querySelector(`.merge-row[data-id="${id}"]`);
    if (row === null || node === null)
      return false;
    applyRowState(node, row);
    syncFooter();
    return true;
  }

  function syncFooter() {
    const rows = merge().rows();
    const pages = merge().outputPages();
    el.summary.textContent = rows.length === 0
      ? ''
      : `${rows.length} ファイル ・ 出力は ${pages} ページ`;
    setDisabled(el.run, !merge().canRun());
    const running = merge().isRunning();
    for (const control of [el.addOpen, el.pick, el.clear])
      setDisabled(control, running);
  }

  function render() {
    if (el === null)
      return false;
    const rows = merge().rows();
    for (const node of el.list.querySelectorAll('.merge-row'))
      node.remove();
    el.empty.hidden = rows.length > 0;
    rows.forEach((row, index) => el.list.append(buildRow(row, index, rows.length)));
    syncFooter();
    return true;
  }

  function init(doc, win) {
    if (win.__sigkToolsMergeListReady === true)
      return false;
    const list = doc.getElementById('merge-list');
    if (list === null)
      return false;
    win.__sigkToolsMergeListReady = true;

    el = {
      doc,
      win,
      list,
      empty: doc.getElementById('merge-empty'),
      summary: doc.getElementById('merge-summary'),
      run: doc.getElementById('merge-run'),
      addOpen: doc.getElementById('merge-add-open'),
      pick: doc.getElementById('merge-pick'),
      clear: doc.getElementById('merge-clear'),
    };

    el.addOpen.addEventListener('click', () => { if (el.addOpen.getAttribute('aria-disabled') !== 'true') merge().addOpenTabs(); });
    el.pick.addEventListener('click', () => { if (el.pick.getAttribute('aria-disabled') !== 'true') merge().pickFiles(); });
    el.clear.addEventListener('click', () => { if (el.clear.getAttribute('aria-disabled') !== 'true') merge().clear(); });
    el.run.addEventListener('click', () => { if (el.run.getAttribute('aria-disabled') !== 'true') merge().run(); });

    dragHandle = root.SigK.rowDrag.attachRowDrag({
      doc,
      list,
      rowSelector: '.merge-row',
      onDrop: (id, at) => merge().moveTo(id, at),
      isLocked: () => merge().isRunning(),
    });

    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsMergeList = {
    init,
    render,
    syncRow,
    dropIndexFor: (y) => dragHandle?.dropIndexFor(y) ?? 0,
    isDragging: () => dragHandle?.isDragging() ?? false,
  };
})(typeof window !== 'undefined' ? window : globalThis);
