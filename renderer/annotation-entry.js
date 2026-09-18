(function (root) {
  'use strict';

  // 注釈 1 件（entry）の形を知る純粋層（spec-4-1 確定事項16・19、spec-4-2 確定事項15〜18、
  // spec-4-3 確定事項14〜18、spec-4-4 確定事項15〜19）。DOM にも pdf.js にも触れない。annotation-state.js が
  // 集まり（{ added, removed }）を扱うのに対し、ここは 1 件の種類・検証・写し・比較・保存の形を持つ。
  //
  //   共通       … { id, src, kind, color, opacity, quads, rect, text }
  //   テキスト   … さらに { fontSize, rotation }。quads は箱の四角 1 つ
  //   図形・ペン … さらに { lineWidth }。直線・矢印・ペンは { paths: [[[x, y], …], …] }（紙の座標）。
  //                quads は rect の四角 1 つ
  //   ノート     … さらに { author }。text は本文（空を許す）。rect は 20×20pt で左上が基準。quads は rect の四角 1 つ
  //
  // 読み込んだだけで直せない「表示のみ」の注釈は { ref, kind: 'other', subtype, readonly: true } の形で imported に
  // だけ現れる（annotation-import.js）。KINDS には無く、ここでは作れない。

  const MARKUP_KINDS = Object.freeze(['highlight', 'underline', 'strikeout']);
  // 「図形」の道具で描く 4 種と、点列（paths）を持つ 3 種（spec-4-3 確定事項14）。
  const SHAPE_KINDS = Object.freeze(['square', 'circle', 'line', 'arrow']);
  const PATH_KINDS = Object.freeze(['line', 'arrow', 'ink']);
  const KINDS = Object.freeze([...MARKUP_KINDS, 'text', ...SHAPE_KINDS, 'ink', 'note']);
  const ROTATIONS = Object.freeze([0, 90, 180, 270]);

  // updateAnnot で書き換えられる欄。
  const PATCH_FIELDS = Object.freeze(['color', 'text', 'fontSize', 'rect', 'quads', 'lineWidth', 'paths', 'opacity']);

  function isKind(kind) {
    return KINDS.includes(kind);
  }

  function isMarkupKind(kind) {
    return MARKUP_KINDS.includes(kind);
  }

  function isShapeKind(kind) {
    return SHAPE_KINDS.includes(kind);
  }

  function isPathKind(kind) {
    return PATH_KINDS.includes(kind);
  }

  // 図形・ペン（線幅を持つもの）。
  function isDrawnKind(kind) {
    return SHAPE_KINDS.includes(kind) || kind === 'ink';
  }

  function isNoteKind(kind) {
    return kind === 'note';
  }

  function copyPaths(paths) {
    return paths.map((path) => path.map((point) => [point[0], point[1]]));
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
    if (isDrawnKind(entry.kind))
      copy.lineWidth = entry.lineWidth;
    if (isPathKind(entry.kind))
      copy.paths = copyPaths(entry.paths);
    if (isNoteKind(entry.kind))
      copy.author = entry.author ?? '';
    return copy;
  }

  function sameNumbers(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function samePaths(a, b) {
    if (a === undefined || b === undefined)
      return a === b;
    return a.length === b.length && a.every((path, index) => path.length === b[index].length
      && path.every((point, at) => point[0] === b[index][at][0] && point[1] === b[index][at][1]));
  }

  // 1 つの注釈が同じか。id は据え置きで欄ごとに比べる（移動と編集で同じ id の四角が変わる）。
  function sameEntry(a, b) {
    return a.id === b.id && a.src === b.src && a.kind === b.kind && a.color === b.color
      && a.opacity === b.opacity && a.text === b.text && a.fontSize === b.fontSize
      && a.rotation === b.rotation && a.lineWidth === b.lineWidth && a.author === b.author && sameNumbers(a.rect, b.rect)
      && samePaths(a.paths, b.paths);
  }

  function isQuad(quad) {
    return Array.isArray(quad) && quad.length === 8 && quad.every(Number.isFinite);
  }

  function validText(text) {
    return typeof text === 'string' && text.trim() !== '';
  }

  // ノートの本文は空でもよい。作成者は文字列か無し。
  function validNoteFields(entry) {
    return typeof entry.text === 'string' && (entry.author === undefined || typeof entry.author === 'string')
      && entry.quads.length === 1;
  }

  function validOpacity(value) {
    return Number.isFinite(value) && value >= 0 && value <= 1;
  }

  function validPositive(value) {
    return Number.isFinite(value) && value > 0;
  }

  // テキストは本文が空でなく、大きさが正で、回転が 4 方向のどれかで、箱の四角が 1 つ。
  function validTextFields(entry) {
    return validText(entry.text) && validPositive(entry.fontSize)
      && ROTATIONS.includes(entry.rotation) && entry.quads.length === 1;
  }

  function validPoint(point) {
    return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  }

  // 点列は 1 本以上で、各 path が 2 点以上。直線・矢印は 1 本ちょうどで 2 点（spec-4-3 確定事項14）。
  function validPaths(kind, paths) {
    if (!Array.isArray(paths) || paths.length === 0)
      return false;
    if (!paths.every((path) => Array.isArray(path) && path.length >= 2 && path.every(validPoint)))
      return false;
    return kind === 'ink' || (paths.length === 1 && paths[0].length === 2);
  }

  // 図形・ペンは線幅が正で、箱の四角が 1 つ。点列を持つ種類はその形も見る。
  function validDrawnFields(entry) {
    if (!validPositive(entry.lineWidth) || entry.quads.length !== 1)
      return false;
    return isPathKind(entry.kind) ? validPaths(entry.kind, entry.paths) : true;
  }

  function validEntry(entry) {
    const shape = Number.isInteger(entry?.src) && entry.src >= 0 && isKind(entry.kind)
      && typeof entry.color === 'string' && Array.isArray(entry.quads) && entry.quads.length > 0
      && entry.quads.every(isQuad) && Array.isArray(entry.rect) && entry.rect.length === 4;
    if (!shape)
      return false;
    if (entry.kind === 'text')
      return validTextFields(entry);
    if (isNoteKind(entry.kind))
      return validNoteFields(entry);
    return isDrawnKind(entry.kind) ? validDrawnFields(entry) : true;
  }

  function validPatchValue(field, value, kind) {
    switch (field) {
      case 'color': return typeof value === 'string';
      case 'text': return isNoteKind(kind) ? typeof value === 'string' : validText(value);
      case 'opacity': return validOpacity(value);
      case 'fontSize': return validPositive(value);
      case 'lineWidth': return validPositive(value);
      case 'rect': return Array.isArray(value) && value.length === 4;
      case 'quads': return Array.isArray(value) && value.length > 0 && value.every(isQuad);
      case 'paths': return validPaths(kind, value);
      default: return false;
    }
  }

  // patch のうち書き換えてよい欄だけを残す。形の崩れる値が 1 つでもあれば null。
  function pickPatch(patch, kind) {
    const picked = {};
    for (const field of PATCH_FIELDS) {
      if (!(field in (patch ?? {})))
        continue;
      if (!validPatchValue(field, patch[field], kind))
        return null;
      picked[field] = patch[field];
    }
    return Object.keys(picked).length === 0 ? null : picked;
  }

  // ワーカーへ渡す形（spec-4-1 確定事項22・spec-4-2 確定事項18・spec-4-3 確定事項18・spec-4-4 確定事項19）。id は要らない。
  // マークアップは四角の並び、テキストは箱と本文・大きさ・回転、図形・ペンは箱と線幅（と点列）、ノートは箱と本文・作成者。
  // 四角は箱から作れるので落とす。
  function toSaveEntry(entry) {
    const { src, kind, color, opacity, quads, rect, text, fontSize, rotation, lineWidth, paths, author } = entry;
    if (kind === 'text')
      return { src, kind, color, opacity, rect: [...rect], text, fontSize, rotation };
    if (isNoteKind(kind))
      return { src, kind, color, opacity, rect: [...rect], text, author: author ?? '' };
    if (isDrawnKind(kind)) {
      const saved = { src, kind, color, opacity, rect: [...rect], lineWidth };
      if (isPathKind(kind))
        saved.paths = copyPaths(paths);
      return saved;
    }
    return { src, kind, color, opacity, quads: quads.map((quad) => [...quad]), rect: [...rect] };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationEntry = {
    KINDS,
    MARKUP_KINDS,
    SHAPE_KINDS,
    PATH_KINDS,
    ROTATIONS,
    PATCH_FIELDS,
    isKind,
    isMarkupKind,
    isShapeKind,
    isPathKind,
    isDrawnKind,
    isNoteKind,
    copyEntry,
    sameEntry,
    validEntry,
    pickPatch,
    toSaveEntry,
  };
})(typeof window !== 'undefined' ? window : globalThis);
