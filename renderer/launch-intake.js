(function (root) {
  'use strict';

  // 右クリックの束を一覧へ入れるときの決まり（spec-5-1 確定事項15〜18）。結合と画像→PDF が使い、
  // 束の控え（帯を束につき 1 回にする）は分割と `open` も使う。DOM に触れない。
  //
  // 右クリックで N 個選ぶと、要求は 1 件ずつ、エクスプローラーの並びとは限らない順で届く
  // （事前調査 A3。50 回中 8 回崩れた）。そこで束の中はファイル名の順に並べ直し、その旨を
  // 帯で 1 回だけ知らせる（論点2）。

  const NOTE_NAME_ORDER = 'ファイル名の順に並べました。エクスプローラーの並びと違うときは、ドラッグで入れ替えてください。';

  // 数字は数の大きさで並べ、大文字と小文字・全角と半角は区別しない（エクスプローラーの名前順に近い）。
  const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

  function baseName(filePath) {
    return String(filePath ?? '').split(/[\\/]/).pop();
  }

  // ファイル名（拡張子を含む）で比べ、同じならパス全体で決める（確定事項15）。
  function compareNames(a, b) {
    return collator.compare(baseName(a), baseName(b)) || collator.compare(String(a ?? ''), String(b ?? ''));
  }

  // 束の行を入れる位置（確定事項16）。rows は { path, batch } の並び。同じ束の行のうち、
  // 名前が後ろになる最初の行の前へ入れ、無ければ同じ束の最後の行の後ろへ入れる。
  // 同じ束の行がまだ無ければ一覧の末尾。
  function insertAt(rows, batchId, filePath) {
    let last = -1;
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index].batch !== batchId)
        continue;
      if (compareNames(filePath, rows[index].path) < 0)
        return index;
      last = index;
    }
    return last === -1 ? rows.length : last + 1;
  }

  // 束の最初の要求で、一覧を置き換えるか後ろに足すか（確定事項18）。実行済み＝最後の実行が
  // 成功し、その後に一覧を変えていない。
  function planIntake({ count, executed }) {
    return count > 0 && executed === true ? 'replace' : 'append';
  }

  // 束の控え。enter(batch) は { id, starts } を返す。印の無い呼び出しは 1 件だけの新しい束、
  // 知らない束の途中（先頭を見ていない）は始まりとみなす。once(key) は束につき 1 回だけ真。
  function createBatchTracker() {
    let current = null;
    let shown = new Set();
    let solo = 0;

    function enter(batch) {
      const known = batch !== null && typeof batch === 'object' && batch.id !== undefined;
      const id = known ? batch.id : `solo-${(solo += 1)}`;
      const starts = !known || batch.first === true || id !== current;
      if (starts) {
        current = id;
        shown = new Set();
      }
      return { id, starts };
    }

    function once(key) {
      if (shown.has(key))
        return false;
      shown.add(key);
      return true;
    }

    return { enter, once };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.launchIntake = { NOTE_NAME_ORDER, compareNames, insertAt, planIntake, createBatchTracker };
})(typeof window !== 'undefined' ? window : globalThis);
