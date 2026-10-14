(function (root) {
  'use strict';

  // 右の欄のフラット化の節の描画と結線（spec-4-5 確定事項7〜9、spec-2-5 確定事項E5。見本 screenshots/strips2-flatten.png）。状態は tools-flatten.js。
  //
  // 「焼き込む書き込み」のカードに、ファイルにある種類ごとのチェックボックス・名前・件数（選んだページの中の数）を並べ、焼き込まずに残すもの・
  // 選ばなかった書き込み・失うもの（ノートの本文と作成者）を出す。「ページ」のカードは［すべて］［範囲］と範囲の欄。0 件の文は出さない。

  let el = null;

  const tool = () => root.SigK.toolsFlatten;
  const groups = () => root.SigK.flattenChoice.GROUPS;

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

  // 種類の行。チェックボックスで焼き込む種類を選ぶ（確定事項E5-1）。行は種類の key で突き合わせ、チェックの状態を写す。
  function renderList(tally, kinds, running) {
    const rows = groups().filter((group) => tally.present.includes(group.key)).map((group) => {
      const row = el.list.querySelector(`.fl-row[data-group="${group.key}"]`) ?? buildRow(group);
      const box = row.querySelector('input');
      box.checked = kinds.includes(group.key);
      box.disabled = running;
      row.querySelector('.n').textContent = `${tally.counts[group.key]} 件`;
      return row;
    });
    el.list.replaceChildren(...rows);
  }

  function buildRow(group) {
    const row = el.doc.createElement('label');
    row.className = 'fl-row';
    row.dataset.group = group.key;
    const box = el.doc.createElement('input');
    box.type = 'checkbox';
    box.className = 'cbox';
    box.value = group.key;
    row.append(box, span('', group.label), span('n', ''));
    return row;
  }

  // 焼き込まずに残すもの（確定事項8）と、選び方で焼かない書き込み（確定事項E5-3）。0 件の文は出さない。
  function keepText(tally) {
    const lines = [];
    if (tally.keep.functional > 0)
      lines.push(`リンク・フォームの欄など ${tally.keep.functional} 件はそのまま残します。`);
    if (tally.keep.noAppearance > 0)
      lines.push(`見た目の情報を持たない書き込み ${tally.keep.noAppearance} 件（直線・テキストなど）は焼き込めないため、書き込みのまま残します。`);
    if (tally.keep.hidden > 0)
      lines.push(`表示されていない書き込み ${tally.keep.hidden} 件は、書き込みのまま残します。`);
    if (tally.unchosen > 0)
      lines.push(`選ばなかった書き込み ${tally.unchosen} 件（チェックを外した種類・範囲の外のページ）は、書き込みのまま残します。`);
    return lines.join('');
  }

  function renderCensus(selection, running) {
    const census = tool().census();
    const total = census?.result ?? null;
    el.status.textContent = census === null ? '' : (census.pending ? '数えています…' : (census.error ?? (total.baked > 0 ? '' : '焼き込める書き込みがありません。')));
    el.status.hidden = el.status.textContent === '';
    const tally = selection.tally;
    el.list.hidden = tally === null || !(total?.baked > 0);
    if (!el.list.hidden)
      renderList(tally, tool().choices().kinds, running);
    const keep = tally === null ? '' : keepText(tally);
    el.keepText.textContent = keep;
    el.keep.hidden = keep === '';
    el.warn.textContent = tally?.notes > 0 ? `ノート ${tally.notes} 件は付箋の絵だけが残り、本文と作成者は書き出したファイルに残りません。` : '';
    el.warn.hidden = el.warn.textContent === '';
  }

  // ページ（確定事項E5-2）。範囲の欄は打っている間は書き戻さない。
  function renderPages(selection, running) {
    const { mode, range } = tool().choices();
    for (const [value, radio] of Object.entries(el.pageModes)) {
      radio.checked = mode === value;
      radio.disabled = running;
    }
    el.rangeRow.classList.toggle('on', mode === 'range');
    if (el.doc.activeElement !== el.range && el.range.value !== range)
      el.range.value = range;
    el.range.disabled = running;
    const invalid = mode === 'range' && selection.error !== undefined;
    el.range.classList.toggle('invalid', invalid);
    el.rangeErr.textContent = invalid ? selection.error : '';
    el.rangeErr.hidden = !invalid;
  }

  // 対象が替わったか（tool.sync）を見てから描く。帯を押すたびに tabs.render → toolPane.sync から呼ばれる。
  function render() {
    if (el === null)
      return false;
    tool().sync();
    const text = tool().stateText();
    el.state.textContent = text ?? '';
    el.state.hidden = text === null;
    const running = tool().isRunning();
    const selection = tool().selection();
    renderCensus(selection, running);
    renderPages(selection, running);
    const status = tool().status();
    el.summary.textContent = status.ready ? status.summary : status.error;
    setDisabled(el.run, !tool().canRun());
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
      state: byId('fl-state'), status: byId('fl-status'), list: byId('fl-list'),
      keep: byId('fl-keep'), keepText: byId('fl-keep-text'), warn: byId('fl-warn'),
      pageModes: Object.fromEntries([...doc.querySelectorAll('input[name="fl-page-mode"]')].map((input) => [input.value, input])),
      rangeRow: byId('fl-page-modes'), range: byId('fl-range'), rangeErr: byId('fl-range-err'),
      summary: byId('fl-summary'),
    };
    el.list.addEventListener('change', (event) => {
      if (event.target.classList.contains('cbox'))
        tool().setKind(event.target.value, event.target.checked);
    });
    for (const [mode, radio] of Object.entries(el.pageModes))
      radio.addEventListener('change', () => { if (radio.checked) tool().setPageMode(mode); });
    el.range.addEventListener('input', () => tool().setRange(el.range.value));
    // 欄に触れたら「範囲」を選ぶ（PDF→画像・透かしと同じ）。
    el.range.addEventListener('focus', () => tool().setPageMode('range'));
    onClick(el.run, () => tool().run());
    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsFlattenView = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
