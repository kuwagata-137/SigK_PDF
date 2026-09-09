(function (root) {
  'use strict';

  // 画像→PDF の一覧の描画（spec-3-1 確定事項3・5・20・33）。
  //
  // 状態は tools-convert.js が持つ。ここは rows() を読んで DOM に写し、操作を
  // あちらの関数へ返すだけである（結合の tools-merge-list.js と同じ役割）。
  // 行のドラッグは row-drag.js に任せる（確定事項36）。
  //
  // 列は グリップ／ファイル名／画素数／形式／この紙／上へ・下へ・外す／注意 の
  // 7列＋注意行。「この紙」は用紙の設定から計画を引いて出すので、設定を変えると
  // 行の表示も変わる（確定事項21 の「出力の例」と同じ理屈）。

  let el = null;
  let dragHandle = null;

  const convert = () => root.SigK.toolsConvert;
  const plan = () => root.SigK.convertPlan;

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

  // 出力名が重なる行の集合。「画像ごと」のときだけ赤く示す（確定事項20）。
  function duplicateIds() {
    const rows = convert().rows();
    if (convert().settings().output !== 'each')
      return new Set();
    const names = plan().outputNames(rows);
    const dupes = new Set(plan().duplicateNames(names).map((name) => name.toLowerCase()));
    if (dupes.size === 0)
      return new Set();
    // duplicateNames が返すのは2回目以降だけなので、同じ名前の行をすべて拾い直す。
    return new Set(rows.filter((row, index) => dupes.has(names[index].toLowerCase())).map((row) => row.id));
  }

  function buildRow(row, index, count) {
    const node = el.doc.createElement('div');
    node.className = 'convert-row';
    node.dataset.id = row.id;
    node.title = row.path;

    const grip = el.doc.createElement('span');
    grip.className = 'grip';
    grip.append(icon('grip', 14, 1.75));

    const name = el.doc.createElement('span');
    name.className = 'name';
    name.textContent = row.name;

    const px = el.doc.createElement('span');
    px.className = 'px';

    const kind = el.doc.createElement('span');
    kind.className = 'kind';

    const paper = el.doc.createElement('span');
    paper.className = 'paper';

    const up = button('rbtn', 'chevronUp', '上へ', () => convert().move(row.id, -1));
    const down = button('rbtn', 'chevronDown', '下へ', () => convert().move(row.id, 1));
    const off = button('rbtn danger', 'close', '外す', () => convert().remove(row.id));
    setDisabled(up, index === 0);
    setDisabled(down, index === count - 1);

    const note = el.doc.createElement('p');
    note.className = 'note';

    node.append(grip, name, px, kind, paper, up, down, off, note);
    applyRowState(node, row);
    return node;
  }

  // 行の見た目を状態へ合わせる。画素数・形式・この紙・使えない印・出力名の衝突。
  function applyRowState(node, row, dupes = duplicateIds()) {
    const px = node.querySelector('.px');
    const kind = node.querySelector('.kind');
    const paper = node.querySelector('.paper');
    const note = node.querySelector('.note');

    px.textContent = row.pending ? '…' : (row.width === null ? '–' : `${row.width}×${row.height}`);
    kind.textContent = row.pending || row.kind === null ? '' : String(row.kind).toUpperCase();

    const settings = convert().settings();
    const planned = row.width === null ? null : plan().planPage({ width: row.width, height: row.height }, settings);
    paper.textContent = planned === null || planned.error !== undefined ? '' : plan().describePage(planned, settings.paper);

    const duplicated = dupes.has(row.id);
    node.classList.toggle('blocked', row.blocked !== null);
    node.classList.toggle('dup', duplicated);

    const text = row.blocked ?? (duplicated ? '出力名がほかの行と重なります' : (planned?.error ?? null));
    note.textContent = text ?? '';
    note.hidden = text === null || text === undefined;
    note.classList.toggle('error', row.blocked !== null || duplicated);

    for (const control of node.querySelectorAll('.rbtn'))
      if (convert().isRunning())
        control.setAttribute('aria-disabled', 'true');
  }

  function syncRow(id) {
    if (el === null)
      return false;
    const row = convert().find(id);
    const node = el.list.querySelector(`.convert-row[data-id="${id}"]`);
    if (row === null || node === null)
      return false;
    applyRowState(node, row);
    syncFooter();
    return true;
  }

  function syncFooter() {
    const rows = convert().rows();
    const blocked = rows.filter((row) => row.blocked !== null).length;
    el.summary.textContent = rows.length === 0
      ? ''
      : `${rows.length} ファイル${blocked > 0 ? ` ・ ${blocked} 件は変換できません` : ''}`;
    setDisabled(el.run, !convert().canRun());
    const running = convert().isRunning();
    for (const control of [el.pick, el.clear])
      setDisabled(control, running);
  }

  function render() {
    if (el === null)
      return false;
    const rows = convert().rows();
    const dupes = duplicateIds();
    for (const node of el.list.querySelectorAll('.convert-row'))
      node.remove();
    el.empty.hidden = rows.length > 0;
    rows.forEach((row, index) => {
      const node = buildRow(row, index, rows.length);
      applyRowState(node, row, dupes);
      el.list.append(node);
    });
    syncFooter();
    return true;
  }

  function init(doc, win) {
    if (win.__sigkToolsConvertListReady === true)
      return false;
    const list = doc.getElementById('convert-list');
    if (list === null)
      return false;
    win.__sigkToolsConvertListReady = true;

    el = {
      doc,
      win,
      list,
      empty: doc.getElementById('convert-empty'),
      summary: doc.getElementById('convert-summary'),
      run: doc.getElementById('convert-run'),
      pick: doc.getElementById('convert-pick'),
      clear: doc.getElementById('convert-clear'),
    };

    el.pick.addEventListener('click', () => { if (el.pick.getAttribute('aria-disabled') !== 'true') convert().pickFiles(); });
    el.clear.addEventListener('click', () => { if (el.clear.getAttribute('aria-disabled') !== 'true') convert().clear(); });
    el.run.addEventListener('click', () => { if (el.run.getAttribute('aria-disabled') !== 'true') convert().run(); });

    dragHandle = root.SigK.rowDrag.attachRowDrag({
      doc,
      list,
      rowSelector: '.convert-row',
      onDrop: (id, at) => convert().moveTo(id, at),
      isLocked: () => convert().isRunning(),
    });

    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsConvertList = {
    init,
    render,
    syncRow,
    dropIndexFor: (y) => dragHandle?.dropIndexFor(y) ?? 0,
    isDragging: () => dragHandle?.isDragging() ?? false,
  };
})(typeof window !== 'undefined' ? window : globalThis);
