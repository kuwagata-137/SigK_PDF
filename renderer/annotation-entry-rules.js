(function (root) {
  'use strict';

  // 注釈 1 件の形の決まり（検証と、変えてよい欄）の純粋層（spec-4-1 確定事項16・19、spec-4-2 確定事項15〜18、
  // spec-4-3 確定事項14〜18、spec-4-4 確定事項15〜19、spec-4b-1b 確定事項16〜21）。DOM に触れない。
  // annotation-entry.js から分けた（200 行の目安）。種類の判定と欄の一覧は annotation-entry.js、図形の見た目の欄は
  // shape-style.js が持つ。互いに呼ぶときに引くので、読み込む順は問わない。

  function entryModule() {
    return root.SigK.annotationEntry;
  }

  function style() {
    return root.SigK.shapeStyle;
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

  // テキストは本文が空でなく、大きさが正で、回転が 4 方向のどれかで、箱の四角が 1 つ。書式の欄は free-text-entry.js が見る。
  // 角度は新しい形だけが持てる（spec-4b-4b 確定事項A1・A3）。
  function validTextFields(entry) {
    if (entry.angle !== undefined && (!validAngle(entry.angle) || !root.SigK.freeTextEntry.isNewForm(entry)))
      return false;
    return validText(entry.text) && validPositive(entry.fontSize)
      && entryModule().ROTATIONS.includes(entry.rotation) && entry.quads.length === 1 && root.SigK.freeTextEntry.validFields(entry);
  }

  function validPoint(point) {
    return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  }

  // 点列は 1 本以上で、各 path が 2 点以上。直線・矢印は 1 本ちょうどで 2 点（spec-4-3 確定事項14）。多角形は 1 本で 3 点以上
  // （spec-4b-5a 確定事項3）。
  function validPaths(kind, paths) {
    if (!Array.isArray(paths) || paths.length === 0)
      return false;
    if (!paths.every((path) => Array.isArray(path) && path.length >= 2 && path.every(validPoint)))
      return false;
    if (kind === 'polygon')
      return paths.length === 1 && paths[0].length >= 3;
    return kind === 'ink' || (paths.length === 1 && paths[0].length === 2);
  }

  // 角度は 0 以上 360 未満の数（spec-4b-2 確定事項1）。
  function validAngle(value) {
    return Number.isFinite(value) && value >= 0 && value < 360;
  }

  // 図形・ペンは線幅が正（線なしでも持つ。線を戻したときの太さ）で、箱の四角が 1 つ。点列を持つ種類はその形も見る。
  // 角度は四角・丸とテキストだけが持てる（spec-4b-2 確定事項4。ほかの種類は validEntry が断る）。
  function validDrawnFields(entry) {
    if (!validPositive(entry.lineWidth) || entry.quads.length !== 1)
      return false;
    // 矢印の先の形（spec-4b-5a 確定事項4）。持てるのは矢印だけで、値は 'open'（開いた矢じり）だけ。
    if (entry.head !== undefined && !(entry.kind === 'arrow' && entry.head === 'open'))
      return false;
    // 多角形は閉じたかどうかを必ず持つ（spec-4b-5a 確定事項3）。
    if (entry.kind === 'polygon' && typeof entry.closed !== 'boolean')
      return false;
    if (entry.angle !== undefined && !validAngle(entry.angle))
      return false;
    return entryModule().isPathKind(entry.kind) ? validPaths(entry.kind, entry.paths) : true;
  }

  // 角度を持てる種類（四角・丸。spec-4b-2 確定事項4。テキスト。spec-4b-4b 確定事項A1。×印・多角形。spec-4b-5a 確定事項6）。
  function turnable(kind) {
    return style().isBoxedKind(kind) || kind === 'text' || kind === 'cross' || kind === 'polygon';
  }

  // 1 件の形。色・塗り・線種の組み合わせは shape-style.js が見る（線と塗りを両方なしにはできない、など）。
  function validEntry(entry) {
    const kinds = entryModule();
    const shape = Number.isInteger(entry?.src) && entry.src >= 0 && kinds.isKind(entry.kind)
      && Array.isArray(entry.quads) && entry.quads.length > 0 && entry.quads.every(isQuad)
      && Array.isArray(entry.rect) && entry.rect.length === 4 && style().validStyle(entry);
    if (!shape || (entry.angle !== undefined && !turnable(entry.kind)) || (entry.head !== undefined && entry.kind !== 'arrow')
      || (entry.closed !== undefined && entry.kind !== 'polygon'))
      return false;
    if (entry.kind === 'text')
      return validTextFields(entry);
    if (kinds.isNoteKind(entry.kind))
      return validNoteFields(entry);
    return kinds.isDrawnKind(entry.kind) ? validDrawnFields(entry) : true;
  }

  function validPatchValue(field, value, kind) {
    switch (field) {
      case 'color': return typeof value === 'string' || (value === null && style().isFillableKind(kind));
      case 'fill': return kind === 'text' ? root.SigK.freeTextEntry.validPatchValue(field, value) : style().isFillableKind(kind) && (value === null || style().isHexColor(value));
      case 'lineStyle': return style().lineStylesOf(kind).includes(value);
      case 'text': return entryModule().isNoteKind(kind) ? typeof value === 'string' : validText(value);
      case 'opacity': return validOpacity(value);
      case 'fontSize': return validPositive(value);
      case 'lineWidth': return validPositive(value);
      case 'rect': return Array.isArray(value) && value.length === 4;
      case 'quads': return Array.isArray(value) && value.length > 0 && value.every(isQuad);
      case 'paths': return validPaths(kind, value);
      case 'angle': return turnable(kind) && validAngle(value);
      case 'width':
      case 'bold':
      case 'italic':
      case 'borderColor':
      case 'borderWidth':
      case 'callout': return kind === 'text' && root.SigK.freeTextEntry.validPatchValue(field, value);
      default: return false;
    }
  }

  // patch のうち書き換えてよい欄だけを残す。形の崩れる値が 1 つでもあれば null。組み合わせ（線なしと塗りなしの両方、など）は
  // 当てた後の形を validEntry で見る（annotation-state.js の updateAnnot）。
  function pickPatch(patch, kind) {
    const picked = {};
    for (const field of entryModule().PATCH_FIELDS) {
      if (!(field in (patch ?? {})))
        continue;
      if (!validPatchValue(field, patch[field], kind))
        return null;
      picked[field] = patch[field];
    }
    return Object.keys(picked).length === 0 ? null : picked;
  }

  // 変更を当てた書き込み。線種を替えたら、読み込んだ間隔と強さを整える（shape-style.js の restyle）。角度 0 は持たない
  // （spec-4b-2 確定事項1）。テキストの false の太字・斜体も持たない（spec-4b-4a 確定事項A1）。形は確かめない。
  function applyPatch(entry, picked) {
    const { lineStyle, ...rest } = picked;
    const merged = { ...entry, ...rest };
    if (merged.angle === 0)
      delete merged.angle;
    if (merged.kind === 'text')
      root.SigK.freeTextEntry.tidy(merged);
    return lineStyle === undefined ? merged : style().restyle(merged, lineStyle);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationEntryRules = { isQuad, validPaths, validAngle, validEntry, pickPatch, applyPatch };
})(typeof window !== 'undefined' ? window : globalThis);
