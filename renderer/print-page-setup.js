(function (root) {
  'use strict';

  // ページ設定（docs/spec-7-7-print-dialog.md・質問 PR3 ②）。Windows のページ設定画面と同じ構成で、サイズ(Z) と印刷の向きを選ぶ。
  // 給紙方法は「自動選択」だけ（プリンターの既定のトレイを使う）。余白は灰色（印刷可能領域はプリンターから取得する）。
  // open() は［OK］で { paperId, orientation }、［キャンセル］・［×］・Esc で null を返す。

  const ctx = { el: null, resolve: null, sizes: [] };
  const $ = (id) => ctx.el.doc.getElementById(id);

  function selected() {
    const id = $('print-setup-size').value;
    return ctx.sizes.find((size) => size.id === id) ?? ctx.sizes[0] ?? null;
  }

  function orientation() {
    return $('print-setup-landscape').checked ? 'landscape' : 'portrait';
  }

  // 上の見本の用紙（大きい方の辺を 110 px にする）。
  function renderPaper() {
    const size = selected();
    const node = $('print-setup-paper');
    if (size === null) {
      node.hidden = true;
      return;
    }
    const landscape = orientation() === 'landscape';
    const w = landscape ? size.height : size.width;
    const h = landscape ? size.width : size.height;
    const ratio = 110 / Math.max(w, h);
    node.hidden = false;
    Object.assign(node.style, { width: `${Math.round(w * ratio)}px`, height: `${Math.round(h * ratio)}px` });
  }

  function finish(result) {
    const resolve = ctx.resolve;
    ctx.resolve = null;
    if (ctx.el.dialog.open === true || ctx.el.dialog.hasAttribute('open')) {
      if (typeof ctx.el.dialog.close === 'function')
        ctx.el.dialog.close();
      else
        ctx.el.dialog.removeAttribute('open');
    }
    resolve?.(result);
  }

  function open({ paperSizes, paperId, orientation: current }) {
    if (ctx.el === null)
      return Promise.resolve(null);
    ctx.sizes = Array.isArray(paperSizes) ? paperSizes : [];
    $('print-setup-size').replaceChildren(...ctx.sizes.map((size) => {
      const option = ctx.el.doc.createElement('option');
      option.value = size.id;
      option.textContent = size.name;
      return option;
    }));
    $('print-setup-size').value = paperId ?? ctx.sizes[0]?.id ?? '';
    $('print-setup-portrait').checked = current !== 'landscape';
    $('print-setup-landscape').checked = current === 'landscape';
    renderPaper();
    root.SigK.printDialogKeys?.resetPosition(ctx.el.dialog);
    return new Promise((resolve) => {
      ctx.resolve = resolve;
      if (typeof ctx.el.dialog.showModal === 'function')
        ctx.el.dialog.showModal();
      else
        ctx.el.dialog.setAttribute('open', '');
      $('print-setup-size').focus();
    });
  }

  function init(doc) {
    const dialog = doc.getElementById('print-setup-dialog');
    if (dialog === null || ctx.el !== null)
      return false;
    ctx.el = { doc, dialog };
    $('print-setup-size').addEventListener('change', renderPaper);
    $('print-setup-portrait').addEventListener('change', renderPaper);
    $('print-setup-landscape').addEventListener('change', renderPaper);
    $('print-setup-ok').addEventListener('click', () => finish({ paperId: selected()?.id ?? null, orientation: orientation() }));
    $('print-setup-cancel').addEventListener('click', () => finish(null));
    $('print-setup-close').addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    root.SigK.printDialogKeys?.attach(dialog, { onEnter: () => $('print-setup-ok').click() });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printPageSetup = { init, open, isOpen: () => ctx.resolve !== null };
})(typeof window !== 'undefined' ? window : globalThis);
