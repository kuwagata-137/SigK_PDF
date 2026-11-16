(function (root) {
  'use strict';

  // ページ一覧の右クリック（spec-7-5 確定事項PG1・PG2・M2・T1・T2・R1・P2）。サムネイル（ページ編集モード・編集モード）と帯（ツールモード）で、
  // 右クリックした所から選択を決め、右クリックメニュー（page-menu.js）を表示する。押した項目の操作は page-list-commands.js が行う。
  //
  //   選択していないページ → そのページだけを選択してから表示する。選択したページの上なら、選択はそのまま（M2）
  //   ページの無い所（帯のページの右・サムネイルの下の空き） → 選択は変えず、［貼り付け］だけを押せるようにする（貼り付け先は末尾）
  //   枠でない帯 → その帯を枠にしてから上のとおり選択する（T1）
  //   表示しない: 開いている途中・保存の途中・ツールの実行中（P2）、分割画面と「変換する画像」の帯（T2）、開けなかった帯（R1）、ドラッグ中
  //   パスワード付きの帯・タブ → 項目をすべて灰色にする（R1）
  //
  // ［貼り付け］は、右クリックしたページの前に入れる（PG1）。右クリックした後は、その一覧にフォーカスを移す（続く Delete・Ctrl+C などを
  // ページ一覧で受けるため。K1）。

  let el = null;

  const target = () => root.SigK.pageListTarget;
  const commands = () => root.SigK.pageListCommands;

  // 帯の画面の右クリックした所。{ tabId, index（ページの位置。ページの無い所は null） } か、帯の外なら null。
  function stripHit(node) {
    const strip = node?.closest?.('.strip[data-tab-id]') ?? null;
    if (strip === null)
      return null;
    const cell = node.closest('.strip-page[data-page]');
    return { tabId: Number(strip.dataset.tabId), index: cell === null ? null : Number(cell.dataset.page) };
  }

  // 左パネルの右クリックした所。{ index } か、サムネイルを表示していなければ null。
  function thumbHit(node) {
    if (!target().thumbsShown(el.doc) || (node?.closest?.('#thumbs, #side-scroll') ?? null) === null)
      return null;
    const thumb = node.closest('.thumb');
    const index = thumb === null ? NaN : Number(thumb.dataset.page) - 1;
    return { index: Number.isInteger(index) ? index : null };
  }

  function isDragging() {
    return root.SigK.pageGrid?.isDragging() === true || root.SigK.stripDrag?.isDragging() === true;
  }

  // 枠でない帯なら枠を移す（T1）。開けなかった帯（ページが無い）なら false（R1）。
  function frameStrip(tabId) {
    const peeked = root.SigK.tabs.peek(tabId);
    if (peeked === null || peeked.doc === undefined)
      return false;
    root.SigK.imageStrip?.deselect();
    root.SigK.tabs.activate(tabId);
    return root.SigK.tabs.activeId() === tabId;
  }

  // 選択していないページなら、そのページだけを選択する（M2）。返すのは操作の対象のページ。
  function pick(list, index) {
    const held = list.selection();
    if (held.includes(index))
      return held;
    list.select([index]);
    return [index];
  }

  // 項目ごとの押せる・押せない（M1・M5・R1）。
  function enabledOf({ onPage, indices }) {
    if (target().isLocked())
      return {};
    const paste = root.SigK.pageClipboard.has();
    if (!onPage)
      return { paste };
    return { copy: true, cut: commands().canCut(indices), paste, delete: true };
  }

  // 押した項目の操作。メニューを表示してから、モードかタブが替わっていたら何もしない。
  function run(action, list, { indices, at }) {
    const now = target().current(el.doc);
    if (now === null || now.kind !== list.kind || now.tabId !== list.tabId || target().isBusy())
      return null;
    if (action === 'copy')
      return commands().copy(list, indices);
    if (action === 'cut')
      return commands().cut(list, indices);
    if (action === 'paste')
      return commands().paste(list, at);
    return commands().remove(list, indices);
  }

  function focusList(list) {
    el.doc.getElementById(list.kind === 'strips' ? 'strips' : 'side-scroll')?.focus?.({ preventScroll: true });
  }

  function onContextMenu(event) {
    const tools = target().modeOf(el.doc) === 'tools';
    const hit = tools ? stripHit(event.target) : thumbHit(event.target);
    if (hit === null)
      return;
    event.preventDefault();
    if (target().isBusy() || target().isSplitScreen(el.doc) || isDragging())
      return;
    if (tools && !frameStrip(hit.tabId))
      return;
    const list = target().current(el.doc);
    if (list === null || target().isEmpty())
      return;
    focusList(list);
    const onPage = hit.index !== null && hit.index < target().pageCount();
    const indices = onPage ? pick(list, hit.index) : list.selection();
    const context = { indices, at: onPage ? hit.index : target().pageCount() };
    root.SigK.pageMenu.open(event.clientX, event.clientY, {
      enabled: enabledOf({ onPage, indices }),
      onPick: (action) => run(action, list, context),
    });
  }

  function init(doc, win) {
    if (win.__sigkPageMenuRouteReady === true)
      return false;
    const side = doc.getElementById('side-scroll');
    const strips = doc.getElementById('strips');
    if (side === null || strips === null)
      return false;
    win.__sigkPageMenuRouteReady = true;
    el = { doc };
    side.addEventListener('contextmenu', onContextMenu);
    strips.addEventListener('contextmenu', onContextMenu);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageMenuRoute = { init };
})(typeof window !== 'undefined' ? window : globalThis);
