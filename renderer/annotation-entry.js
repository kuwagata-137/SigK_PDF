(function (root) {
  'use strict';

  // 注釈 1 件（entry）の形を知る純粋層（spec-4-1 確定事項16・19、spec-4-2 確定事項15〜18、
  // spec-4-3 確定事項14〜18、spec-4-4 確定事項15〜19、spec-4b-1b 確定事項16〜21・35）。DOM にも pdf.js にも触れない。
  // annotation-state.js が集まり（{ added, removed }）を扱うのに対し、ここは 1 件の種類・写し・比較・保存の形を持つ。
  // 検証と変えてよい欄は annotation-entry-rules.js、図形の見た目の欄は shape-style.js が持ち、ここから同じ名前で公開する。
  //
  //   共通       … { id, src, kind, color, opacity, quads, rect, text }
  //   テキスト   … さらに { fontSize, rotation }。quads は箱の四角 1 つ。新しい形は { width, bold, italic }（free-text-entry.js）と、
  //                四角・丸と同じ { angle }（spec-4b-4b 確定事項A1。rect は回す前の箱、quads は回した 4 隅）を持てる
  //   図形・ペン … さらに { lineWidth }。直線・矢印・ペンは { paths: [[[x, y], …], …] }（紙の座標）。矢印は { head: 'open' }
  //                （開いた矢じり。無ければ塗った三角。spec-4b-5a 確定事項4）を持てる。
  //                quads は rect の四角 1 つ。四角・丸は { fill, lineStyle }（color は null で線なし）、直線・矢印は { lineStyle }、
  //                破線は { dash }、雲形は { cloudIntensity } を持てる（shape-style.js）。四角・丸は { angle }（画面で時計回りの度。
  //                0 は持たない）を持て、そのとき rect は回す前の箱、quads は回した 4 隅（spec-4b-2 確定事項1〜4）
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

  // updateAnnot で書き換えられる欄（spec-4b-1b 確定事項21 で塗りと線種を、spec-4b-2 確定事項4 で角度を、spec-4b-4a 確定事項A4 で
  // テキストの幅・太字・斜体・枠線を足し、塗りをテキストにも許した。間隔と強さは右パネルから変えない）。
  const PATCH_FIELDS = Object.freeze(['color', 'fill', 'lineStyle', 'text', 'fontSize', 'rect', 'quads', 'lineWidth', 'paths', 'opacity', 'angle',
    'width', 'bold', 'italic', 'borderColor', 'borderWidth', 'callout']);

  function rules() {
    return root.SigK.annotationEntryRules;
  }

  function style() {
    return root.SigK.shapeStyle;
  }

  // テキストの書式の欄（free-text-entry.js）。
  function textFields() {
    return root.SigK.freeTextEntry;
  }

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
      textFields().copyFields(entry, copy);
    }
    if (isDrawnKind(entry.kind)) {
      copy.lineWidth = entry.lineWidth;
      style().copyStyle(entry, copy);
    }
    if (angleOf(entry) !== 0)
      copy.angle = entry.angle;
    if (isPathKind(entry.kind))
      copy.paths = copyPaths(entry.paths);
    if (entry.head !== undefined)
      copy.head = entry.head;
    if (isNoteKind(entry.kind))
      copy.author = entry.author ?? '';
    return copy;
  }

  // 四角・丸・テキストの角度（無いものは 0。spec-4b-2 確定事項1、spec-4b-4b 確定事項A1）。
  function angleOf(entry) {
    return Number.isFinite(entry?.angle) ? entry.angle : 0;
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
      && samePaths(a.paths, b.paths) && style().sameStyle(a, b) && angleOf(a) === angleOf(b) && a.head === b.head && textFields().sameFields(a, b);
  }

  // ワーカーへ渡す形（spec-4-1 確定事項22・spec-4-2 確定事項18・spec-4-3 確定事項18・spec-4-4 確定事項19・
  // spec-4b-1b 確定事項35・spec-4b-4a 確定事項I1）。id は要らない。マークアップは四角の並び、テキストは箱と本文・大きさ・回転
  // （新しい形は書式の欄と、layoutOf(entry) が返す画面で決めた行と余白も）、図形・ペンは箱と線幅（と点列、既定と違う見た目の欄）、
  // ノートは箱と本文・作成者。四角は箱から作れるので落とす。
  function toSaveEntry(entry, { layoutOf = null } = {}) {
    const { src, kind, color, opacity, quads, rect, text, fontSize, rotation, lineWidth, paths, author } = entry;
    if (kind === 'text') {
      const layout = textFields().isNewForm(entry) && typeof layoutOf === 'function' ? layoutOf(entry) : null;
      const saved = { src, kind, color, opacity, rect: [...rect], text, fontSize, rotation, ...textFields().saveFields(entry, layout) };
      if (angleOf(entry) !== 0)
        saved.angle = entry.angle;
      return saved;
    }
    if (isNoteKind(kind))
      return { src, kind, color, opacity, rect: [...rect], text, author: author ?? '' };
    if (isDrawnKind(kind)) {
      const saved = { src, kind, color, opacity, rect: [...rect], lineWidth, ...style().saveStyle(entry) };
      if (isPathKind(kind))
        saved.paths = copyPaths(paths);
      if (angleOf(entry) !== 0)
        saved.angle = entry.angle;
      if (entry.head !== undefined)
        saved.head = entry.head;
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
    angleOf,
    copyEntry,
    sameEntry,
    validEntry: (entry) => rules().validEntry(entry),
    pickPatch: (patch, kind) => rules().pickPatch(patch, kind),
    applyPatch: (entry, picked) => rules().applyPatch(entry, picked),
    toSaveEntry,
  };
})(typeof window !== 'undefined' ? window : globalThis);
