(function (root) {
  'use strict';

  // 画面のフォントで測った、テキストの書き込みの行と箱（spec-4b-4a 確定事項B・C・E1）。純関数の free-text-layout.js に、字の送り幅
  // （free-text-shape.js の canvas）と紙の長さ（viewer の getPaperBox。pdf.js の page.view）を渡す口である。
  //
  // 置く・直す・大きさを変える・動かす・描く・印刷する・保存する、のどれもここで行と箱を決める。画面と保存で行をずらさないため、
  // 行を決める道を 1 本にしておく。

  function layout() {
    return root.SigK.freeTextLayout;
  }

  function shape() {
    return root.SigK.freeTextShape;
  }

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  // 元ページ src の、文字の向きに沿った紙の長さ（pt）。分からなければ null（自動の幅は 12 字のまま）。
  function pageLengthOf(src, rotation) {
    return layout().paperLengthOf(root.SigK.viewer?.getPaperBox?.(src) ?? null, rotation);
  }

  // 字（書記素）の送り幅（em）を返す関数。太字は太字の書体で測る。
  function advanceFor(entry) {
    return (unit) => shape().advanceOf(root.document, unit, entry.bold === true);
  }

  // 行と箱（free-text-layout.js の layoutOf の答え）。entry は書き込みか下書き（src・text・fontSize・rotation と書式の欄）。
  function layoutOfEntry(entry) {
    return layout().layoutOf(entry, {
      advanceOf: advanceFor(entry),
      lineWidthOf: (line) => shape().measure(root.document, line, entry.fontSize),
      pageLength: pageLengthOf(entry.src, entry.rotation),
    });
  }

  // 箱の大きさ（表示の向き・pt）。
  function sizeOf(entry) {
    return layoutOfEntry(entry).size;
  }

  // patch を当てた書き込みの箱 { rect, quads }。中身の左上（文字の位置）は動かさず、余白と斜体の分が変われば箱が外へ広がる
  // （確定事項B5）。
  function reframe(entry, patch = {}) {
    const next = { ...entry, ...patch };
    const before = layout().insetOf(entry);
    const after = layout().insetOf(next);
    const origin = layout().shiftOrigin(geometry().frameOrigin(entry.rect, entry.rotation), entry.rotation,
      [before.left - after.left, before.top - after.top]);
    return layout().frameOf(origin, sizeOf(next), next.rotation);
  }

  // 固定の幅を、開き直したときに自動の幅と見誤られない値にする（spec-4b-4a 確定事項J3・完了判定5）。読み戻しの見分け
  // （imported-text-details.js の judgeWidth）が自動と見る幅（最長行とほぼ同じで、行の並びも自動と同じ）なら、最長行より
  // FIXED_MARGIN だけ広げる（0.01pt に切り上げてから足す。広げても行の並びは変わらない）。見た目の差は 0.02pt。
  const FIXED_MARGIN = 0.02;

  function keepFixed(entry, width) {
    const advanceOf = (unit, bold) => shape().advanceOf(root.document, unit, bold);
    const judged = root.SigK.importedTextDetails.judgeWidth({ ...entry, width }, width, { advanceOf, pageLength: pageLengthOf(entry.src, entry.rotation) });
    if (!judged.auto)
      return width;
    return Math.round((Math.ceil(judged.longest * 100 - 1e-6) / 100 + FIXED_MARGIN) * 100) / 100;
  }

  // 入力欄の中身の幅（pt）。新しい形は「入る行の最長」と「送った字を足した行の最短」の真ん中（free-text-wrap.js。確定事項E1）、
  // 今までの形は最長行（確定事項E3）。
  function editorWidthOf(entry) {
    if (entry.width === undefined)
      return layoutOfEntry(entry).contentWidth;
    const advance = advanceFor(entry);
    const wrapWidth = layout().wrapWidthOf(entry, pageLengthOf(entry.src, entry.rotation));
    return root.SigK.freeTextWrap.editorWidthOf(entry.text, wrapWidth, (unit) => advance(unit) * entry.fontSize);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextMetrics = { FIXED_MARGIN, pageLengthOf, advanceFor, layoutOfEntry, sizeOf, reframe, keepFixed, editorWidthOf };
})(typeof window !== 'undefined' ? window : globalThis);
