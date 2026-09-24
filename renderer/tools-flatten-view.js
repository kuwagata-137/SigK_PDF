(function (root) {
  'use strict';

  // フラット化の画面の描画と結線（spec-4-5 確定事項7〜9）。状態は tools-flatten.js が持つ。
  //
  // 「焼き込む注釈」の節に、まとまりごとの件数と合計、焼き込まずに残すもの、失うもの（ノートの本文と
  // 作成者）を出す。0 件のまとまりと文は出さない。

  // まとまり（worker/flatten-selection.js の group）の並び・名前・アイコン（モックの色）。
  const GROUPS = Object.freeze([
    { key: 'markup', label: 'ハイライト・下線・取り消し線', icon: 'highlight' },
    { key: 'text', label: 'テキスト', icon: 'text' },
    { key: 'shape', label: '図形・ペン', icon: 'shape' },
    { key: 'note', label: 'ノート', icon: 'note' },
    { key: 'other', label: 'スタンプなど', icon: 'modeAnnot' },
  ]);

  let el = null;

  const tool = () => root.SigK.toolsFlatten;

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  function span(className, text) {
    const node = el.doc.createElement('span');
    if (className !== '')
      node.className = className;
    node.textContent = text;
    return node;
  }

  function renderList(result) {
    el.list.replaceChildren();
    for (const group of GROUPS) {
      const count = result.bake[group.key];
      if (!(count > 0))
        continue;
      const icon = span(`ic ${group.key}`, '');
      if (root.SigK.icons?.has(group.icon))
        icon.append(root.SigK.icons.create(el.doc, group.icon, { size: 16 }));
      const row = el.doc.createElement('div');
      row.className = 'fl-row';
      row.dataset.group = group.key;
      row.append(icon, span('', group.label), span('n', `${count} 件`));
      el.list.append(row);
    }
    const total = el.doc.createElement('div');
    total.className = 'total';
    total.append(span('', '合計'), span('', `${result.baked} 件`));
    el.list.append(total);
  }

  // 焼き込まずに残すもの（確定事項8）。0 件の文は出さない。
  function keepText(keep) {
    const lines = [];
    if (keep.functional > 0)
      lines.push(`リンク・フォームの欄など ${keep.functional} 件はそのまま残します。`);
    if (keep.noAppearance > 0)
      lines.push(`見た目の情報を持たない注釈 ${keep.noAppearance} 件（直線・テキストなど）は焼き込めないため、注釈のまま残します。`);
    if (keep.hidden > 0)
      lines.push(`表示されていない注釈 ${keep.hidden} 件は、注釈のまま残します。`);
    return lines.join('');
  }

  function renderCensus() {
    const census = tool().census();
    const result = census?.result ?? null;
    el.status.textContent = census === null ? '' : (census.pending ? '数えています…' : (census.error ?? (result.baked > 0 ? '' : '焼き込める注釈がありません。')));
    el.status.hidden = el.status.textContent === '';
    el.list.hidden = result === null || !(result.baked > 0);
    if (!el.list.hidden)
      renderList(result);
    const keep = result === null ? '' : keepText(result.keep);
    el.keepText.textContent = keep;
    el.keep.hidden = keep === '';
    el.warn.textContent = result?.notes > 0 ? `ノート ${result.notes} 件は付箋の絵だけが残り、本文と作成者は書き出したファイルに残りません。` : '';
    el.warn.hidden = el.warn.textContent === '';
  }

  function render() {
    if (el === null)
      return false;
    root.SigK.sourcePicker.render(el, tool().source());
    renderCensus();
    const status = tool().status();
    el.summary.textContent = status.ready ? status.summary : status.error;
    setDisabled(el.run, !tool().canRun());
    for (const control of [el.useOpen, el.pick])
      setDisabled(control, tool().isRunning());
    return true;
  }

  function onClick(node, handler) {
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') !== 'true')
        handler();
    });
  }

  function init(doc, win) {
    if (win.__sigkToolsFlattenViewReady === true)
      return false;
    const run = doc.getElementById('fl-run');
    if (run === null)
      return false;
    win.__sigkToolsFlattenViewReady = true;
    const byId = (id) => doc.getElementById(id);
    el = {
      doc, win, run,
      file: byId('fl-file'), name: byId('fl-name'), pages: byId('fl-pages'), note: byId('fl-note'), empty: byId('fl-empty'),
      useOpen: byId('fl-use-open'), pick: byId('fl-pick'),
      status: byId('fl-status'), list: byId('fl-list'), keep: byId('fl-keep'), keepText: byId('fl-keep-text'), warn: byId('fl-warn'),
      summary: byId('fl-summary'),
    };
    onClick(el.useOpen, () => tool().useOpenTab());
    onClick(el.pick, () => tool().pickFile());
    onClick(el.run, () => tool().run());
    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsFlattenView = { GROUPS, init, render };
})(typeof window !== 'undefined' ? window : globalThis);
