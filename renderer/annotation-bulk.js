(function (root) {
  'use strict';

  // 選んだ書き込みに 1 件ずつ当てて、1 つの annots にまとめる（spec-4b-3a 確定事項F・G・H・I）。DOM に触れない。
  //
  // 読み込んだ書き込みは、直すと写し（自前の注釈）に替わって鍵が新しい id になる（annotation-state.updateAnnot）。そのため
  // 「元の鍵 → 新しい鍵」の対応を返し、呼ぶ側はそれで選び直す。当てられなかった（断られた・当てる値が無い）ものは元の鍵のまま。

  function state() {
    return root.SigK.annotationState;
  }

  // patchOf(entry) が返す値を 1 件ずつ当てる。null を返したものは飛ばす。{ annots, keys: Map(元の鍵 → 新しい鍵) }。
  function updateEach(annots, imported, keys, patchOf) {
    const map = new Map();
    let current = annots;
    for (const key of keys) {
      const entry = state().findAnnot(current, imported, key);
      const patch = entry === null ? null : patchOf(entry);
      const next = patch === null || patch === undefined ? current : state().updateAnnot(current, entry, patch);
      if (next === current) {
        map.set(key, key);
        continue;
      }
      map.set(key, typeof entry.ref === 'string' ? next.added.at(-1).id : key);
      current = next;
    }
    return { annots: current, keys: map };
  }

  // 全部を消す（自前のものは外し、読み込んだものは removed に足す）。
  function removeEach(annots, imported, keys) {
    let current = annots;
    for (const key of keys) {
      const entry = state().findAnnot(current, imported, key);
      if (entry !== null)
        current = state().removeAnnot(current, entry);
    }
    return current;
  }

  // 写しを delta だけずらして、ページの最前面（自前の注釈の最後）に足す（確定事項G3）。動かせる種類だけを写し、マークアップと
  // 表示のみは写さない。写しは新しい id を持ち、読み込んだ注釈の参照は写さない。{ annots, keys: 足した写しの鍵（元の順） }。
  function copyEach(annots, imported, keys, delta) {
    const moves = root.SigK.annotationMoves;
    let current = annots;
    const added = [];
    for (const key of keys) {
      const entry = state().findAnnot(current, imported, key);
      if (entry === null || entry.readonly === true || !moves.isMovable(entry))
        continue;
      const patch = moves.movedPatch(entry, delta);
      if (patch === null)
        continue;
      const copy = { ...entry, ...patch, id: undefined };
      delete copy.ref;
      const next = state().addAnnot(current, copy);
      if (next === current)
        continue;
      added.push(next.added.at(-1).id);
      current = next;
    }
    return { annots: current, keys: added };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationBulk = { updateEach, removeEach, copyEach };
})(typeof window !== 'undefined' ? window : globalThis);
