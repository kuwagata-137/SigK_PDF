(function (root) {
  'use strict';

  // 説明の吹き出しの文を引く入れ物（spec-2-5 J1・J2・J5・J14）。DOM に触れない（要素は dataset だけを読み書きする）。
  // 文の表そのものは tip-content-view.js・tip-content-edit.js・tip-content-tools.js が add で足す。この順に読み込む。
  //
  //   鍵   … 要素の data-tip に書く文字列（例 'bar.open'）。
  //   Entry … { name: 名前, desc?: 何ができるか, keys?: ['Ctrl+S'], keysNote?: '選んでいる帯' }。キーの無い鍵は keys を持たない。
  //   値   … Entry か、(node) => Entry。関数は出す瞬間に呼ぶ（要素の data-tip-file や、今開いているファイルの様子で文を替えるため）。
  //
  // 鍵 text は組み込み。表に無い文（ファイル名とフルパス・色の名前など）を、要素ごとに text() で付ける。
  // resolve が返す Entry と keys の配列は凍らせてある（呼び手が書き換えて、次に出す文まで変えてしまわないため）。読むだけにする。

  const TEXT_KEY = 'text';
  const table = new Map();

  // 鍵 text の中身は、要素の data-tip-name・data-tip-desc。説明が無いときは空の文字にする。
  table.set(TEXT_KEY, (node) => ({ name: node.dataset.tipName ?? '', desc: node.dataset.tipDesc ?? '' }));

  // Entry と keys の配列を凍らせて、その Entry を返す（凍らせ済みでも構わない）。
  function freezeEntry(entry) {
    if (Array.isArray(entry.keys))
      Object.freeze(entry.keys);
    return Object.freeze(entry);
  }

  // 文の表を足す。鍵がすでにあるときは、1 つも足さずに投げる（別のファイルの鍵とぶつかったのを黙って上書きしないため）。
  // Entry の値は足すときに凍らせる。関数の値は、返した Entry を resolve が凍らせる。
  function add(entries) {
    const keys = Object.keys(entries);
    const dup = keys.find((key) => table.has(key));
    if (dup !== undefined)
      throw new Error(`説明の吹き出しの鍵が重なっています: ${dup}`);
    for (const key of keys)
      table.set(key, typeof entries[key] === 'function' ? entries[key] : freezeEntry(entries[key]));
  }

  // 要素の data-tip の鍵の Entry。知らない鍵・鍵が無いときは null。
  function resolve(node) {
    const key = node?.dataset?.tip;
    if (!key || !table.has(key))
      return null;
    const value = table.get(key);
    return typeof value === 'function' ? freezeEntry(value(node)) : value;
  }

  // 表に無い文を要素に付ける（鍵 text）。desc が空なら data-tip-desc を消す（付け直しで前の説明を残さないため）。node を返す。
  function text(node, name, desc = '') {
    node.dataset.tip = TEXT_KEY;
    node.dataset.tipName = name;
    if (desc)
      node.dataset.tipDesc = desc;
    else
      delete node.dataset.tipDesc;
    return node;
  }

  // 足してある鍵の一覧（text を含む）。
  function keyList() {
    return [...table.keys()];
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tipContent = { add, resolve, text, keyList };
})(typeof window !== 'undefined' ? window : globalThis);
