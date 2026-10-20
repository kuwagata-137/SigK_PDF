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
  // 進むときは、帯のファイルがタブで開いたあとでほかのアプリに書き換えられていないかも照らし、書き換えられていたら止める（決定81 ⑫。
  // spec-6-1 確定事項C-9。分割と同じ。ツールは保存してある中身を読み直すので、帯の絵と違う中身に古いページの番号を当てないため）。

  const NOTE_ENCRYPTED = 'パスワード付きの PDF は上書き保存できないので、［上書き保存してから実行］は使えません。';

  const tabs = () => root.SigK.tabs;

  // 止めたときの文。verb は各ツールの「〜を中止しました」と同じ言い方（結合・分割・透かしの追加・フラット化・画像にするの）。
  function changedText(name, verb) {
    return `「${name}」がほかのアプリで書き換えられていたので、${verb}を止めました。タブを閉じて開き直してから、もう一度実行してください。`;
  }

  // 帯のタブで開いたときのファイルの印（大きさと更新時刻）。ワーカーにも渡して、読む前に照らさせる。
  function expectOf(tabId) {
    return root.SigK.save.signatureOf(tabs().peek(tabId)?.file);
  }

  // 書き換えられた帯の名前。どれも書き換えられていなければ null。印を読めない（ファイルが無くなった）ものも書き換えられたとみなす（分割と同じ）。
  async function changedName(tabIds) {
    for (const tab of tabs().list().filter((entry) => tabIds.includes(entry.id))) {
      const expect = expectOf(tab.id);
      if (expect === null || typeof tab.path !== 'string')
        continue;
      const now = await root.pdfAPI?.stat?.(tab.path);
      if (now?.ok !== true || now.size !== expect.size || now.mtimeMs !== expect.mtimeMs)
        return tab.name;
    }
    return null;
  }

  // ワーカーが読む前に書き換えに気づいた（{ sourceChanged }）結果を、止めたときの文に替えて通知バーに出す。それ以外は null。
  function changedResult(result, name, verb) {
    if (result?.sourceChanged !== true)
      return null;
    const error = changedText(name, verb);
    root.SigK.viewBanner.show(error);
    return { ...result, error };
  }

  // 進む前の書き換えの照らし。verb が無ければ照らさない。書き換えられていたら通知バーに出して { go: false, saved, error }。
  async function goUnlessChanged(tabIds, verb, saved) {
    const name = typeof verb === 'string' ? await changedName(tabIds ?? []) : null;
    if (name === null)
      return { go: true, saved };
    const error = changedText(name, verb);
    root.SigK.viewBanner.show(error);
    return { go: false, saved, error };
  }

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

  // tabIds は実行の対象の帯。{ go, saved } を返す（go が false なら実行しない。書き換えで止めたときは error も）。
  // canRunUnsaved(tabId) が false の帯が 1 本でもあれば［保存せずに実行］を押せなくし、runNote でその理由を添える
  // （分割で、ページの並べ替え・削除・差し込みを保存していないとき。spec-2-5 確定事項F3・G7）。verb は書き換えで止めたときの文に使う。
  async function confirmUnsaved(tabIds, { canRunUnsaved = () => true, runNote = null, verb = null } = {}) {
    const dirty = (tabIds ?? []).filter((id) => tabs().isDirty(id));
    if (dirty.length === 0)
      return goUnlessChanged(tabIds, verb, false);
    const named = new Map(tabs().list().map((tab) => [tab.id, tab]));
    const entries = dirty.map((id) => ({ name: named.get(id)?.name ?? '', counts: root.SigK.unsavedChanges.count(tabs().peek(id)) }));
    const encrypted = dirty.some((id) => tabs().peek(id)?.file?.encrypted === true);
    const canRun = dirty.every((id) => canRunUnsaved(id));
    const notes = [encrypted ? NOTE_ENCRYPTED : null, canRun ? null : runNote].filter((note) => note !== null);
    const dialog = root.SigK.confirmUnsavedRun;
    const answer = await dialog.ask({ entries, canSave: !encrypted, canRun, note: notes.length === 0 ? null : notes.join('') });
    if (answer === dialog.RUN)
      return goUnlessChanged(tabIds, verb, false);
    if (answer !== dialog.SAVE)
      return { go: false, saved: false };
    // 上書き保存すると開き直すので、印は保存したファイルのものになる（保存はほかのアプリの書き換えを聞いてから書く。spec-6-1 確定事項C-4）。
    const saved = await saveTabs(dirty);
    return saved ? goUnlessChanged(tabIds, verb, true) : { go: false, saved };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.runGuard = { NOTE_ENCRYPTED, changedResult, changedText, confirmUnsaved, expectOf, saveTabs };
})(typeof window !== 'undefined' ? window : globalThis);
