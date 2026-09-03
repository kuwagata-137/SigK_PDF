(function (root) {
  'use strict';

  // 結合画面の描画と行のドラッグ（spec-2-1 確定事項14・15・41・42）。
  //
  // 状態は tools-merge.js が持つ。ここは rows() を読んで DOM に写し、操作を
  // あちらの関数へ返すだけである。範囲欄の入力ごとに全体を描き直すとフォーカスが
  // 飛ぶので、行の見た目だけを直す syncRow を分けて持つ。
  //
  // ドラッグは page-grid.js と同じくポインタイベントで組む（HTML5 の draggable は
  // jsdom に載らない）。落とす位置は、行の中心より上か下かで決める。

  const DRAG_THRESHOLD = 4;

  let el = null;
  const drag = { pending: false, active: false, id: null, at: null, startY: 0, line: null };

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

  // ---- ドラッグ（確定事項15） ----

  function rowNodes() {
    return [...el.list.querySelectorAll('.merge-row')];
  }

  function dropIndexFor(y) {
    const nodes = rowNodes();
    let at = 0;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (y >= rect.top + rect.height / 2)
        at += 1;
    }
    return Math.min(at, nodes.length);
  }

  function showLine(at) {
    if (drag.line === null) {
      drag.line = el.doc.createElement('div');
      drag.line.className = 'drop-line';
      el.list.append(drag.line);
    }
    const nodes = rowNodes();
    const anchor = nodes[Math.min(at, nodes.length - 1)];
    if (anchor === undefined)
      return;
    const top = at >= nodes.length ? anchor.offsetTop + anchor.offsetHeight : anchor.offsetTop;
    drag.line.style.left = '6px';
    drag.line.style.right = '6px';
    drag.line.style.height = '2px';
    drag.line.style.top = `${top - 1}px`;
  }

  function endDrag() {
    const node = drag.id === null ? null : el.list.querySelector(`.merge-row[data-id="${drag.id}"]`);
    node?.classList.remove('dragging');
    drag.line?.remove();
    drag.line = null;
    drag.pending = false;
    drag.active = false;
    drag.id = null;
    drag.at = null;
  }

  function onPointerDown(event) {
    if (event.button !== 0 || merge().isRunning())
      return;
    if (event.target?.closest?.('input, button') !== null && event.target?.closest?.('input, button') !== undefined)
      return;
    const node = event.target?.closest?.('.merge-row');
    if (node === null || node === undefined)
      return;
    drag.pending = true;
    drag.id = node.dataset.id;
    drag.startY = event.clientY;
  }

  function onPointerMove(event) {
    if (!drag.pending)
      return;
    if (!drag.active) {
      if (Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD)
        return;
      drag.active = true;
      el.list.querySelector(`.merge-row[data-id="${drag.id}"]`)?.classList.add('dragging');
    }
    drag.at = dropIndexFor(event.clientY);
    showLine(drag.at);
  }

  function onPointerUp(event) {
    if (!drag.active) {
      drag.pending = false;
      drag.id = null;
      return;
    }
    const inside = el.list.contains(event.target);
    const { id, at } = drag;
    endDrag();
    if (inside && at !== null)
      merge().moveTo(id, at);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && (drag.active || drag.pending)) {
      event.preventDefault();
      endDrag();
    }
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

    list.addEventListener('pointerdown', onPointerDown);
    doc.addEventListener('pointermove', onPointerMove);
    doc.addEventListener('pointerup', onPointerUp);
    doc.addEventListener('keydown', onKeyDown);

    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsMergeList = { init, render, syncRow, dropIndexFor, isDragging: () => drag.active };
})(typeof window !== 'undefined' ? window : globalThis);
