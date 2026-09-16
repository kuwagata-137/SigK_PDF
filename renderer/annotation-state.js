(function (root) {
  'use strict';

  // 注釈の状態の純粋層（spec-4-1 確定事項16・17・19、spec-4-2 確定事項15〜18）。
  // DOM にも pdf.js にも触れない。
  //
  // 状態は plan と同じく「ファイルとの差分」で持つ:
  //   annots = { added: [...], removed: [...] }
  //   added[]   … 自前で付けた注釈 { id, src, kind, color, opacity, quads, rect, text }
  //               テキスト（kind: 'text'）はさらに { fontSize, rotation }。quads は箱の四角 1 つ
  //   removed[] … ファイルにあった注釈のうち消したものの ref（"86R"。pdf.js の id）
  //
  // ファイルにあった注釈そのもの（imported）はここに入れない。履歴に積むのは
  // 編集だけで、ファイルの中身は編集ではないからである（確定事項17）。
  // 読み込んだ注釈を変えるのは「元を removed に足し、写しを added に足す」で表す。

  const MARKUP_KINDS = Object.freeze(['highlight', 'underline', 'strikeout']);
  const KINDS = Object.freeze([...MARKUP_KINDS, 'text']);
  const ROTATIONS = Object.freeze([0, 90, 180, 270]);

  // updateAnnot で書き換えられる欄。
  const PATCH_FIELDS = Object.freeze(['color', 'text', 'fontSize', 'rect', 'quads']);

  let seq = 0;

  function isKind(kind) {
    return KINDS.includes(kind);
  }

  function isMarkupKind(kind) {
    return MARKUP_KINDS.includes(kind);
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
    const copy = {
      id: entry.id,
      src: entry.src,
      kind: entry.kind,
      color: entry.color,
      opacity: entry.opacity,
      quads: entry.quads.map((quad) => [...quad]),
      rect: [...entry.rect],
      text: entry.text ?? '',
    };
    if (entry.kind === 'text') {
      copy.fontSize = entry.fontSize;
      copy.rotation = entry.rotation;
    }
    return copy;
  }

  function cloneAnnots(annots) {
    return {
      added: (annots?.added ?? []).map(copyEntry),
      removed: [...(annots?.removed ?? [])],
    };
  }

  function sameNumbers(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  // 1 つの注釈が同じか。id は据え置きで欄ごとに比べる（移動と編集で同じ id の四角が変わる）。
  function sameEntry(a, b) {
    return a.id === b.id && a.src === b.src && a.kind === b.kind && a.color === b.color
      && a.opacity === b.opacity && a.text === b.text && a.fontSize === b.fontSize
      && a.rotation === b.rotation && sameNumbers(a.rect, b.rect);
  }

  // 操作した回数では決めない。付けて消したら dirty ではない。
  function sameAnnots(a, b) {
    const addedA = a?.added ?? [];
    const addedB = b?.added ?? [];
    const removedA = a?.removed ?? [];
    const removedB = b?.removed ?? [];
    if (addedA.length !== addedB.length || removedA.length !== removedB.length)
      return false;
    return addedA.every((entry, index) => sameEntry(entry, addedB[index]))
      && removedA.every((ref, index) => ref === removedB[index]);
  }

  function isQuad(quad) {
    return Array.isArray(quad) && quad.length === 8 && quad.every(Number.isFinite);
  }

  function validText(text) {
    return typeof text === 'string' && text.trim() !== '';
  }

  function validFontSize(fontSize) {
    return Number.isFinite(fontSize) && fontSize > 0;
  }

  // テキストは本文が空でなく、大きさが正で、回転が 4 方向のどれかで、箱の四角が 1 つ。
  function validTextFields(entry) {
    return validText(entry.text) && validFontSize(entry.fontSize)
      && ROTATIONS.includes(entry.rotation) && entry.quads.length === 1;
  }

  function validEntry(entry) {
    const shape = Number.isInteger(entry?.src) && entry.src >= 0 && isKind(entry.kind)
      && typeof entry.color === 'string' && Array.isArray(entry.quads) && entry.quads.length > 0
      && entry.quads.every(isQuad) && Array.isArray(entry.rect) && entry.rect.length === 4;
    if (!shape)
      return false;
    return entry.kind === 'text' ? validTextFields(entry) : true;
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

  function validPatchValue(field, value) {
    switch (field) {
      case 'color': return typeof value === 'string';
      case 'text': return validText(value);
      case 'fontSize': return validFontSize(value);
      case 'rect': return Array.isArray(value) && value.length === 4;
      case 'quads': return Array.isArray(value) && value.length > 0 && value.every(isQuad);
      default: return false;
    }
  }

  // patch のうち書き換えてよい欄だけを残す。形の崩れる値が 1 つでもあれば null。
  function pickPatch(patch) {
    const picked = {};
    for (const field of PATCH_FIELDS) {
      if (!(field in (patch ?? {})))
        continue;
      if (!validPatchValue(field, patch[field]))
        return null;
      picked[field] = patch[field];
    }
    return Object.keys(picked).length === 0 ? null : picked;
  }

  // 欄を変える（色・本文・大きさ・箱）。自前のものは書き換え、読み込んだものは消して
  // 写しを足す（写しは自前の注釈になり、保存で /AP ごと書き直される）。
  function updateAnnot(annots, target, patch) {
    const picked = pickPatch(patch);
    if (picked === null)
      return annots;
    if (typeof target?.ref === 'string') {
      const copy = { ...target, ...picked, id: newId() };
      delete copy.ref;
      return addAnnot(removeAnnot(annots, target), copy);
    }
    const next = cloneAnnots(annots);
    next.added = next.added.map((entry) => (entry.id === target?.id ? copyEntry({ ...entry, ...picked }) : entry));
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

  // ワーカーへ渡す形（spec-4-1 確定事項22・spec-4-2 確定事項18）。id は要らない。
  // マークアップは四角の並び、テキストは箱と本文・大きさ・回転（四角は箱から作れるので落とす）。
  function toSaveEntry(entry) {
    const { src, kind, color, opacity, quads, rect, text, fontSize, rotation } = entry;
    if (kind === 'text')
      return { src, kind, color, opacity, rect: [...rect], text, fontSize, rotation };
    return { src, kind, color, opacity, quads: quads.map((quad) => [...quad]), rect: [...rect] };
  }

  function toSaveSpec(annots) {
    return {
      add: (annots?.added ?? []).map(toSaveEntry),
      remove: [...(annots?.removed ?? [])],
    };
  }

  function isEmpty(annots) {
    return (annots?.added ?? []).length === 0 && (annots?.removed ?? []).length === 0;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationState = {
    KINDS,
    MARKUP_KINDS,
    ROTATIONS,
    isKind,
    isMarkupKind,
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
