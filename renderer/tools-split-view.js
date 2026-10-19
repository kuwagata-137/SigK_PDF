(function (root) {
  'use strict';

  // 分割の右の欄（#tool-pane の節。spec-2-2b 確定事項C11・H1・H5・I、spec-2-5 確定事項G2・G14）。
  //
  // 状態は tools-split.js（対象と出力）と tools-split-edit.js（盤）が持つ。ここは読んで DOM に写し、操作をあちらの関数へ返す。
  // render() が分割の画面全体の描き直しの入口で、盤を選んでいる帯へ入れ（split-strip.js）、盤（split-board-view.js）と
  // 上の段・選んだときの操作の行（split-board-band.js）もここから描き直す。

  let el = null;
  let filesKey = null;   // 一覧に並べた中身。同じなら組み直さない

  const split = () => root.SigK.toolsSplit;
  const edit = () => root.SigK.toolsSplitEdit;
  const model = () => root.SigK.splitBoard;

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  // 数は 1,000 以上ならカンマを付ける（決定78 ③）。
  const digits = (n) => root.SigK.splitPlan.withCommas(n);

  // ページの範囲の書き方（第 I 章）。1 ページなら「3 ページ目」。first・last は 0 始まり。
  function rangeText(first, last) {
    return first === last ? `${digits(first + 1)} ページ目` : `${digits(first + 1)}〜${digits(last + 1)} ページ`;
  }

  // ファイルの数の言い方。9 までは「3 つ」、10 からは「12 個」（決定78 ②）。
  const countOf = (n) => (n < 10 ? `${n} つ` : `${digits(n)} 個`);

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
    const no = span('sb-no', digits(box.file));
    no.classList.toggle('even', box.file % 2 === 0);
    row.append(no, span('fname', name), span('p', rangeText(box.first, box.last)));
    // 説明の吹き出し（spec-2-5 J5）。
    root.SigK.tipContent.text(row, name, '押すと、このファイルの箱へ移ります。');
    return row;
  }

  // 上限（split-plan.js の MAX_OUTPUTS）を超えた分は並べず、数だけを 1 行で知らせる。超えると実行できないので、並べても使わない。
  function moreRow(rest) {
    return span('sb-files-more', `上限の ${digits(root.SigK.splitPlan.MAX_OUTPUTS)} を超えるので、残りの ${digits(rest)} 個はここに並べません。`);
  }

  function renderFiles(plan) {
    const shown = plan.reason !== 'no-source';
    el.filesCard.hidden = !shown;
    if (!shown) {
      filesKey = null;
      el.files.replaceChildren();
      return;
    }
    const boxes = model().boxes(edit().board()).filter((box) => box.file !== null);
    const listed = boxes.slice(0, root.SigK.splitPlan.MAX_OUTPUTS);
    const names = listed.map((box) => plan.names[box.file - 1]);
    const key = `${boxes.length}|${listed.map((box, i) => `${box.index}:${box.first}-${box.last}:${names[i]}`).join('/')}`;
    el.filesCount.textContent = countOf(boxes.length);
    if (key === filesKey)
      return;
    filesKey = key;
    const rows = listed.map((box, i) => fileRow(box, names[i]));
    if (boxes.length > listed.length)
      rows.push(moreRow(boxes.length - listed.length));
    el.files.replaceChildren(...rows);
  }

  // ---- 出力（確定事項H1） ----

  function renderOutput(plan, src) {
    const settings = split().settings();
    el.folder.textContent = settings.folder ?? '';
    // 出力先のフォルダの説明の吹き出し（spec-2-5 J5）。フォルダが決まっていない間は外す（空の欄に名前だけを出さない）。
    if (settings.folder)
      root.SigK.tipContent.text(el.folder, '出力先のフォルダ', settings.folder);
    else
      root.SigK.tipContent.clear(el.folder);
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
    return `${board.skipped.map((page) => digits(page + 1)).join('・')} ページ目`;
  }

  // 対象の帯が無い・使えないときは空にする（状態の文が出るため。PR-2 のほかのツールと同じ）。
  function summaryOf(plan) {
    if (plan.reason === 'no-source')
      return '';
    if (plan.reason === 'untouched')
      return '✂ で分け目を入れるか、書き出さないページを決めると、実行できます。';
    if (plan.reason === 'empty')
      return '書き出すページが 1 枚も無いので、書き出さない印をどれか外してください。';
    if (plan.reason === 'too-many')
      return `いまの分け方では ${digits(plan.files)} ファイルになり、上限の ${root.SigK.splitPlan.MAX_OUTPUTS} を超えるので、実行できません。`;
    const board = edit().board();
    const files = `${countOf(plan.files)}のファイル`;
    if (board.skipped.length === 0)
      return `${digits(board.pageCount)} ページを ${files}に分けます。`;
    return `${skippedText(board)}を書き出さずに、残りの ${digits(board.pageCount - board.skipped.length)} ページを ${files}に分けます。`;
  }

  function render() {
    if (el === null)
      return false;
    split().sync();
    root.SigK.splitStrip?.sync();
    const src = split().source();
    const plan = split().currentPlan();
    const running = split().isRunning();
    const stateText = split().stateText();
    el.state.hidden = stateText === null;
    el.state.textContent = stateText ?? '';
    renderFiles(plan);
    renderOutput(plan, src);
    el.summary.textContent = summaryOf(plan);
    el.summary.classList.toggle('wait', !plan.ready);
    setDisabled(el.run, !split().canRun());
    setDisabled(el.folderPick, running);
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
      doc, win, run, state: byId('split-state'),
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

    onClick(el.folderPick, () => split().pickFolder());
    onClick(el.run, () => split().run());

    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsSplitView = { init, render, rangeText, countOf, digits };
})(typeof window !== 'undefined' ? window : globalThis);
