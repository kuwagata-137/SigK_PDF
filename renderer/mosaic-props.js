(function (root) {
  'use strict';

  // 右パネルのモザイクの行とボタン（spec-4b-6b 確定事項14〜16。決定64 ⑦・決定66 ④。見本 screenshots/phase4b-6b-mosaic-remove.png）。
  //
  // モザイクの道具を持っている間だけ、種類「モザイク」・粗さ［細かい］［ふつう］［粗い］・今のページ（ページ番号の欄のページ）の
  // モザイクの数・［このページのモザイクを外す］を出し、ほかの行と［削除］を隠す。annotation-props.js の refresh がトリミングの次に
  // render を呼ぶ。粗さを覚える・外すのは annotate-mosaic.js。

  let el = null;

  function tool() {
    return root.SigK.annotateMosaic;
  }

  function holding() {
    return root.SigK.annotate?.getTool() === 'mosaic';
  }

  function hideOwn() {
    el.blockRow.hidden = true;
    el.countRow.hidden = true;
    el.remove.hidden = true;
  }

  // 今のページのモザイクの数。文書を閉じたあとは null。
  function currentCount() {
    const view = root.SigK.viewer?.getState();
    if (view?.open !== true)
      return null;
    return root.SigK.pageMosaic.countOf(root.SigK.viewer.getPlan()[view.current ?? 0]);
  }

  function countText(count) {
    if (count === null)
      return '–';
    return count > 0 ? `モザイク ${count} か所（まだ保存していません）` : 'モザイクはありません';
  }

  // props は annotation-props.js の要素（kind・pageRow・textRow・hint・remove）。モザイクを持っていなければ自分の行を隠して false。
  // 持っていても、注釈一覧などから書き込みを選んだら、その書き込みの出し方（［削除］つき）に任せる（トリミングと同じ）。
  function render(props) {
    if (el === null)
      return false;
    if (!holding() || (root.SigK.annotate?.getSelection().length ?? 0) > 0) {
      hideOwn();
      return false;
    }
    props.kind.textContent = 'モザイク';
    root.SigK.annotationStyleRows?.render(null);
    root.SigK.annotationNoteRows?.render({ text: null, author: null, editable: true });
    root.SigK.annotationAngleRow?.render(null);
    props.pageRow.hidden = true;
    props.textRow.hidden = true;
    props.remove.hidden = true;
    el.blockRow.hidden = false;
    el.countRow.hidden = false;
    el.remove.hidden = false;
    const block = tool().getBlock();
    for (const button of el.blocks) {
      const on = Number(button.dataset.block) === block;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
    const count = currentCount();
    el.count.textContent = countText(count);
    if (count !== null && count > 0)
      el.remove.removeAttribute('aria-disabled');
    else
      el.remove.setAttribute('aria-disabled', 'true');
    props.hint.textContent = root.SigK.annotationHints.HINTS.mosaic;
    return true;
  }

  // モザイクを持っている間だけ右パネルを描き直す（ページ番号が変わった・置いた・外した・元に戻した・粗さを替えた）。
  function refresh() {
    if (el === null || !holding())
      return false;
    return root.SigK.annotationProps?.refresh() === true;
  }

  function init(doc, win) {
    if (win.__sigkMosaicPropsReady === true)
      return false;
    const blockRow = doc.getElementById('props-mosaic-block-row');
    if (blockRow === null)
      return false;
    win.__sigkMosaicPropsReady = true;
    el = {
      blockRow,
      blocks: [...doc.querySelectorAll('#props-mosaic-block button[data-block]')],
      countRow: doc.getElementById('props-mosaic-count-row'),
      count: doc.getElementById('props-mosaic-count'),
      remove: doc.getElementById('props-mosaic-remove'),
    };
    for (const button of el.blocks)
      button.addEventListener('click', () => tool().setBlock(Number(button.dataset.block)));
    el.remove.addEventListener('click', () => {
      if (el.remove.getAttribute('aria-disabled') !== 'true')
        tool().removeOnPage();
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.mosaicProps = { init, render, refresh };
})(typeof window !== 'undefined' ? window : globalThis);
