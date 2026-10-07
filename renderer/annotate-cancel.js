(function (root) {
  'use strict';

  // 編集モードの取りやめの順（spec-4-1 確定事項7、spec-4-3 確定事項3、spec-4b-1b 確定事項6・8、spec-4b-2 確定事項21、
  // spec-4b-3a 確定事項L3・M、spec-4b-3b 確定事項E2・G）。
  //
  // 200 行を超えた annotate.js から移した（spec-4b-3b・spec-4b-6a）。annotate.js は同じ名前の口でここへ委ねる。
  //   - escape: Esc 1 回で、開いている・進んでいるものを 1 つだけ閉じる（上から順に見る）。段（cancelHeld・closeOverlays・
  //     dropDrafts・unselect・dropTool）に分けてあり、escape-order.js が欄・検索バー・文字の選択を間に挟んで呼ぶ（spec-4b-7a 確定事項A5）
  //   - abortGestures: 取り消し・やり直しの前に、押して引いている途中の操作を全部取りやめる
  //   - abortForChord: 左＋右で、押している操作を全部取りやめる（描きかけ・置く前の押下・文字の選択も）
  //   - finishEditing: タブ・モードを替える・保存・印刷の前に、入力欄を確定し、描きかけを確定するかやめる
  //   - dropPendingShape: 取り消し・やり直しの前に、描きかけを捨てる（捨てたら履歴は動かさない）

  // Esc の順の「入力欄（確定）」。テキストの入力欄だけを確定する。
  function finishText() {
    return root.SigK.annotateText?.finishEditing() === true;
  }

  // 開いているテキストの入力欄を確定して閉じる（spec-4-2 確定事項8）。
  // 入力欄を確定する。描いている途中の多角形も、置ける形なら開いたまま確定する（タブ・モードを替える・保存・印刷の前。
  // spec-4b-5a 確定事項16）。
  function finishEditing() {
    const text = root.SigK.annotateText?.finishEditing() === true;
    const polygon = root.SigK.annotatePolygon?.commitPending() === true;
    // 始点合わせは始点しか無いので確定せずにやめる（spec-4b-5a 確定事項19）。
    const anchor = root.SigK.annotateLineAnchor?.cancel() === true;
    // なぞっている途中の消しゴムは当てずにやめる（spec-4b-5b 確定事項23）。
    const erase = root.SigK.annotateErase?.cancel() === true;
    // トリミングの枠は捨て、モザイクの引いている途中はやめる（spec-4b-6a 確定事項15、spec-4b-6b 確定事項12）。
    const trim = root.SigK.annotateTrim?.discard() === true;
    const mosaic = root.SigK.annotateMosaic?.cancel() === true;
    return text || polygon || anchor || erase || trim || mosaic;
  }

  // 描いている途中の多角形を捨てる（Ctrl+Z・Ctrl+Y。履歴は動かさない。spec-4b-5a 確定事項16）。捨てたら true。
  // トリミングの枠も描きかけと同じく捨てるだけにし、前に切ったものは戻さない（spec-4b-6a 確定事項15。点検 3）。
  function dropPendingShape() {
    const polygon = root.SigK.annotatePolygon?.cancel() === true;
    const anchor = root.SigK.annotateLineAnchor?.cancel() === true;
    const erase = root.SigK.annotateErase?.cancel() === true;
    const trim = root.SigK.annotateTrim?.discard() === true;
    const mosaic = root.SigK.annotateMosaic?.cancel() === true;
    return polygon || anchor || erase || trim || mosaic;
  }

  // 押して引いている途中の操作（spec-4b-7a 確定事項A1 の 2）。つまみ → 範囲選択（押す前の選択に戻す）→ 掴んで動かす（元の位置）→
  // 表示を引く（そこで終える）→ なぞっている途中の消しゴム（spec-4b-5b 確定事項23）→ モザイクの引いている途中（spec-4b-6b 確定事項28）→
  // トリミングの引いている途中（引く前の枠へ）→ スライダーを引いている途中（引く前の値へ。spec-4b-7a 確定事項E3）→ スライダーの下見 →
  // 描きかけ（「描いている」印ごと捨てる。spec-4b-3b 事前調査 I）。
  const HELD = [
    () => root.SigK.annotateTransform?.cancel() === true,
    () => root.SigK.annotateMarquee?.cancel() === true,
    () => root.SigK.annotateGrab?.cancel() === true,
    () => root.SigK.annotateHand?.cancel() === true,
    () => root.SigK.annotateErase?.cancel() === true,
    () => root.SigK.annotateMosaic?.cancel() === true,
    () => root.SigK.annotateTrim?.cancelDrag() === true,
    () => root.SigK.propsRange?.cancelDrag() === true,
    () => root.SigK.annotatePreview?.cancel() === true,
    () => root.SigK.annotateDraw?.cancel() === true,
  ];

  // 最初に当たった 1 つを取りやめる。置く前の押下（spec-4b-7a 確定事項A3）も同じ段で捨てる。取りやめた操作の押下も一緒に捨てるので、
  // そのまま離しても置かない・選ばない。
  function cancelHeld() {
    const canceled = HELD.some((step) => step());
    const pending = root.SigK.annotatePress?.isPending() === true;
    if (canceled || pending)
      root.SigK.annotatePress.reset();
    return canceled || pending;
  }

  // 浮いている小窓（確定事項A1 の 3）。道具の段の「その他」の一覧（spec-4b-5b 確定事項28）→ 右クリックのメニュー → パレットの窓。
  function closeOverlays() {
    return root.SigK.editBarMore?.close({ restoreFocus: true }) === true
      || root.SigK.annotationMenu?.close() === true
      || root.SigK.colorPopover?.close({ restoreFocus: true }) === true;
  }

  // 描きかけ・置きかけ（確定事項A1 の 6）。トリミングの枠（spec-4b-6a 確定事項15・26）→ 描いている途中の多角形と、始点合わせの始点
  // （spec-4b-5a 確定事項16・19）→ 入力欄（確定）。
  function dropDrafts() {
    return root.SigK.annotateTrim?.dropFrame() === true
      || root.SigK.annotatePolygon?.cancel() === true
      || root.SigK.annotateLineAnchor?.cancel() === true
      || finishText();
  }

  // Esc（編集モードの分）。押して引いている途中 → 浮いている小窓 → 描きかけ → 選択を外す → 道具を外す、の順に、最初に当たった 1 つだけ。
  // 何も無ければ false。
  function escape() {
    return cancelHeld() || closeOverlays() || dropDrafts() || unselect() || dropTool();
  }

  function unselect() {
    const select = root.SigK.annotateSelect;
    if (select.getSelection().length === 0)
      return false;
    select.select(null);
    return true;
  }

  // 道具の行き来の決まり（tool-switch.js の 'escape'）で外す（spec-4b-7a 確定事項A4）。
  function dropTool() {
    const tools = root.SigK.annotateTools;
    if (tools.getTool() === null)
      return false;
    tools.escapeTool();
    return true;
  }

  // 押して引いている途中の操作（つまみ・範囲選択・掴んで動かす・表示を引く）を取りやめ、メニューを閉じ、トリミングの枠を捨てる。
  // 取り消し・やり直しの前と左＋右で呼ぶ（spec-4b-3a 確定事項L3、spec-4b-3b 確定事項G、spec-4b-6a 確定事項15）。どれか取りやめたら true。
  function abortGestures() {
    const transformed = root.SigK.annotateTransform?.cancel() === true;
    const marqueed = root.SigK.annotateMarquee?.cancel() === true;
    const grabbed = root.SigK.annotateGrab?.cancel() === true;
    const panned = root.SigK.annotateHand?.cancel() === true;
    const erased = root.SigK.annotateErase?.cancel() === true;
    const trimmed = root.SigK.annotateTrim?.discard() === true;
    const mosaicked = root.SigK.annotateMosaic?.cancel() === true;
    const closed = root.SigK.annotationMenu?.close() === true;
    return transformed || marqueed || grabbed || panned || erased || trimmed || mosaicked || closed;
  }

  // 左＋右（spec-4b-3b 確定事項E2）。メニュー・つまみ・範囲選択（押す前の選択に戻す）・掴む（写しを捨てて元の位置）・表示を引く・
  // 描きかけ（印ごと）・テキスト／ノートの置く前の押下・文字の選択を全部取りやめる。入力欄と選択（範囲選択の取りやめを除く）は残す。
  function abortForChord(win) {
    abortGestures();
    root.SigK.annotateTransform?.clearCursor();
    root.SigK.annotateDraw?.cancel();
    root.SigK.annotatePolygon?.cancel();
    root.SigK.annotateLineAnchor?.cancel();
    root.SigK.annotatePress?.reset();
    win?.getSelection?.()?.removeAllRanges();
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateCancel = { escape, cancelHeld, closeOverlays, dropDrafts, unselect, dropTool, abortGestures, abortForChord, finishEditing, dropPendingShape };
})(typeof window !== 'undefined' ? window : globalThis);
