(function (root) {
  'use strict';

  // 編集モードの取りやめの順（spec-4-1 確定事項7、spec-4-3 確定事項3、spec-4b-1b 確定事項6・8、spec-4b-2 確定事項21、
  // spec-4b-3a 確定事項L3・M、spec-4b-3b 確定事項E2・G）。
  //
  // 200 行を超えた annotate.js から移した（spec-4b-3b）。annotate.js は同じ名前の口（escape・abortGestures）でここへ委ねる。
  //   - escape: Esc 1 回で、開いている・進んでいるものを 1 つだけ閉じる（上から順に見る）
  //   - abortGestures: 取り消し・やり直しの前に、押して引いている途中の操作を全部取りやめる
  //   - abortForChord: 左＋右で、押している操作を全部取りやめる（描きかけ・置く前の押下・文字の選択も）

  function finishEditing() {
    return root.SigK.annotateText?.finishEditing() === true;
  }

  // Esc。右クリックのメニュー → つまみ → 範囲選択（押す前の選択に戻す）→ 掴んで動かす（元の位置）→ 表示を引く（そこで終える）→
  // パレットの窓 → スライダーの下見 → 描きかけ（「描いている」印ごと捨てる。spec-4b-3b 事前調査 I）→ 入力欄（確定）→ 選択を外す →
  // 道具を外す、の順に、最初に当たった 1 つだけ。何も無ければ false。
  function escape() {
    const steps = [
      () => root.SigK.annotationMenu?.close() === true,
      () => root.SigK.annotateTransform?.cancel() === true,
      () => root.SigK.annotateMarquee?.cancel() === true,
      () => root.SigK.annotateGrab?.cancel() === true,
      () => root.SigK.annotateHand?.cancel() === true,
      () => root.SigK.colorPopover?.close({ restoreFocus: true }) === true,
      () => root.SigK.annotatePreview?.cancel() === true,
      () => root.SigK.annotateDraw?.cancel() === true,
      finishEditing,
      unselect,
      dropTool,
    ];
    return steps.some((step) => step());
  }

  function unselect() {
    const select = root.SigK.annotateSelect;
    if (select.getSelection().length === 0)
      return false;
    select.select(null);
    return true;
  }

  function dropTool() {
    const tools = root.SigK.annotateTools;
    if (tools.getTool() === null)
      return false;
    tools.setTool(null);
    return true;
  }

  // 押して引いている途中の操作（つまみ・範囲選択・掴んで動かす・表示を引く）を取りやめ、メニューを閉じる。取り消し・やり直しの
  // 前に呼ぶ（spec-4b-3a 確定事項L3、spec-4b-3b 確定事項G）。どれか取りやめたら true。
  function abortGestures() {
    const transformed = root.SigK.annotateTransform?.cancel() === true;
    const marqueed = root.SigK.annotateMarquee?.cancel() === true;
    const grabbed = root.SigK.annotateGrab?.cancel() === true;
    const panned = root.SigK.annotateHand?.cancel() === true;
    const closed = root.SigK.annotationMenu?.close() === true;
    return transformed || marqueed || grabbed || panned || closed;
  }

  // 左＋右（spec-4b-3b 確定事項E2）。メニュー・つまみ・範囲選択（押す前の選択に戻す）・掴む（写しを捨てて元の位置）・表示を引く・
  // 描きかけ（印ごと）・テキスト／ノートの置く前の押下・文字の選択を全部取りやめる。入力欄と選択（範囲選択の取りやめを除く）は残す。
  function abortForChord(win) {
    abortGestures();
    root.SigK.annotateDraw?.cancel();
    root.SigK.annotatePress?.reset();
    win?.getSelection?.()?.removeAllRanges();
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateCancel = { escape, abortGestures, abortForChord };
})(typeof window !== 'undefined' ? window : globalThis);
