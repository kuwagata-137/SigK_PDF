(function (root) {
  'use strict';

  // ページ一覧の操作（spec-7-5 確定事項PG1・M3〜M5・D1〜D3・R2・U1・P1）。右クリックメニュー（page-menu-route.js）とキー（page-list-keys.js）、
  // ページ編集モードの［削除］ボタンとサムネイルの［このページを削除］（page-actions.js の requestRemove）が呼ぶ。list は page-list-target.js の一覧。
  //
  //   copy   … 選択したページの写しを作って持つ（page-clipboard.js）
  //   cut    … 写しを作ってから元のページを削除する。削除確認画面は表示しない（M5。Ctrl+Z で戻せる。貼り付けると移動になる）
  //   paste  … 持っている写しを at（並びの位置）の前へ差し込みとして入れ、入れたページを選択する（PG1・M3・P1）
  //   remove … 削除確認画面（confirm-page-delete.js）で［削除］を押したら削除する（D1〜D3）
  //
  // 削除・切り取り・貼り付けは、1 回の操作で 1 世代（page-edit.js の commit）。ツールモードではツールモードの記録にも控える（U1。tool-history.js）。
  // 写しを作る間・削除確認画面の間にタブかページの並びが変わったら、削除も貼り付けもしない。

  const viewer = () => root.SigK.viewer;
  const banner = () => root.SigK.viewBanner;
  const pagePlan = () => root.SigK.pagePlan;

  // 押した時点のタブと並び（参照）。非同期の処理の後で、同じかを照らす。
  function snapshot(list) {
    return { tabId: list.tabId, plan: viewer().peek()?.plan ?? null };
  }

  function unchanged(shot) {
    return root.SigK.tabs.activeId() === shot.tabId && (viewer().peek()?.plan ?? null) === shot.plan;
  }

  // 保存していないモザイクがあるページを含むときの通知文（R2。spec-2-5 確定事項I8 と同じ決まり）。含まなければ null。
  function mosaicRefusal(indices) {
    const plan = viewer().getPlan();
    if (!indices.some((index) => (root.SigK.pageMosaic?.countOf(plan[index]) ?? 0) > 0))
      return null;
    return `モザイクを保存していないページはコピーできません。「${viewer().getState().file.name}」を上書き保存してから、もう一度操作してください。`;
  }

  function refuse(text) {
    banner().show(text, { tone: 'warn' });
    return { refused: text };
  }

  // 写しを作れなかった・中止したことを通知する。進み具合の通知文は残さない。中止は自分で止めたので赤く塗らない（決定49）。
  function report(built, canceledText) {
    if (built.canceled === true)
      banner().show(canceledText, { tone: 'info' });
    else if (built.error !== undefined)
      banner().show(built.error);
    return built;
  }

  function done(text) {
    banner().show(text, { autoHideMs: 2500, tone: 'info' });
  }

  // すべてのページを選んでいるときは切り取れない（M5。少なくとも 1 ページは残す。spec-1-5 確定事項41）。
  function canCut(indices) {
    return pagePlan().canDelete(viewer().getPlan(), indices);
  }

  // 確認なしで削除し、記録に控える。帯では、削除した位置に来たページを選択する（ページ編集の削除と同じ。続けて Delete を押せる）。
  function removeNow(list, indices) {
    root.SigK.annotate?.finishEditing?.();
    if (root.SigK.pageActions.remove(indices) !== true)
      return false;
    list.record();
    if (list.kind === 'strips')
      list.select(root.SigK.pageGrid.getSelection());
    return true;
  }

  // パスワード付きの帯・タブ（保存できない）は、コピー元にも貼り付け先にもしない（R1。画面ではメニューの項目を灰色にし、キーは受けない）。
  const locked = () => root.SigK.pageListTarget.isLocked();

  async function copy(list, indices) {
    if (locked())
      return false;
    const refused = mosaicRefusal(indices);
    if (refused !== null)
      return refuse(refused);
    const built = await root.SigK.pageClipboard.capture(indices);
    if (built.ok !== true)
      return report(built, 'ページのコピーを中止しました。');
    done(`${built.sizes.length} ページをコピーしました。`);
    return { ok: true, pages: built.sizes.length };
  }

  async function cut(list, indices) {
    if (locked())
      return false;
    if (!canCut(indices))
      return { refused: 'all' };
    const refused = mosaicRefusal(indices);
    if (refused !== null)
      return refuse(refused);
    const shot = snapshot(list);
    const built = await root.SigK.pageClipboard.capture(indices, { keep: () => unchanged(shot) });
    if (built.ok !== true)
      return report(built, '切り取りを中止しました。');
    removeNow(list, indices);
    done(`${indices.length} ページを切り取りました。`);
    return { ok: true, pages: indices.length };
  }

  async function paste(list, at) {
    if (locked() || !root.SigK.pageClipboard.has())
      return false;
    const shot = snapshot(list);
    const opened = await root.SigK.pageClipboard.open();
    if (opened === null)
      return false;
    if (opened.ok !== true)
      return report(opened, '');
    if (!unchanged(shot)) {
      opened.doc?.loadingTask?.destroy?.();
      return { canceled: true };
    }
    root.SigK.annotate?.finishEditing?.();
    const after = root.SigK.pageTransfer.insertInto(list.tabId, opened, at);
    if (!Array.isArray(after))
      return { canceled: true };
    list.record();
    if (list.kind === 'strips')
      list.select(after);
    return { ok: true, pages: after.length };
  }

  // 削除確認画面を表示し、［削除］を押したら削除する（D1〜D3）。indices は映しているタブの並びの位置。
  async function remove(list, indices) {
    const count = root.SigK.pageListTarget.pageCount();
    const targets = pagePlan().normalizeIndices(indices, count);
    if (targets.length === 0 || root.SigK.confirmPageDelete.isOpen())
      return false;
    const all = targets.length >= count;
    const shot = snapshot(list);
    const ok = await root.SigK.confirmPageDelete.ask({ count: targets.length, page: targets[0] + 1, all });
    if (!ok || all || !unchanged(shot))
      return false;
    return removeNow(list, targets);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageListCommands = { mosaicRefusal, canCut, copy, cut, paste, remove };
})(typeof window !== 'undefined' ? window : globalThis);
