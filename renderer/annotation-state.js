(function (root) {
  'use strict';

  // 注釈の状態の純粋層（spec-4-1 確定事項16・17・19）。DOM にも pdf.js にも触れない。
  //
  // 状態は plan と同じく「ファイルとの差分」で持つ:
  //   annots = { added: [...], removed: [...] }
  //   added[]   … 自前で付けた注釈 { id, src, kind, color, opacity, quads, rect, text }
  //   removed[] … ファイルにあった注釈のうち消したものの ref（"86R"。pdf.js の id）
  //
  // ファイルにあった注釈そのもの（imported）はここに入れない。履歴に積むのは
  // 編集だけで、ファイルの中身は編集ではないからである（確定事項17）。
  // 読み込んだ注釈の色を変えるのは「元を removed に足し、写しを added に足す」で表す。

  const KINDS = Object.freeze(['highlight', 'underline', 'strikeout']);

  let seq = 0;

  function isKind(kind) {
    return KINDS.includes(kind);
  }

  // id は保存の /NM にもなる。時刻と連番で、同じセッションの中で重ならなければよい。
  function newId() {
    seq += 1;
    return `sigk-${Date.now().toString(36)}-${seq}`;
  }

  function createAnnots() {
    return { added: [], removed: [] };
  }

  function copyEntry(entry) {
    return {
      id: entry.id,
      src: entry.src,
      kind: entry.kind,
      color: entry.color,
      opacity: entry.opacity,
      quads: entry.quads.map((quad) => [...quad]),
      rect: [...entry.rect],
      text: entry.text ?? '',
    };
  }

  function cloneAnnots(annots) {
    return {
      added: (annots?.added ?? []).map(copyEntry),
      removed: [...(annots?.removed ?? [])],
    };
  }

  // 操作した回数では決めない。付けて消したら dirty ではない。
  // 四角の中身までは比べない（同じ id で四角だけ変わる操作は無い）。
  function sameAnnots(a, b) {
    const addedA = a?.added ?? [];
    const addedB = b?.added ?? [];
    const removedA = a?.removed ?? [];
    const removedB = b?.removed ?? [];
    if (addedA.length !== addedB.length || removedA.length !== removedB.length)
      return false;
    return addedA.every((entry, index) =>
      entry.id === addedB[index].id && entry.color === addedB[index].color
      && entry.kind === addedB[index].kind && entry.src === addedB[index].src)
      && removedA.every((ref, index) => ref === removedB[index]);
  }

  function validEntry(entry) {
    return Number.isInteger(entry?.src) && entry.src >= 0 && isKind(entry.kind)
      && typeof entry.color === 'string' && Array.isArray(entry.quads) && entry.quads.length > 0
      && entry.quads.every((quad) => Array.isArray(quad) && quad.length === 8 && quad.every(Number.isFinite))
      && Array.isArray(entry.rect) && entry.rect.length === 4;
  }

  // 付ける。id が無ければ振る。形が違えば何もしない（呼び出し側の不具合）。
  function addAnnot(annots, entry) {
    if (!validEntry(entry))
      return annots;
    const next = cloneAnnots(annots);
    next.added.push(copyEntry({ opacity: 1, ...entry, id: entry.id ?? newId() }));
    return next;
  }

  // 消す。自前のものは added から外し、読み込んだものは ref を removed に足す。
  function removeAnnot(annots, target) {
    const next = cloneAnnots(annots);
    if (typeof target?.ref === 'string') {
      if (!next.removed.includes(target.ref))
        next.removed.push(target.ref);
      return next;
    }
    next.added = next.added.filter((entry) => entry.id !== target?.id);
    return next;
  }

  // 色を変える。自前のものは書き換え、読み込んだものは消して写しを足す
  // （写しは自前の注釈になり、保存で /AP ごと書き直される）。
  function recolorAnnot(annots, target, color) {
    if (typeof color !== 'string')
      return annots;
    if (typeof target?.ref === 'string') {
      const copy = { ...target, color, id: newId() };
      delete copy.ref;
      return addAnnot(removeAnnot(annots, target), copy);
    }
    const next = cloneAnnots(annots);
    for (const entry of next.added) {
      if (entry.id === target?.id)
        entry.color = color;
    }
    return next;
  }

  // ページ src に描くもの。読み込んだものが先（下）、自前のものが後（上）。
  function annotsOnPage(annots, imported, src) {
    const kept = (imported?.[src] ?? []).filter((entry) => !(annots?.removed ?? []).includes(entry.ref));
    const own = (annots?.added ?? []).filter((entry) => entry.src === src);
    return [...kept, ...own];
  }

  // id（自前）か ref（読み込み）で引く。
  function findAnnot(annots, imported, key) {
    const own = (annots?.added ?? []).find((entry) => entry.id === key);
    if (own !== undefined)
      return own;
    for (const list of Object.values(imported ?? {})) {
      const found = list.find((entry) => entry.ref === key);
      if (found !== undefined && !(annots?.removed ?? []).includes(key))
        return found;
    }
    return null;
  }

  // ワーカーへ渡す形（spec-4-1 確定事項22）。id と text は要らない。
  function toSaveSpec(annots) {
    return {
      add: (annots?.added ?? []).map(({ src, kind, color, opacity, quads, rect }) => ({
        src, kind, color, opacity, quads: quads.map((quad) => [...quad]), rect: [...rect],
      })),
      remove: [...(annots?.removed ?? [])],
    };
  }

  function isEmpty(annots) {
    return (annots?.added ?? []).length === 0 && (annots?.removed ?? []).length === 0;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationState = {
    KINDS,
    isKind,
    newId,
    createAnnots,
    cloneAnnots,
    sameAnnots,
    addAnnot,
    removeAnnot,
    recolorAnnot,
    annotsOnPage,
    findAnnot,
    toSaveSpec,
    isEmpty,
  };
})(typeof window !== 'undefined' ? window : globalThis);
