(function (root) {
  'use strict';

  // 右の欄の結合の節（spec-2-5 確定事項E1・E2。見本 screenshots/strips2-merge.png）。状態は tools-merge.js が持ち、ここは rows() を
  // 「まとめるファイル」のカードに写して、チェックと範囲の欄の操作をあちらへ返すだけ。
  //
  // 行は帯の順で、チェックボックス・帯の番号・名前・ページ数・範囲の欄（空欄＝すべて）。チェックを外した行は範囲の欄を灰色にして打てなくし、
  // 使えない帯（開けなかった・パスワード付き）は理由を赤で出す。行は帯の id で突き合わせ、フォーカスのある範囲の欄には書き戻さない
  // （打っている途中の文字とカーソルを動かさない）。

  let el = null;

  const merge = () => root.SigK.toolsMerge;

  function make(tag, className, text = '') {
    const node = el.doc.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function buildRow(tabId) {
    const node = make('div', 'pane-row merge-pick');
    node.dataset.tabId = String(tabId);
    const box = el.doc.createElement('input');
    box.type = 'checkbox';
    box.className = 'cbox';
    const range = el.doc.createElement('input');
    range.type = 'text';
    range.className = 'rng';
    range.placeholder = '範囲（空欄＝すべて）';
    range.autocomplete = 'off';
    range.spellcheck = false;
    node.append(box, make('span', 'strip-no'), make('span', 'fname'), make('span', 'p'), range, make('span', 'rng note'), make('p', 'err'));
    return node;
  }

  function applyRow(node, row, running) {
    const [box, no, name, pages, range, note, err] = node.children;
    node.classList.toggle('off', !row.checked);
    node.classList.toggle('blocked', row.blocked !== null);
    box.checked = row.checked;
    box.disabled = row.blocked !== null || running;
    box.setAttribute('aria-label', `「${row.name}」を結合に入れる`);
    no.textContent = String(row.no);
    name.textContent = row.name;
    // 説明の吹き出しはファイル名にだけ付ける（行に付けると、範囲の欄の上でも出てしまう。J17）。（ファイル名, フルパス）で、
    // 名前の無い帯（新しい帯）は帯の見出しと同じ説明（spec-2-5 J5）。
    root.SigK.tipContent.text(name, row.name, typeof row.path === 'string' ? row.path : root.SigK.stripRow.UNTITLED_DESC);
    pages.textContent = row.pageCount === null ? '' : `${row.pageCount} p`;
    range.hidden = row.blocked !== null;
    range.disabled = !row.checked || running;
    range.setAttribute('aria-label', `${row.name} のページ範囲`);
    range.classList.toggle('invalid', row.error !== null);
    if (el.doc.activeElement !== range && range.value !== row.range)
      range.value = row.range;
    note.hidden = row.blocked === null;
    note.textContent = row.blocked ?? '';
    err.hidden = row.error === null;
    err.textContent = row.error ?? '';
  }

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  function render() {
    if (el === null)
      return false;
    const rows = merge().rows();
    const running = merge().isRunning();
    const nodes = new Map([...el.list.children].map((node) => [Number(node.dataset.tabId), node]));
    const kept = rows.map((row) => {
      const node = nodes.get(row.tabId) ?? buildRow(row.tabId);
      applyRow(node, row, running);
      return node;
    });
    for (const [tabId, node] of nodes) {
      if (!rows.some((row) => row.tabId === tabId))
        node.remove();
    }
    if (kept.some((node, index) => el.list.children[index] !== node))
      el.list.append(...kept);
    const chosen = rows.filter((row) => row.checked);
    el.count.textContent = `${chosen.length} / ${rows.length}`;
    el.empty.hidden = rows.length > 0;
    el.note.hidden = !merge().showsNote();
    el.note.textContent = merge().NOTE_NAME_ORDER;
    el.summary.textContent = chosen.length === 0 ? '' : `${chosen.length} 個のファイル・合計 ${merge().outputPages(chosen)} ページ`;
    setDisabled(el.run, !merge().canRun());
    return true;
  }

  function onChange(event) {
    const node = event.target.closest('.merge-pick');
    if (node !== null && event.target.classList.contains('cbox'))
      merge().setChecked(Number(node.dataset.tabId), event.target.checked);
  }

  function onInput(event) {
    const node = event.target.closest('.merge-pick');
    if (node !== null && event.target.classList.contains('rng'))
      merge().setRange(Number(node.dataset.tabId), event.target.value);
  }

  function init(doc, win) {
    if (win.__sigkToolsMergeListReady === true)
      return false;
    const list = doc.getElementById('merge-list');
    if (list === null)
      return false;
    win.__sigkToolsMergeListReady = true;
    el = {
      doc, list,
      count: doc.getElementById('merge-count'),
      empty: doc.getElementById('merge-empty'),
      note: doc.getElementById('merge-note'),
      summary: doc.getElementById('merge-summary'),
      run: doc.getElementById('merge-run'),
    };
    list.addEventListener('change', onChange);
    list.addEventListener('input', onInput);
    el.run.addEventListener('click', () => {
      if (el.run.getAttribute('aria-disabled') !== 'true')
        merge().run();
    });
    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsMergeList = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
