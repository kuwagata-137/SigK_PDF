(function (root) {
  'use strict';

  // 右パネルのトリミングの行とボタン（spec-4b-6a 確定事項17・19。見本 screenshots/phase4b-6-trim-frame.png・-trim-applied.png）。
  //
  // トリミングの道具を持っている間だけ、種類「トリミング」・当てるページ［このページ］［すべてのページ］・残す大きさ（枠があるとき）か
  // 今のページ（ページ番号の欄のページ）が切ってあるか、［取消］［適用］か［トリミングを外す］を出し、ほかの行と［削除］を隠す。
  // annotation-props.js の refresh が最初に render を呼ぶ。枠は annotate-trim.js、当てるページ・切る・外すは trim-tool.js、数え方は trim-commit.js。

  let el = null;

  // 枠（annotate-trim.js）と、当てるページ・切る・外す（trim-tool.js）。
  function frames() {
    return root.SigK.annotateTrim;
  }

  function tool() {
    return root.SigK.trimTool;
  }

  function hints() {
    return root.SigK.annotationHints.HINTS;
  }

  function holding() {
    return root.SigK.annotate?.getTool() === 'trim';
  }

  function setEnabled(button, enabled) {
    if (enabled)
      button.removeAttribute('aria-disabled');
    else
      button.setAttribute('aria-disabled', 'true');
  }

  function hideOwn() {
    el.scopeRow.hidden = true;
    el.sizeRow.hidden = true;
    el.actions.hidden = true;
    el.remove.hidden = true;
  }

  // 枠があるとき: 残す大きさと［取消］［適用］。
  function renderFrame(props, frame) {
    el.sizeLabel.textContent = '残す大きさ';
    el.size.textContent = tool().labelOf(frame);
    el.actions.hidden = false;
    el.remove.hidden = true;
    props.hint.textContent = hints().trim;
  }

  // このページのとき: 切ってあるか。すべてのページのとき: 切ってあるページの数。
  function statusText(scope, status) {
    if (scope === 'all')
      return status.count > 0 ? `${status.count} ページを切ってあります` : 'どのページも紙全体のままです';
    if (status.page === null)
      return '差し込んだページは切れません';
    if (!status.page.cropped)
      return '紙全体のままです';
    return `切ってあります（${root.SigK.pageCrop.sizeLabel(status.page.box, status.page.rotation)}）`;
  }

  // 枠が無いとき: 今のページ（すべてなら全部）が切ってあるかと［トリミングを外す］。
  function renderStatus(props) {
    // 保存して開き直した・タブを替えたあとは、その文書の紙全体を読み直す（読み終えたら描き直す）。
    tool().ensureBoxes();
    const scope = tool().getScope();
    const status = root.SigK.trimCommit.statusOf(root.SigK.viewer?.getState().current ?? 0, scope);
    // 文書を閉じたあと（道具は持ったまま）は、切ってあるかを出さない（点検 4）。
    const open = root.SigK.viewer?.getState().open === true;
    el.sizeLabel.textContent = scope === 'all' ? 'すべてのページ' : 'このページ';
    el.size.textContent = open ? statusText(scope, status) : '–';
    el.actions.hidden = true;
    el.remove.hidden = false;
    setEnabled(el.remove, open && status.count > 0 && !tool().isRemoving());
    props.hint.textContent = status.count > 0 ? hints().trimCropped : hints().trim;
  }

  // props は annotation-props.js の要素（kind・pageRow・textRow・hint・remove）。トリミングを持っていなければ自分の行を隠して false。
  // 持っていても、注釈一覧などから書き込みを選んだら、その書き込みの出し方（［削除］つき）に任せる（点検 5）。
  function render(props) {
    if (el === null)
      return false;
    if (!holding() || (root.SigK.annotate?.getSelection().length ?? 0) > 0) {
      hideOwn();
      props.remove.hidden = false;
      return false;
    }
    props.kind.textContent = 'トリミング';
    root.SigK.annotationStyleRows?.render(null);
    root.SigK.annotationNoteRows?.render({ text: null, author: null, editable: true });
    root.SigK.annotationAngleRow?.render(null);
    props.pageRow.hidden = true;
    props.textRow.hidden = true;
    props.remove.hidden = true;
    el.scopeRow.hidden = false;
    el.sizeRow.hidden = false;
    for (const button of el.scopes) {
      const on = button.dataset.scope === tool().getScope();
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
    const frame = frames().getFrame();
    if (frame !== null)
      renderFrame(props, frame);
    else
      renderStatus(props);
    return true;
  }

  // トリミングを持っている間だけ右パネルを描き直す（ページ番号が変わった・切った・外した・元に戻した）。
  function refresh() {
    if (el === null || !holding())
      return false;
    return root.SigK.annotationProps?.refresh() === true;
  }

  function init(doc, win) {
    if (win.__sigkTrimPropsReady === true)
      return false;
    const scopeRow = doc.getElementById('props-trim-scope-row');
    if (scopeRow === null)
      return false;
    win.__sigkTrimPropsReady = true;
    el = {
      scopeRow,
      scopes: [...doc.querySelectorAll('#props-trim-scope button[data-scope]')],
      sizeRow: doc.getElementById('props-trim-size-row'),
      sizeLabel: doc.getElementById('props-trim-size-label'),
      size: doc.getElementById('props-trim-size'),
      actions: doc.getElementById('props-trim-actions'),
      remove: doc.getElementById('props-trim-remove'),
    };
    for (const button of el.scopes)
      button.addEventListener('click', () => tool().setScope(button.dataset.scope));
    doc.getElementById('props-trim-cancel').addEventListener('click', () => frames().dropFrame());
    doc.getElementById('props-trim-apply').addEventListener('click', () => tool().apply());
    el.remove.addEventListener('click', () => {
      if (el.remove.getAttribute('aria-disabled') !== 'true')
        tool().remove();
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.trimProps = { init, render, refresh };
})(typeof window !== 'undefined' ? window : globalThis);
