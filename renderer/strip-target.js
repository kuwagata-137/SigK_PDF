(function (root) {
  'use strict';

  // 選んでいる帯（＝映しているタブ）を、1 本を対象にするツールの対象にする（spec-2-5 確定事項E3〜E5。PDF→画像・透かし・フラット化）。
  // 今までの「対象」の欄（source-picker.js）の代わり。対象は毎回タブから組むので、帯を押せば対象が替わる。
  //
  // 対象は { tabId, path, name, pageCount, blocked, note, pending, ...ツールごとの欄 }（source-picker.js と同じ形。計画の部品がそのまま読む）。
  // ページ数と寸法はファイルの中身（basePages）。ツールはこれまでどおりファイルを読み直して作る（保存していない変更は実行の前に確かめる）。
  // 使えない帯（開けなかった・パスワード付き・名前の無い新しい帯）は blocked に理由を入れる。sync() は対象が替わったときだけ onChange を呼ぶ。

  const EMPTY = 'PDF を開くと、選んでいる帯が対象になります。';

  // encryptedError は「画像にできません」のような、パスワード付きのときの述語。fieldsOf(peeked) はツールごとの欄。
  function create({ encryptedError, fieldsOf = () => ({}), onChange = () => {} }) {
    let lastKey = null;

    function blockedOf(tab, peeked) {
      if (peeked === null || peeked.doc === undefined)
        return `「${tab.name}」は開けなかったので、ほかの帯を選んでください。`;
      if (typeof tab.path !== 'string')
        return `「${tab.name}」は、保存すると使えます。`;
      if (peeked.file?.encrypted === true)
        return `「${tab.name}」はパスワード付きなので${encryptedError}。ほかの帯を選んでください。`;
      return null;
    }

    function source() {
      const tabs = root.SigK.tabs;
      const tab = tabs?.list().find((entry) => entry.active) ?? null;
      if (tab === null)
        return null;
      const peeked = tabs.peek(tab.id);
      const blocked = blockedOf(tab, peeked);
      const base = { tabId: tab.id, path: tab.path, name: tab.name, blocked, note: null, pending: false };
      if (blocked !== null)
        return { ...base, pageCount: null };
      return { ...base, pageCount: peeked.basePages.length, ...fieldsOf(peeked) };
    }

    // 対象の鍵。タブ・パス・読み込んだ文書が同じなら同じ（保存して読み直すと文書が替わる）。
    function keyOf() {
      const tabs = root.SigK.tabs;
      const id = tabs?.activeId() ?? null;
      const peeked = id === null ? null : tabs.peek(id);
      return { id, path: tabs?.list().find((entry) => entry.id === id)?.path ?? null, doc: peeked?.doc ?? null };
    }

    function sync() {
      const key = keyOf();
      if (lastKey !== null && lastKey.id === key.id && lastKey.path === key.path && lastKey.doc === key.doc)
        return false;
      lastKey = key;
      onChange(source());
      return true;
    }

    // ツールの右の欄の状態の文（対象が無い・使えないとき）。使えれば null。
    function stateText() {
      const current = source();
      return current === null ? EMPTY : current.blocked;
    }

    return { source, sync, stateText, tabId: () => source()?.tabId ?? null };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripTarget = { EMPTY, create };
})(typeof window !== 'undefined' ? window : globalThis);
