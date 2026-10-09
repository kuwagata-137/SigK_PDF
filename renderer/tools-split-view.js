(function (root) {
  'use strict';

  // 分割画面の右の欄と下の要約（spec-2-2b 確定事項C11・H1・H5・I）。
  //
  // 状態は tools-split.js（対象と出力）と tools-split-edit.js（盤）が持つ。ここは読んで DOM に写し、操作をあちらの関数へ返す。
  // render() が画面全体の描き直しの入口で、盤（split-board-view.js）と上の段・帯（split-board-band.js）もここから描き直す。

  let el = null;

  const split = () => root.SigK.toolsSplit;
  const edit = () => root.SigK.toolsSplitEdit;
  const model = () => root.SigK.splitBoard;

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  // ページの範囲の書き方（第 I 章）。1 ページなら「3 ページ目」。first・last は 0 始まり。
  function rangeText(first, last) {
    return first === last ? `${first + 1} ページ目` : `${first + 1}〜${last + 1} ページ`;
  }

  // 数の言い方。9 までは「3 つ」、10 からは「12」（「12 つ」とは言わない）。
  const countOf = (n) => (n < 10 ? `${n} つ` : `${n.toLocaleString('ja-JP')}`);
  const digits = (n) => n.toLocaleString('ja-JP');
  const filesPhrase = (n) => (n < 10 ? `${n} つのファイル` : `${n.toLocaleString('ja-JP')} のファイル`);

  function span(className, text) {
    const node = el.doc.createElement('span');
    node.className = className;
    node.textContent = text;
    return node;
  }

  // ---- できるファイル（確定事項C11） ----

  function fileRow(box, name) {
    const row = el.doc.createElement('button');
    row.type = 'button';
    row.className = 'sb-file';
    row.dataset.box = String(box.index);
    const no = span('sb-no', String(box.file));
    no.classList.toggle('even', box.file % 2 === 0);
    row.append(no, span('fname', name), span('p', rangeText(box.first, box.last)));
    row.title = name;
    return row;
  }

  function renderFiles(plan) {
    const shown = plan.reason !== 'no-source';
    el.filesCard.hidden = !shown;
    if (!shown) {
      el.files.replaceChildren();
      return;
    }
    const boxes = model().boxes(edit().board()).filter((box) => box.file !== null);
    el.filesCount.textContent = countOf(boxes.length);
    el.files.replaceChildren(...boxes.map((box) => fileRow(box, plan.names[box.file - 1])));
  }

  // ---- 出力（確定事項H1） ----

  function renderOutput(plan, src) {
    const settings = split().settings();
    el.folder.textContent = settings.folder ?? '';
    el.folder.title = settings.folder ?? '';
    el.ruleRadios.seq.checked = settings.rule === 'seq';
    el.ruleRadios.pages.checked = settings.rule === 'pages';
    const first = (rule) => (plan.parts?.length > 0 ? root.SigK.splitPlan.outputNames(src.name, plan.parts, rule)[0] : '');
    el.ruleSeq.textContent = first('seq');
    el.rulePages.textContent = first('pages');
  }

  // ---- 下の要約（確定事項H5・第 I 章） ----

  function skippedText(board) {
    const count = board.skipped.length;
    if (count >= 4)
      return `${digits(count)} ページ`;
    return `${board.skipped.map((page) => page + 1).join('・')} ページ目`;
  }

  function summaryOf(plan) {
    if (plan.reason === 'no-source')
      return split().source() === null ? '分割する PDF を決めてください。' : '';
    if (plan.reason === 'untouched')
      return '✂ で分け目を入れるか、書き出さないページを決めると、実行できます。';
    if (plan.reason === 'empty')
      return '書き出すページが 1 枚も無いので、書き出さない印をどれか外してください。';
    if (plan.reason === 'too-many')
      return `いまの分け方では ${plan.files.toLocaleString('ja-JP')} ファイルになり、上限の ${root.SigK.splitPlan.MAX_OUTPUTS} を超えるので、実行できません。`;
    const board = edit().board();
    const files = filesPhrase(plan.files);
    if (board.skipped.length === 0)
      return `${digits(board.pageCount)} ページを ${files}に分けます。`;
    return `${skippedText(board)}を書き出さずに、残りの ${digits(board.pageCount - board.skipped.length)} ページを ${files}に分けます。`;
  }

  function render() {
    if (el === null)
      return false;
    const src = split().source();
    const plan = split().currentPlan();
    const running = split().isRunning();
    root.SigK.sourcePicker.render(el, src);
    renderFiles(plan);
    renderOutput(plan, src);
    el.summary.textContent = summaryOf(plan);
    el.summary.classList.toggle('wait', !plan.ready);
    setDisabled(el.run, !split().canRun());
    for (const control of [el.useOpen, el.pick, el.folderPick])
      setDisabled(control, running);
    el.ruleRadios.seq.disabled = running;
    el.ruleRadios.pages.disabled = running;
    root.SigK.splitBoardBand?.sync();
    root.SigK.splitBoardView?.render();
    return true;
  }

  function onClick(node, handler) {
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') !== 'true')
        handler();
    });
  }

  function init(doc, win) {
    if (win.__sigkToolsSplitViewReady === true)
      return false;
    const run = doc.getElementById('split-run');
    if (run === null)
      return false;
    win.__sigkToolsSplitViewReady = true;

    const byId = (id) => doc.getElementById(id);
    el = {
      doc, win, run,
      file: byId('split-file'), name: byId('split-name'), pages: byId('split-pages'), note: byId('split-note'),
      empty: byId('split-empty'), useOpen: byId('split-use-open'), pick: byId('split-pick'),
      filesCard: byId('split-files-card'), files: byId('split-files'), filesCount: byId('split-files-count'),
      folder: byId('split-folder'), folderPick: byId('split-folder-pick'),
      ruleRadios: { seq: doc.querySelector('input[name="split-rule"][value="seq"]'), pages: doc.querySelector('input[name="split-rule"][value="pages"]') },
      ruleSeq: byId('split-rule-seq'), rulePages: byId('split-rule-pages'),
      summary: byId('split-summary'),
    };
    for (const rule of ['seq', 'pages'])
      el.ruleRadios[rule].addEventListener('change', () => { if (el.ruleRadios[rule].checked) split().setRule(rule); });
    // できるファイルの行を押すと、その箱へスクロールする（確定事項C11）。
    el.files.addEventListener('click', (event) => {
      const row = event.target.closest('.sb-file');
      if (row !== null)
        root.SigK.splitBoardView?.revealBox(Number(row.dataset.box));
    });

    root.SigK.sourcePicker.bindTabMenu(el.useOpen, (id) => split().useTab(id));
    onClick(el.pick, () => split().pickFile());
    onClick(el.folderPick, () => split().pickFolder());
    onClick(el.run, () => split().run());

    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsSplitView = { init, render, rangeText, countOf };
})(typeof window !== 'undefined' ? window : globalThis);
