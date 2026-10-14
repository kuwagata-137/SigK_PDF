(function (root) {
  'use strict';

  // 結合のチェックと範囲の控え（spec-2-5 確定事項E2・E7。決定80 ⑳㉛）。DOM に触れない。
  //
  // 結合する PDF は帯（＝タブ）で、並びはタブの並び。ここはタブの id ごとに「チェックを入れたか」と「範囲の欄の文字」だけを持つ。
  // 初めて見るタブは既定でチェックを入れる（帯を足したとき・ツールで作った PDF の新しい帯も。PR-2 の起草者の判断）。閉じたタブの控えは捨てる。

  function create() {
    const picks = new Map();

    function entry(tabId) {
      if (!picks.has(tabId))
        picks.set(tabId, { checked: true, range: '' });
      return picks.get(tabId);
    }

    // 今のタブの id に合わせる。消えたタブを捨て、新しいタブを足す。
    function sync(tabIds) {
      const present = new Set(tabIds);
      for (const tabId of [...picks.keys()]) {
        if (!present.has(tabId))
          picks.delete(tabId);
      }
      tabIds.forEach(entry);
    }

    return {
      sync,
      isChecked: (tabId) => entry(tabId).checked,
      setChecked: (tabId, on) => { entry(tabId).checked = on === true; },
      rangeOf: (tabId) => entry(tabId).range,
      setRange: (tabId, text) => { entry(tabId).range = String(text ?? ''); },
      // 起動からの結合の束の最初（㉛）。前から開いていた帯のチェックを外す。
      uncheckAll: () => { for (const value of picks.values()) value.checked = false; },
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.mergePicks = { create };
})(typeof window !== 'undefined' ? window : globalThis);
