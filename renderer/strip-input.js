(function (root) {
  'use strict';

  // 帯を押す処理（spec-2-5 確定事項D3〜D6・D9・D10）。状態はタブが持つので、どれもタブの関数を呼ぶ。
  //
  //   帯を押す            → そのタブを選ぶ（tabs.activate）
  //   ［↑］［↓］          → タブの並びを替える（tabs.reorder）
  //   フロッピー          → そのタブを選んで上書き保存（変更が無ければ何もしない）
  //   ［×］              → タブを閉じる（保存していない変更があれば今の確認の窓）
  //   ページを押す        → そのタブを選び、ページを選ぶ（クリック・Shift・Ctrl）
  //   ページをダブルクリック → 閲覧モードでそのページを開く
  //
  // 開いている途中・保存やツールの実行の途中は効かせない（別の帯を前に出すと、保存や実行の対象が替わるため。危ない所 2・3）。

  let el = null;

  function isLocked() {
    return root.SigK.tabs.isOpening() || root.SigK.save?.isBusy() === true;
  }

  function tabIdOf(node) {
    const strip = node?.closest?.('.strip[data-tab-id]') ?? null;
    return strip === null ? null : Number(strip.dataset.tabId);
  }

  function pageOf(node) {
    const cell = node?.closest?.('.strip-page[data-page]') ?? null;
    return cell === null ? null : Number(cell.dataset.page);
  }

  function move(tabId, step) {
    const ids = root.SigK.tabs.list().map((tab) => tab.id);
    const from = ids.indexOf(tabId);
    const to = from + step;
    if (from === -1 || to < 0 || to >= ids.length)
      return false;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    return root.SigK.tabs.reorder(ids);
  }

  async function save(tabId) {
    if (!root.SigK.tabs.isDirty(tabId))
      return false;
    root.SigK.tabs.activate(tabId);
    const result = await root.SigK.save.saveActive();
    return result?.ok === true;
  }

  const ACTIONS = {
    up: (tabId) => move(tabId, -1),
    down: (tabId) => move(tabId, 1),
    save,
    close: (tabId) => root.SigK.tabs.closeTab(tabId),
  };

  function onClick(event) {
    const tabId = tabIdOf(event.target);
    if (tabId === null || isLocked())
      return;
    const button = event.target.closest('.strip-btn');
    if (button !== null) {
      if (button.getAttribute('aria-disabled') !== 'true')
        ACTIONS[button.dataset.act]?.(tabId);
      return;
    }
    root.SigK.tabs.activate(tabId);
    const page = pageOf(event.target);
    if (page !== null)
      root.SigK.stripSelection.click(tabId, page, { ctrl: event.ctrlKey, shift: event.shiftKey, plan: root.SigK.tabs.peek(tabId)?.plan ?? null });
  }

  function onDoubleClick(event) {
    const tabId = tabIdOf(event.target);
    const page = pageOf(event.target);
    if (tabId === null || page === null || isLocked())
      return;
    root.SigK.tabs.activate(tabId);
    root.SigK.shell.setMode(el.doc, 'view');
    root.SigK.viewer.goToPage(page);
  }

  // ボタンにフォーカスを移さない（帯はキーボードで動かさない。PR-2 の起草者の判断）。紙の Shift＋押しで文字が選ばれるのも止める。
  // 帯の横のスクロールバーは引けるように、止めるのはボタンと紙の上だけ。
  function onMouseDown(event) {
    if ((event.button ?? 0) === 0 && (event.target.closest?.('.strip-btn, .strip-page') ?? null) !== null)
      event.preventDefault();
  }

  function init(doc, win) {
    if (win.__sigkStripInputReady === true)
      return false;
    const strips = doc.getElementById('strips');
    if (strips === null)
      return false;
    win.__sigkStripInputReady = true;
    el = { doc, strips };
    strips.addEventListener('click', onClick);
    strips.addEventListener('dblclick', onDoubleClick);
    strips.addEventListener('mousedown', onMouseDown);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripInput = { init, isLocked };
})(typeof window !== 'undefined' ? window : globalThis);
