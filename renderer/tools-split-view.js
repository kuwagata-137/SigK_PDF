(function (root) {
  'use strict';

  // 分割画面の描画（spec-2-2 確定事項12・18・38）。
  //
  // 状態は tools-split.js が持つ。ここは source() と currentPlan() を読んで DOM に
  // 写し、操作をあちらの関数へ返すだけである。入力欄は打つたびに描き直さず、
  // フォーカスの無い欄だけ値を合わせる（結合の syncRow と同じ理由）。

  const MODES = ['every', 'at', 'range'];

  let el = null;

  const split = () => root.SigK.toolsSplit;

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  function code(text) {
    const node = el.doc.createElement('code');
    node.textContent = text;
    return node;
  }

  // ---- 対象 ----

  function renderTarget() {
    const src = split().source();
    el.file.hidden = src === null;
    el.empty.hidden = src !== null;
    if (src === null)
      return;
    el.name.textContent = src.name;
    el.file.title = src.path;
    el.pages.textContent = src.pending ? '…' : (src.pageCount === null ? '' : `${src.pageCount} ページ`);
    el.file.classList.toggle('blocked', src.blocked !== null);
    const note = src.blocked ?? src.note;
    el.note.textContent = note ?? '';
    el.note.hidden = note === null || note === undefined;
    el.note.classList.toggle('error', src.blocked !== null);
  }

  // ---- 分け方と出力 ----

  function summaryFor(plan, settings, src) {
    if (!plan.ready)
      return '';
    const count = plan.parts.length;
    if (settings.mode === 'every')
      return `${src.pageCount} ページを ${root.SigK.pageRange.normalize(settings.every)} ページごとに ${count} ファイルへ`;
    if (settings.mode === 'at')
      return `${src.pageCount} ページを ${count} ファイルへ`;
    return `${plan.parts[0].length} ページを取り出して 1 ファイルへ`;
  }

  function renderExample(plan) {
    el.example.replaceChildren();
    if (!plan.ready) {
      if (plan.error !== null) {
        const err = el.doc.createElement('span');
        err.className = 'err';
        err.textContent = plan.error;
        el.example.append(err);
      }
      return;
    }
    const { names } = plan;
    const count = el.doc.createElement('span');
    count.className = 'n';
    count.textContent = `（${names.length} ファイル）`;
    if (names.length === 1)
      el.example.append(code(names[0]), count);
    else
      el.example.append(code(names[0]), ' … ', code(names[names.length - 1]), count);
  }

  function renderRuleExamples(plan, src) {
    if (!plan.ready) {
      el.ruleSeq.textContent = '';
      el.rulePages.textContent = '';
      return;
    }
    const names = (rule) => root.SigK.splitPlan.outputNames(src.name, plan.parts, rule)[0];
    el.ruleSeq.textContent = names('seq');
    el.rulePages.textContent = names('pages');
  }

  // 計画に関わるものだけを合わせる。対象の行は触らない。
  function sync() {
    if (el === null)
      return false;
    const settings = split().settings();
    const src = split().source();
    const plan = split().currentPlan();
    const running = split().isRunning();

    for (const mode of MODES) {
      const row = el.rows[mode];
      const active = settings.mode === mode;
      row.classList.toggle('on', active);
      el.modeRadios[mode].checked = active;
      const input = el.inputs[mode];
      if (el.doc.activeElement !== input && input.value !== settings[mode])
        input.value = settings[mode];
      input.disabled = running;
      const invalid = active && plan.error !== null;
      input.classList.toggle('invalid', invalid);
      el.errs[mode].textContent = invalid ? plan.error : '';
      el.errs[mode].hidden = !invalid;
      el.modeRadios[mode].disabled = running;
    }

    el.folder.textContent = settings.folder ?? '';
    el.folder.title = settings.folder ?? '';
    el.ruleRadios.seq.checked = settings.rule === 'seq';
    el.ruleRadios.pages.checked = settings.rule === 'pages';
    el.ruleRadios.seq.disabled = running;
    el.ruleRadios.pages.disabled = running;
    renderRuleExamples(plan, src);
    renderExample(plan);
    el.summary.textContent = summaryFor(plan, settings, src);

    setDisabled(el.run, !split().canRun());
    for (const control of [el.useOpen, el.pick, el.folderPick])
      setDisabled(control, running);
    return true;
  }

  function render() {
    if (el === null)
      return false;
    renderTarget();
    return sync();
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
      rows: {}, modeRadios: {}, inputs: {}, errs: {},
      folder: byId('split-folder'), folderPick: byId('split-folder-pick'),
      ruleRadios: { seq: doc.querySelector('input[name="split-rule"][value="seq"]'), pages: doc.querySelector('input[name="split-rule"][value="pages"]') },
      ruleSeq: byId('split-rule-seq'), rulePages: byId('split-rule-pages'),
      example: byId('split-example'), summary: byId('split-summary'),
    };
    for (const mode of MODES) {
      el.modeRadios[mode] = doc.querySelector(`input[name="split-mode"][value="${mode}"]`);
      el.rows[mode] = el.modeRadios[mode].closest('.split-mode');
      el.inputs[mode] = byId(`split-${mode}`);
      el.errs[mode] = byId(`split-${mode}-err`);
      el.modeRadios[mode].addEventListener('change', () => { if (el.modeRadios[mode].checked) split().setMode(mode); });
      el.inputs[mode].addEventListener('input', () => split().setInput(mode, el.inputs[mode].value));
      // 欄に触れたらその方式を選ぶ。ラジオまで戻らせない。
      el.inputs[mode].addEventListener('focus', () => split().setMode(mode));
    }
    for (const rule of ['seq', 'pages'])
      el.ruleRadios[rule].addEventListener('change', () => { if (el.ruleRadios[rule].checked) split().setRule(rule); });

    onClick(el.useOpen, () => split().useOpenTab());
    onClick(el.pick, () => split().pickFile());
    onClick(el.folderPick, () => split().pickFolder());
    onClick(el.run, () => split().run());

    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsSplitView = { init, render, sync };
})(typeof window !== 'undefined' ? window : globalThis);
