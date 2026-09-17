(function (root) {
  'use strict';

  // 注釈の状態の純粋層（spec-4-1 確定事項16・17・19、spec-4-2 確定事項15〜18、spec-4-3 確定事項14〜18）。
  // DOM にも pdf.js にも触れない。1 件の形（種類・検証・写し・比較・保存の形）は
  // annotation-entry.js が持ち、ここは集まりの操作を持つ。
  //
  // 状態は plan と同じく「ファイルとの差分」で持つ:
  //   annots = { added: [...], removed: [...] }
  //   added[]   … 自前で付けた注釈（annotation-entry.js の形）
  //   removed[] … ファイルにあった注釈のうち消したものの ref（"86R"。pdf.js の id）
  //
  // ファイルにあった注釈そのもの（imported）はここに入れない。履歴に積むのは
  // 編集だけで、ファイルの中身は編集ではないからである（確定事項17）。
  // 読み込んだ注釈を変えるのは「元を removed に足し、写しを added に足す」で表す。

  let seq = 0;

  function entryModule() {
    return root.SigK.annotationEntry;
  }

  // id は保存の /NM にもなる。時刻と連番で、同じセッションの中で重ならなければよい。
  function newId() {
    seq += 1;
    return `sigk-${Date.now().toString(36)}-${seq}`;
  }

  function createAnnots() {
    return { added: [], removed: [] };
  }

  function cloneAnnots(annots) {
    return {
      added: (annots?.added ?? []).map(entryModule().copyEntry),
      removed: [...(annots?.removed ?? [])],
    };
  }

  // 操作した回数では決めない。付けて消したら dirty ではない。
  function sameAnnots(a, b) {
    const addedA = a?.added ?? [];
    const addedB = b?.added ?? [];
    const removedA = a?.removed ?? [];
    const removedB = b?.removed ?? [];
    if (addedA.length !== addedB.length || removedA.length !== removedB.length)
      return false;
    return addedA.every((entry, index) => entryModule().sameEntry(entry, addedB[index]))
      && removedA.every((ref, index) => ref === removedB[index]);
  }

  // 付ける。id が無ければ振る。形が違えば何もしない（呼び出し側の不具合）。
  function addAnnot(annots, entry) {
    if (!entryModule().validEntry(entry))
      return annots;
    const next = cloneAnnots(annots);
    next.added.push(entryModule().copyEntry({ opacity: 1, ...entry, id: entry.id ?? newId() }));
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

  // 欄を変える（色・本文・大きさ・箱・線幅・点列）。自前のものは書き換え、読み込んだものは消して
  // 写しを足す（写しは自前の注釈になり、保存で /AP ごと書き直される）。
  function updateAnnot(annots, target, patch) {
    const kind = target?.kind ?? (annots?.added ?? []).find((entry) => entry.id === target?.id)?.kind;
    const picked = entryModule().pickPatch(patch, kind);
    if (picked === null)
      return annots;
    if (typeof target?.ref === 'string') {
      const copy = { ...target, ...picked, id: newId() };
      delete copy.ref;
      return addAnnot(removeAnnot(annots, target), copy);
    }
    const next = cloneAnnots(annots);
    next.added = next.added.map((entry) => (entry.id === target?.id ? entryModule().copyEntry({ ...entry, ...picked }) : entry));
    return next;
  }

  // 色を変える。updateAnnot の色だけの形（塊①からの互換）。
  function recolorAnnot(annots, target, color) {
    return updateAnnot(annots, target, { color });
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

  function toSaveSpec(annots) {
    return {
      add: (annots?.added ?? []).map(entryModule().toSaveEntry),
      remove: [...(annots?.removed ?? [])],
    };
  }

  function isEmpty(annots) {
    return (annots?.added ?? []).length === 0 && (annots?.removed ?? []).length === 0;
  }

  const entry = root.SigK?.annotationEntry ?? {};
  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationState = {
    // 種類の一覧と判定は annotation-entry.js のものを同じ名前で再公開する（塊①②からの互換）。
    KINDS: entry.KINDS,
    MARKUP_KINDS: entry.MARKUP_KINDS,
    SHAPE_KINDS: entry.SHAPE_KINDS,
    PATH_KINDS: entry.PATH_KINDS,
    ROTATIONS: entry.ROTATIONS,
    isKind: entry.isKind,
    isMarkupKind: entry.isMarkupKind,
    isShapeKind: entry.isShapeKind,
    isPathKind: entry.isPathKind,
    isDrawnKind: entry.isDrawnKind,
    newId,
    createAnnots,
    cloneAnnots,
    sameAnnots,
    addAnnot,
    removeAnnot,
    updateAnnot,
    recolorAnnot,
    annotsOnPage,
    findAnnot,
    toSaveSpec,
    isEmpty,
  };
})(typeof window !== 'undefined' ? window : globalThis);
