(function (root) {
  'use strict';

  // ツールを実行する前の、保存していない帯の確かめ（spec-2-5 確定事項F1〜F4。決定80 ⑥㉜）。各ツールの run() が、実行中の印を
  // 立てた直後（保存ダイアログより前）に呼ぶ。
  //
  // 対象の帯に保存していない変更が無ければ、そのまま進む。あれば確認の窓を出し、
  //   ［キャンセル］            → 実行しない
  //   ［保存せずに実行］        → そのまま進む（保存してある中身で作る）
  //   ［上書き保存してから実行］ → 対象の帯を帯の順に 1 本ずつ前に出して上書き保存し、全部済んだら元の帯へ戻して進む。
  //                               1 本でも失敗・取りやめなら、その帯を選んだままにして実行しない（どの帯かが見えるように）。

  const NOTE_ENCRYPTED = 'パスワード付きの PDF は上書き保存できないので、［上書き保存してから実行］は使えません。';

  const tabs = () => root.SigK.tabs;

  // 対象のタブを帯の順に 1 本ずつ上書き保存する。全部保存できたら元の帯へ戻して true。
  async function saveTabs(ids) {
    const previous = tabs().activeId();
    const order = tabs().list().map((tab) => tab.id).filter((id) => ids.includes(id));
    for (const id of order) {
      tabs().activate(id);
      const result = await root.SigK.save.saveActive();
      if (result?.ok !== true)
        return false;
    }
    if (previous !== null && tabs().list().some((tab) => tab.id === previous))
      tabs().activate(previous);
    return true;
  }

  // tabIds は実行の対象の帯。{ go, saved } を返す（go が false なら実行しない）。
  // canRunUnsaved(tabId) が false の帯が 1 本でもあれば［保存せずに実行］を押せなくし、runNote でその理由を添える
  // （分割で、ページの並べ替え・削除・差し込みを保存していないとき。spec-2-5 確定事項F3・G7）。
  async function confirmUnsaved(tabIds, { canRunUnsaved = () => true, runNote = null } = {}) {
    const dirty = (tabIds ?? []).filter((id) => tabs().isDirty(id));
    if (dirty.length === 0)
      return { go: true, saved: false };
    const named = new Map(tabs().list().map((tab) => [tab.id, tab]));
    const entries = dirty.map((id) => ({ name: named.get(id)?.name ?? '', counts: root.SigK.unsavedChanges.count(tabs().peek(id)) }));
    const encrypted = dirty.some((id) => tabs().peek(id)?.file?.encrypted === true);
    const canRun = dirty.every((id) => canRunUnsaved(id));
    const notes = [encrypted ? NOTE_ENCRYPTED : null, canRun ? null : runNote].filter((note) => note !== null);
    const dialog = root.SigK.confirmUnsavedRun;
    const answer = await dialog.ask({ entries, canSave: !encrypted, canRun, note: notes.length === 0 ? null : notes.join('') });
    if (answer === dialog.RUN)
      return { go: true, saved: false };
    if (answer !== dialog.SAVE)
      return { go: false, saved: false };
    const saved = await saveTabs(dirty);
    return { go: saved, saved };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.runGuard = { NOTE_ENCRYPTED, confirmUnsaved, saveTabs };
})(typeof window !== 'undefined' ? window : globalThis);
