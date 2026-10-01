(function (root) {
  'use strict';

  // 選んでいる書き込みの鍵の並び（spec-4b-3a 確定事項A・K・L）。純関数だけを持つ。
  //
  // 並びは選んだ順で、最後が「主」（枠の主・右パネルの主の値・一覧で見せる行）。鍵は entry.ref ?? entry.id。
  // 並びの書き込みはいつも同じページにある（決定52 ②）。ページは呼ぶ側が pageOf(key) で教える。

  function unique(keys) {
    return [...new Set(keys.filter((key) => typeof key === 'string' && key !== ''))];
  }

  // key を並びの最後（主）に置く。すでにあれば最後へ動かす。
  function withKey(keys, key) {
    return [...keys.filter((each) => each !== key), key];
  }

  function withoutKey(keys, key) {
    return keys.filter((each) => each !== key);
  }

  function toggled(keys, key) {
    return keys.includes(key) ? withoutKey(keys, key) : withKey(keys, key);
  }

  // 並びに more を足す（more の順のまま後ろへ。最後に足したものが主）。
  function merged(keys, more) {
    return more.reduce((acc, key) => withKey(acc, key), unique(keys));
  }

  // 同じページの中だけで足す。並びの主と別のページの鍵なら、その 1 件だけの並びに替える（決定52 ②）。
  function onOnePage(keys, key, pageOf) {
    const primary = keys.at(-1);
    if (primary === undefined || pageOf(primary) !== pageOf(key))
      return [key];
    return withKey(keys, key);
  }

  // 一覧の Shift＋クリック（確定事項K2）。rowKeys は一覧の行の鍵（上から）。起点 anchor から key までの行のうち、
  // 起点と同じページのものを、起点の側から並べて返す（最後が key）。起点が一覧に無いか、key が起点と別のページなら key だけ。
  function rangeOf(rowKeys, anchor, key, pageOf) {
    const from = rowKeys.indexOf(anchor);
    const to = rowKeys.indexOf(key);
    if (from < 0 || to < 0 || pageOf(anchor) !== pageOf(key))
      return [key];
    const page = pageOf(anchor);
    const span = from <= to ? rowKeys.slice(from, to + 1) : rowKeys.slice(to, from + 1).reverse();
    return span.filter((each) => pageOf(each) === page);
  }

  // 同じ鍵の集まりか（順は見ない）。
  function sameKeys(a, b) {
    if (a.length !== b.length)
      return false;
    const set = new Set(a);
    return b.every((key) => set.has(key));
  }

  // 履歴の世代に残す形（確定事項L1）。0 件なら null、1 件なら鍵の文字列、2 件以上なら写した配列。
  function annotKeys(keys) {
    if (keys.length === 0)
      return null;
    return keys.length === 1 ? keys[0] : [...keys];
  }

  // annotKeys の逆。null・文字列・配列を鍵の並びに戻す。
  function keysOf(annot) {
    if (annot === null || annot === undefined)
      return [];
    return Array.isArray(annot) ? unique(annot) : unique([annot]);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationSelection = { unique, withKey, withoutKey, toggled, merged, onOnePage, rangeOf, sameKeys, annotKeys, keysOf };
})(typeof window !== 'undefined' ? window : globalThis);
