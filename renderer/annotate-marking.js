(function (root) {
  'use strict';

  // マーキングの指揮（spec-7-9 確定事項F3〜F5）。
  //
  // 配置（place）・次に配置する値（形・大きさ・線の太さ）の記憶・選択中のマーキングの形と大きさと番号の変更を、annotation-state.js の
  // 操作と page-edit.commitAnnots（1 本の履歴）に結ぶ。色と透明度は、ほかの書き込みツールと同じく annotate-next-style.js と
  // annotate-opacity.js が記憶する。押し離しの振り分けは annotate-press.js、ハンドルは marking-handles.js、行は marking-props.js。
  //
  // 番号付き丸の次の番号は、別の状態を持たず、文書の中の番号付き丸の番号の最大値＋1 で求める（取り消し・やり直し・タブの切り替え・
  // 保存し直しで食い違わない。Claude の判断）。コピーした番号付き丸は同じ番号のまま、削除しても番号は詰めない（Claude の判断）。

  const state = { next: null, lineWidth: null };

  function rules() {
    return root.SigK.markingRules;
  }

  function geometry() {
    return root.SigK.markingGeometry;
  }

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function refresh() {
    root.SigK.annotationProps?.refresh();
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function reset() {
    const { shape, outer, dot, ring, cross, fontSize } = rules().DEFAULTS;
    state.next = { shape, outer, dot, ring, cross, fontSize };
    state.lineWidth = rules().DEFAULT_LINE_WIDTH;
  }

  // 次に配置する形と大きさ（番号は持たない）。
  function getNext() {
    return { ...state.next };
  }

  function getLineWidth() {
    return state.lineWidth;
  }

  function persist(partial) {
    root.SigK.shell?.persist?.({ annotMarking: partial });
  }

  // 起動時に settings.json の annotMarking から戻す。範囲の外の欄は今の値のまま。
  function apply(memo) {
    if (rules().isShape(memo?.shape))
      state.next.shape = memo.shape;
    for (const field of rules().SIZE_FIELDS) {
      if (rules().inRange(field, memo?.[field]))
        state.next[field] = memo[field];
    }
    state.next.dot = Math.min(state.next.dot, state.next.outer);
    state.next.ring = Math.min(state.next.ring, state.next.outer);
    if (root.SigK.annotationPresets.isLineWidth(memo?.lineWidth))
      state.lineWidth = memo.lineWidth;
    refresh();
    return { ...getNext(), lineWidth: state.lineWidth };
  }

  function rememberLineWidth(width) {
    if (!root.SigK.annotationPresets.isLineWidth(width))
      return false;
    state.lineWidth = width;
    persist({ lineWidth: width });
    return true;
  }

  // 次に配置する形と大きさを記憶する（marking は形と大きさの欄を持つもの。番号は記憶しない）。
  function rememberNext(marking) {
    const { shape, outer, dot, ring, cross, fontSize } = marking;
    state.next = { shape, outer, dot, ring, cross, fontSize };
    persist({ ...state.next });
  }

  // 文書の中の番号付き丸の番号の最大値＋1（無ければ 1。上限 9999）。
  function nextNumber() {
    const view = viewer();
    const annots = view?.getAnnotations() ?? { added: [], removed: [] };
    const imported = Object.values(view?.getImported() ?? {}).flat().filter((entry) => !(annots.removed ?? []).includes(entry.ref));
    const numbers = [...(annots.added ?? []), ...imported].filter((entry) => entry.marking?.shape === 'number').map((entry) => entry.marking.number);
    return Math.min(rules().NUMBER_MAX, Math.max(0, ...numbers) + 1);
  }

  function viewportOf(index) {
    return root.SigK.freeTextEditor?.pageOf(index)?.viewport ?? viewer()?.getTextLayer(index)?.viewport ?? null;
  }

  // マーキングのツールでページをクリックした点（.pdf-page 基準の CSS px）を中心に配置し、配置した書き込みを選択する（確定事項F3）。
  function place({ index, point }) {
    const viewport = viewportOf(index);
    const src = viewer()?.getPlan()[index]?.src;
    if (viewer()?.getState().open !== true || viewport === null || !Number.isInteger(src))
      return false;
    const center = viewport.convertToPdfPoint(point[0], point[1]).map(round);
    const marking = state.next.shape === 'number' ? { ...getNext(), number: nextNumber() } : getNext();
    const id = annotationState().newId();
    const next = annotationState().addAnnot(viewer().getAnnotations(), {
      id,
      src,
      kind: 'marking',
      color: annotate().colorOf('marking'),
      opacity: root.SigK.annotateOpacity?.opacityOf('marking') ?? 1,
      lineWidth: state.lineWidth,
      text: '',
      marking,
      ...geometry().frameOf(marking, center),
    });
    root.SigK.pageEdit.commitAnnots(next, { annot: { before: null, after: id } });
    annotate().select(id);
    return true;
  }

  // 1 件だけ選択している、編集できるマーキング。無ければ null。
  function selectedMarking() {
    if (annotate().getSelection().length !== 1)
      return null;
    const entry = annotate().selectedEntry();
    return entry?.kind === 'marking' && entry.readonly !== true ? entry : null;
  }

  // 選択中のマーキングに新しい marking を当て、中心を保って rect を作り直して 1 世代積む。
  function commitMarking(entry, marking) {
    const center = geometry().centerOf(entry.rect).map(round);
    return root.SigK.annotateTransform.commit(entry, { marking, ...geometry().frameOf(marking, center) });
  }

  // 形の行から（確定事項F2）。選択中のマーキングがあればその形を変え、次に配置する形としても記憶する。
  function setShape(shape) {
    if (!rules().isShape(shape))
      return false;
    const entry = selectedMarking();
    if (entry === null && annotate().drawingTool() !== 'marking')
      return false;
    if (entry !== null && entry.marking.shape !== shape)
      commitMarking(entry, rules().withShape(entry.marking, shape, nextNumber()));
    rememberNext({ ...state.next, shape });
    refresh();
    return true;
  }

  // 大きさの数値欄から（確定事項F4）。範囲の外・中の円が外の円より大きくなる値は当てずに false（数値欄は今の値に戻す）。
  function setSize(field, value) {
    const entry = selectedMarking();
    if (entry === null && annotate().drawingTool() !== 'marking')
      return false;
    const marking = rules().withSize(entry?.marking ?? state.next, field, value);
    if (marking === null)
      return false;
    if (entry !== null)
      commitMarking(entry, marking);
    rememberNext({ ...marking, shape: state.next.shape });
    refresh();
    return true;
  }

  // 番号の数値欄から。番号付き丸を選択している時だけ。
  function setNumber(value) {
    const entry = selectedMarking();
    const marking = entry === null ? null : rules().withNumber(entry.marking, value);
    if (marking === null)
      return false;
    commitMarking(entry, marking);
    refresh();
    return true;
  }

  reset();

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateMarking = {
    reset, apply, getNext, getLineWidth, rememberLineWidth, nextNumber, place, selectedMarking, setShape, setSize, setNumber,
  };
})(typeof window !== 'undefined' ? window : globalThis);
