(function (root) {
  'use strict';

  // 印刷画面・ページ設定・注釈の一覧の確認のキー操作と移動（docs/spec-7-7-print-dialog.md 確定事項C2）。
  //
  // アクセスキー: Alt＋文字で、data-key がその文字の、表示中で押せる要素を操作する（ボタンは押す、チェックボックスとラジオボタンは
  // 切り替える、選択欄と入力欄はフォーカスを当てる）。Enter は既定のボタン（onEnter）。題名バーをドラッグすると画面を移動する。

  function usable(node) {
    return node !== null && node.disabled !== true && node.closest('[hidden]') === null;
  }

  function activate(node) {
    if (node.tagName === 'BUTTON' || node.type === 'checkbox' || node.type === 'radio') {
      node.click();
      node.focus();
      return;
    }
    node.focus();
    node.select?.();
  }

  // Alt＋文字のキーを処理したら true。
  function handleAccessKey(dialog, event) {
    if (!event.altKey || event.ctrlKey || event.metaKey || !/^[a-z]$/i.test(event.key ?? ''))
      return false;
    const target = [...dialog.querySelectorAll(`[data-key="${event.key.toLowerCase()}"]`)].find(usable);
    if (target === undefined)
      return false;
    event.preventDefault();
    activate(target);
    return true;
  }

  // Enter は、ボタン・選択欄・ドラッグ中の要素の上では、その要素に任せる。
  function handleEnter(event, onEnter) {
    if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey || event.isComposing)
      return false;
    const tag = event.target?.tagName;
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA')
      return false;
    event.preventDefault();
    // 入力欄の値を確定してから押す（change を先に起こす）。
    event.target?.dispatchEvent?.(new event.target.ownerDocument.defaultView.Event('change', { bubbles: true }));
    onEnter();
    return true;
  }

  function makeMovable(dialog, handle) {
    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button') !== null)
        return;
      const rect = dialog.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, id: event.pointerId };
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (drag === null || event.pointerId !== drag.id)
        return;
      const win = dialog.ownerDocument.defaultView;
      const left = Math.min(Math.max(0, event.clientX - drag.dx), Math.max(0, win.innerWidth - 80));
      const top = Math.min(Math.max(0, event.clientY - drag.dy), Math.max(0, win.innerHeight - 30));
      Object.assign(dialog.style, { margin: '0', left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    });
    const end = () => {
      drag = null;
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // 開くたびに、画面の中央へ戻す。
  function resetPosition(dialog) {
    for (const name of ['margin', 'left', 'top', 'right', 'bottom'])
      dialog.style.removeProperty(name);
  }

  function attach(dialog, { onEnter = null } = {}) {
    dialog.addEventListener('keydown', (event) => {
      if (handleAccessKey(dialog, event))
        return;
      if (onEnter !== null)
        handleEnter(event, onEnter);
    });
    const handle = dialog.querySelector('.pd-title');
    if (handle !== null)
      makeMovable(dialog, handle);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printDialogKeys = { attach, resetPosition, handleAccessKey };
})(typeof window !== 'undefined' ? window : globalThis);
