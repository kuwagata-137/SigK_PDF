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

  // 帯の画面を使うツール。確認の窓・保存先の窓・出力先の確かめの間も実行中で、その間に帯を替えると、確かめた帯と違う帯を書く（点検の直し）。
  const STRIP_TOOLS = ['toolsMerge', 'toolsSplit', 'toolsToImage', 'toolsWatermark', 'toolsFlatten'];

  function isLocked() {
    return root.SigK.tabs.isOpening() || root.SigK.save?.isBusy() === true
      || STRIP_TOOLS.some((name) => root.SigK[name]?.isRunning?.() === true);
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
  // 帯の横のスクロールバーは引けるように、止めるのはボタンと紙の上だけ。既定の動きを止めるとフォーカスが移らないので、右の欄の欄などに
  // 残ったフォーカスはここで外す（続く Esc・Ctrl+Z を帯と文書へ渡す。起動確認で見つけた。閲覧のハンドの押しと同じ考え）。
  function onMouseDown(event) {
    if ((event.button ?? 0) !== 0 || (event.target.closest?.('.strip-btn, .strip-page') ?? null) === null)
      return;
    event.preventDefault();
    el.doc.activeElement?.blur?.();
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
